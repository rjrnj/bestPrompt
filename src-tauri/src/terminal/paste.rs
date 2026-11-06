//! Writing a person's paste to Claude, as a bracketed paste when Claude has
//! asked for those, and tracking whether it has.

const START: &[u8] = b"\x1b[200~";
const END: &[u8] = b"\x1b[201~";

/// The longest unfinished sequence held over to the next chunk. Real mode
/// sequences are far shorter; anything longer isn't one we care about.
const CARRY_CAP: usize = 32;

/// `text` as a terminal takes a paste: newlines become `\r`, as xterm.js
/// does for pastes, and ESC becomes U+241B so the text can't end a bracketed
/// paste early.
fn paste_body(text: &str) -> String {
    text.replace("\r\n", "\r")
        .replace('\n', "\r")
        .replace('\x1b', "\u{241b}")
}

/// What a person's paste writes: framed as one bracketed paste when Claude
/// asked for them, otherwise the same text without the markers. No Enter
/// follows either.
pub fn paste_input(text: &str, bracketed: bool) -> Vec<u8> {
    let body = paste_body(text);
    if !bracketed {
        return body.into_bytes();
    }
    let mut out = Vec::with_capacity(START.len() + body.len() + END.len());
    out.extend_from_slice(START);
    out.extend_from_slice(body.as_bytes());
    out.extend_from_slice(END);
    out
}

/// Follows DEC private mode 2004 in the terminal's output.
#[derive(Debug, Default)]
pub struct ModeTracker {
    bracketed: bool,
    /// The unfinished tail of the last chunk, in case a sequence is split.
    carry: Vec<u8>,
}

impl ModeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, chunk: &[u8]) {
        let mut buf = std::mem::take(&mut self.carry);
        buf.extend_from_slice(chunk);

        let mut i = 0;
        while i < buf.len() {
            if buf[i] != 0x1b {
                i += 1;
                continue;
            }
            match parse_mode(&buf[i..]) {
                Parsed::Mode { len, params, set } => {
                    if params.split(|&b| b == b';').any(|p| p == b"2004") {
                        self.bracketed = set;
                    }
                    i += len;
                }
                Parsed::Incomplete if buf.len() - i <= CARRY_CAP => {
                    self.carry = buf[i..].to_vec();
                    return;
                }
                Parsed::Incomplete | Parsed::Other => i += 1,
            }
        }
    }

    /// Whether Claude last turned bracketed paste on.
    pub fn bracketed(&self) -> bool {
        self.bracketed
    }
}

enum Parsed<'a> {
    /// A complete `ESC [ ? params h|l`.
    Mode {
        len: usize,
        params: &'a [u8],
        set: bool,
    },
    /// So far a prefix of one; more output may finish it.
    Incomplete,
    Other,
}

/// Reads a private mode sequence at the start of `bytes`, which begins
/// with ESC.
fn parse_mode(bytes: &[u8]) -> Parsed<'_> {
    const PREFIX: &[u8] = b"\x1b[?";
    let head = bytes.len().min(PREFIX.len());
    if bytes[..head] != PREFIX[..head] {
        return Parsed::Other;
    }
    if head < PREFIX.len() {
        return Parsed::Incomplete;
    }
    let rest = &bytes[PREFIX.len()..];
    let n = rest
        .iter()
        .take_while(|b| b.is_ascii_digit() || **b == b';')
        .count();
    let len = PREFIX.len() + n + 1;
    match rest.get(n) {
        None => Parsed::Incomplete,
        Some(b'h') => Parsed::Mode {
            len,
            params: &rest[..n],
            set: true,
        },
        Some(b'l') => Parsed::Mode {
            len,
            params: &rest[..n],
            set: false,
        },
        Some(_) => Parsed::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bracketed_paste_is_framed_once_with_no_enter_after_it() {
        let out = paste_input("one\ntwo\n\nthree", true);
        let body = "one\rtwo\r\rthree";
        assert!(out.starts_with(START));
        assert!(out.ends_with(END));
        let count = |marker: &[u8]| out.windows(marker.len()).filter(|w| *w == marker).count();
        assert_eq!(count(START), 1);
        assert_eq!(count(END), 1);
        assert_eq!(out.len(), START.len() + body.len() + END.len());
    }

    #[test]
    fn paste_input_frames_only_when_bracketed() {
        let cases: [(&str, bool, &[u8]); 5] = [
            ("a\nb", true, b"\x1b[200~a\rb\x1b[201~"),
            ("a\nb", false, b"a\rb"),
            ("a\r\nb", false, b"a\rb"),
            ("a\x1b[201~b", false, "a\u{241b}[201~b".as_bytes()),
            ("", false, b""),
        ];
        for (text, bracketed, expected) in cases {
            assert_eq!(paste_input(text, bracketed), expected, "{text:?}");
        }
    }

    #[test]
    fn paste_text_normalises_newlines_and_strips_escapes() {
        let long = "x".repeat(10_000);
        let cases: [(&str, &str); 8] = [
            ("", ""),
            ("a\r\nb", "a\rb"),
            ("a\nb", "a\rb"),
            ("a\n\n\nb", "a\r\r\rb"),
            ("a\r\n\r\nb", "a\r\rb"),
            ("end\n", "end\r"),
            ("a\x1b[201~b", "a\u{241b}[201~b"),
            ("héllo 🎉 日本", "héllo 🎉 日本"),
        ];
        for (input, expected) in cases {
            let out = paste_input(input, true);
            let middle = &out[START.len()..out.len() - END.len()];
            assert_eq!(middle, expected.as_bytes(), "input {input:?}");
        }
        let out = paste_input(&long, true);
        assert_eq!(&out[START.len()..out.len() - END.len()], long.as_bytes());
    }

    #[test]
    fn mode_tracker_sees_2004h_split_across_chunks() {
        let seq = b"\x1b[?2004h";
        for split in 0..=seq.len() {
            let mut tracker = ModeTracker::new();
            tracker.feed(b"hello ");
            tracker.feed(&seq[..split]);
            tracker.feed(&seq[split..]);
            assert!(tracker.bracketed(), "split at {split}");
        }
        assert!(!ModeTracker::new().bracketed());
    }

    #[test]
    fn mode_tracker_turns_off_on_2004l() {
        let mut tracker = ModeTracker::new();
        tracker.feed(b"\x1b[?2004h");
        assert!(tracker.bracketed());
        tracker.feed(b"bye\x1b[?20");
        tracker.feed(b"04l");
        assert!(!tracker.bracketed());
    }

    #[test]
    fn mode_tracker_sees_2004_among_other_modes() {
        let mut tracker = ModeTracker::new();
        tracker.feed(b"\x1b[?1004;2004h");
        assert!(tracker.bracketed());
        tracker.feed(b"\x1b[?2004;1004l");
        assert!(!tracker.bracketed());
        tracker.feed(b"\x1b[?12004h\x1b[?1004h\x1b[?25l\x1b[?20045h");
        assert!(!tracker.bracketed());
    }

    #[test]
    fn mode_tracker_drops_a_long_unfinished_sequence() {
        let mut tracker = ModeTracker::new();
        tracker.feed(b"\x1b[?");
        for _ in 0..20 {
            tracker.feed(b"1234567890");
            assert!(tracker.carry.len() <= CARRY_CAP);
        }
        tracker.feed(b"\x1b[?2004h");
        assert!(tracker.bracketed());
    }
}
