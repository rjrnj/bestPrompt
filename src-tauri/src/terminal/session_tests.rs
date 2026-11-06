//! Sessions driven against `examples/fake_claude.rs`, which `cargo test`
//! builds next to the test binaries. Every session is closed when its test
//! ends, passing or not, so none is left running.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use super::*;
use crate::db::test_support::logged_with_targets;

/// How long a test waits for something that should happen.
const WAIT: Duration = Duration::from_secs(10);

/// How long a test waits to be sure nothing more arrives.
const SETTLE: Duration = Duration::from_millis(300);

/// `cargo test` builds examples into `target/<profile>/examples/`; the test
/// binary itself is in `target/<profile>/deps/`.
fn fake_claude() -> PathBuf {
    let exe = std::env::current_exe().unwrap();
    let profile = exe.parent().unwrap().parent().unwrap();
    profile
        .join("examples")
        .join(format!("fake_claude{}", std::env::consts::EXE_SUFFIX))
}

/// Where in a test's folder the fake writes its arguments.
const ARGS_FILE: &str = "args";

/// A running session of the fake CLI, closed when dropped.
struct Fake {
    sessions: Arc<Sessions>,
    id: String,
    /// Whether the prompt was passed to the fake.
    prefilled: bool,
    folder: PathBuf,
    output: Arc<Mutex<Vec<u8>>>,
    exited: Receiver<Option<i32>>,
    root: tempfile::TempDir,
}

struct Options<'a> {
    /// The fake's mode, which it reads from `FAKE_CLAUDE_MODE`.
    mode: Option<&'a str>,
    folder_name: &'a str,
    /// What to start instead of the fake itself.
    exe: Option<ClaudeExe>,
    /// What the session is started with to fill Claude's input box.
    prompt: Option<&'a str>,
}

impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            mode: None,
            folder_name: "work",
            exe: None,
            prompt: None,
        }
    }
}

impl Fake {
    fn start(mode: Option<&str>) -> Self {
        Self::start_with(Options {
            mode,
            ..Options::default()
        })
    }

    /// Starts the fake in a new folder.
    fn start_with(options: Options) -> Self {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join(options.folder_name);
        std::fs::create_dir(&folder).unwrap();
        let exe = options.exe.unwrap_or(ClaudeExe::Exe(fake_claude()));
        let mut env: Vec<(OsString, OsString)> = std::env::vars_os().collect();
        env.push((
            "FAKE_CLAUDE_ARGS".into(),
            root.path().join(ARGS_FILE).into(),
        ));
        if let Some(mode) = options.mode {
            env.push(("FAKE_CLAUDE_MODE".into(), mode.into()));
        }
        let claude = ClaudeState::from_parts(Some(exe), env, None);

        let sessions = Arc::new(Sessions::default());
        let output = Arc::new(Mutex::new(Vec::new()));
        let (exit_tx, exited) = mpsc::channel();
        let (query_tx, queries) = mpsc::channel();
        let sink = output.clone();
        let started = sessions
            .start(
                &claude,
                &folder,
                (200, 30),
                options.prompt,
                move |chunk| {
                    let mut output = sink.lock().unwrap();
                    output.extend_from_slice(chunk);
                    // Only queries that end in this chunk, so each is seen
                    // once even when it arrives split across two.
                    let from = (output.len() - chunk.len()).saturating_sub(CURSOR_QUERY.len() - 1);
                    let queries = output[from..]
                        .windows(CURSOR_QUERY.len())
                        .filter(|w| *w == CURSOR_QUERY)
                        .count();
                    for _ in 0..queries {
                        let _ = query_tx.send(());
                    }
                },
                move |code| {
                    let _ = exit_tx.send(code);
                },
            )
            .unwrap();
        let id = started.id;
        answer_cursor_queries(Arc::downgrade(&sessions), id.clone(), queries);
        Fake {
            sessions,
            id,
            prefilled: started.prefilled,
            folder,
            output,
            exited,
            root,
        }
    }

    fn write(&self, data: &[u8]) -> Result<(), SessionError> {
        self.sessions.write(&self.id, data)
    }

    /// The output so far as text, without escape sequences or `\r`.
    fn text(&self) -> String {
        plain(&self.output.lock().unwrap())
    }

    /// Waits until `found` holds for the output, and returns it.
    fn wait_for(&self, what: &str, found: impl Fn(&str) -> bool) -> String {
        let start = Instant::now();
        loop {
            let text = self.text();
            if found(&text) {
                return text;
            }
            assert!(
                start.elapsed() < WAIT,
                "timed out waiting for {what}; output so far:\n{text}\nraw: {:?}",
                String::from_utf8_lossy(&self.output.lock().unwrap())
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_ready(&self) {
        self.wait_for("ready", |text| text.contains("ready"));
    }

    /// The arguments the fake was started with, which it has written by the
    /// time it is ready.
    fn args(&self) -> Vec<String> {
        self.wait_ready();
        std::fs::read_to_string(self.root.path().join(ARGS_FILE))
            .unwrap()
            .lines()
            .map(|hex| {
                let bytes = (0..hex.len() / 2)
                    .map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap())
                    .collect();
                String::from_utf8(bytes).unwrap()
            })
            .collect()
    }

    /// Every byte the fake reported reading, in order. Line breaks are
    /// dropped first, in case the terminal wrapped a long `hex` line.
    fn received(&self) -> Vec<u8> {
        let flat = self.text().replace('\n', "");
        flat.split("hex ")
            .skip(1)
            .flat_map(|part| {
                let digits = &part[..part.bytes().take_while(u8::is_ascii_hexdigit).count()];
                // A line still being written may end in half a byte.
                (0..digits.len() / 2)
                    .map(|i| u8::from_str_radix(&digits[2 * i..2 * i + 2], 16).unwrap())
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    /// Waits until the fake has reported `len` bytes, then a little longer
    /// in case more follow, and returns them all.
    fn received_after(&self, len: usize) -> Vec<u8> {
        let start = Instant::now();
        while self.received().len() < len {
            assert!(
                start.elapsed() < WAIT,
                "timed out waiting for {len} bytes; output so far:\n{}\nraw: {:?}",
                self.text(),
                String::from_utf8_lossy(&self.output.lock().unwrap())
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(SETTLE);
        self.received()
    }
}

/// The cursor position query. ConPTY sends it once at start and shows
/// nothing more until the terminal answers.
const CURSOR_QUERY: &[u8] = b"\x1b[6n";

/// Answers each cursor query, as xterm.js does in the app, until the
/// session's output ends.
fn answer_cursor_queries(sessions: Weak<Sessions>, id: String, queries: Receiver<()>) {
    std::thread::spawn(move || {
        for () in queries {
            let Some(sessions) = sessions.upgrade() else {
                return;
            };
            let _ = sessions.write(&id, b"\x1b[1;1R");
        }
    });
}

impl Drop for Fake {
    fn drop(&mut self) {
        let _ = self.sessions.close(&self.id);
    }
}

/// Terminal output as plain text: CSI and OSC sequences, other escapes and
/// `\r` removed.
fn plain(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '\x1b' => match chars.next() {
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('\x40'..='\x7e').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(c) = chars.next() {
                        if c == '\x07' {
                            break;
                        }
                        if c == '\x1b' {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\r' => {}
            c => out.push(c),
        }
    }
    out
}

#[test]
fn output_reaches_the_channel() {
    let fake = Fake::start(None);
    fake.wait_ready();
}

#[test]
fn without_a_prompt_claude_gets_no_arguments() {
    let fake = Fake::start(None);

    assert_eq!(fake.args(), Vec::<String>::new());
    assert!(!fake.prefilled);
}

/// Each prompt reaches Claude whole, as the one argument `--prefill=` and
/// the prompt with its line endings made `\n`, however the command line had
/// to quote it.
#[test]
fn a_prompt_reaches_claude_as_one_prefill_argument() {
    let long: String = "Say \"hi\" to C:\\dir\\ & 100% | <x> ^\r\n\twith émoji 🎉\n"
        .chars()
        .cycle()
        .take(10_000)
        .collect();
    let long_expected = long.replace("\r\n", "\n");
    let cases: [(&str, &str); 8] = [
        (
            r#"say "hi" and \"quoted\" in C:\dir\ ending\"#,
            r#"say "hi" and \"quoted\" in C:\dir\ ending\"#,
        ),
        (r#"a\\"b\\ "c\"#, r#"a\\"b\\ "c\"#),
        ("%PATH% ^ & | < > ^& \"&\"", "%PATH% ^ & | < > ^& \"&\""),
        ("-p do nothing", "-p do nothing"),
        (
            "one\ntwo\r\nthree\rfour\tfive",
            "one\ntwo\nthree\nfour\tfive",
        ),
        ("héllo wörld 日本語 🎉👍🏽", "héllo wörld 日本語 🎉👍🏽"),
        ("last line\n\n", "last line\n\n"),
        (&long, &long_expected),
    ];
    for (prompt, expected) in cases {
        let fake = Fake::start_with(Options {
            prompt: Some(prompt),
            ..Options::default()
        });

        assert_eq!(fake.args(), [format!("--prefill={expected}")], "{prompt:?}");
        assert!(fake.prefilled, "{prompt:?}");
    }
}

#[test]
fn input_reaches_the_program() {
    let fake = Fake::start(None);
    fake.wait_ready();

    fake.write(b"abc").unwrap();

    fake.wait_for("hex 616263", |text| text.contains("hex 616263"));
}

#[test]
fn resize_is_passed_on() {
    let fake = Fake::start(None);
    fake.wait_ready();

    fake.sessions.resize(&fake.id, 100, 30).unwrap();

    // The fake reports its size after each read, and the console may take
    // a moment to see the new one, so keep writing until it does.
    let start = Instant::now();
    loop {
        fake.write(b"x").unwrap();
        std::thread::sleep(Duration::from_millis(100));
        if fake.text().contains("size 100x30") {
            break;
        }
        assert!(
            start.elapsed() < WAIT,
            "the new size never arrived:\n{}",
            fake.text()
        );
    }
}

#[test]
fn spawning_in_a_folder_with_spaces_and_accents_works() {
    let fake = Fake::start_with(Options {
        folder_name: "my prompts é",
        ..Options::default()
    });

    let text = fake.wait_for("cwd", |text| {
        text.lines()
            .skip_while(|line| !line.starts_with("cwd "))
            .any(|line| line.starts_with("size "))
    });

    let line = text.lines().find(|line| line.starts_with("cwd ")).unwrap();
    let reported = std::fs::canonicalize(line["cwd ".len()..].trim_end()).unwrap();
    let expected = std::fs::canonicalize(&fake.folder).unwrap();
    if cfg!(windows) {
        assert_eq!(
            reported.to_string_lossy().to_lowercase(),
            expected.to_string_lossy().to_lowercase()
        );
    } else {
        assert_eq!(reported, expected);
    }
}

/// A `.cmd` shim, as npm installs Claude Code, that runs the fake with the
/// arguments it is given. Its folder lives as long as the first value.
#[cfg(windows)]
fn cmd_shim() -> (tempfile::TempDir, PathBuf) {
    let shims = tempfile::tempdir().unwrap();
    let dir = shims.path().join("npm shims");
    std::fs::create_dir(&dir).unwrap();
    let shim = dir.join("claude.cmd");
    let body = format!("@\"{}\" %*\r\n", fake_claude().display());
    std::fs::write(&shim, body).unwrap();
    (shims, shim)
}

/// `cmd.exe` would read the prompt as its own syntax, so a shim is started
/// without it, though it passes on whatever arguments it is given.
#[cfg(windows)]
#[test]
fn a_cmd_shim_is_started_without_the_prompt() {
    let (_shims, shim) = cmd_shim();
    let fake = Fake::start_with(Options {
        exe: Some(ClaudeExe::Cmd(shim)),
        prompt: Some("hello"),
        ..Options::default()
    });

    assert_eq!(fake.args(), Vec::<String>::new());
    assert!(!fake.prefilled);
}

/// A prompt that fits the command line with the margin left over is passed.
#[cfg(windows)]
#[test]
fn a_prompt_that_just_fits_the_command_line_is_passed() {
    let program = fake_claude().into_os_string();
    let overhead = command_line_len([program.as_os_str(), OsStr::new(PREFILL)]);
    let prompt = "x".repeat(COMMAND_LINE_MAX - LAUNCHER_MARGIN - overhead);

    let fake = Fake::start_with(Options {
        prompt: Some(&prompt),
        ..Options::default()
    });

    assert!(fake.prefilled);
    assert_eq!(fake.args(), [format!("{PREFILL}{prompt}")]);
}

/// A person's paste is bracketed once Claude asked for it.
#[test]
fn a_user_paste_is_bracketed_when_claude_asked_for_it() {
    let fake = Fake::start(None);
    fake.wait_ready();

    fake.sessions.paste(&fake.id, "one\ntwo").unwrap();

    let expected = b"\x1b[200~one\rtwo\x1b[201~";
    assert_eq!(fake.received_after(expected.len()), expected);
}

#[test]
fn an_empty_paste_writes_nothing_and_an_unknown_session_is_ended() {
    let fake = Fake::start(None);
    fake.wait_ready();

    fake.sessions.paste(&fake.id, "").unwrap();
    let unknown = fake.sessions.paste("nope", "text");

    std::thread::sleep(SETTLE);
    assert_eq!(fake.received(), b"");
    assert!(matches!(unknown, Err(SessionError::SessionEnded)));
}

/// portable-pty would otherwise start the process in the home folder.
#[test]
fn a_folder_gone_before_the_spawn_is_missing() {
    let root = tempfile::tempdir().unwrap();
    let gone = root.path().join("gone");
    let env = std::env::vars_os().collect();
    let claude = ClaudeState::from_parts(Some(ClaudeExe::Exe(fake_claude())), env, None);
    let sessions = Sessions::default();

    let started = sessions.start(&claude, &gone, (80, 24), None, |_| {}, |_| {});

    assert!(matches!(started, Err(SessionError::FolderMissing)));
}

/// On Windows, portable-pty's error for a failed spawn quotes the whole
/// command line, prompt included, and it logs that line itself.
#[test]
fn a_failed_spawn_never_reports_the_prompt() {
    let root = tempfile::tempdir().unwrap();
    let missing = root
        .path()
        .join(format!("missing{}", std::env::consts::EXE_SUFFIX));
    let env = std::env::vars_os().collect();
    let claude = ClaudeState::from_parts(Some(ClaudeExe::Exe(missing)), env, None);
    let sessions = Sessions::default();
    let prompt = "a secret plan 4417";

    let (error, log) = logged_with_targets(|| {
        let started = sessions.start(&claude, root.path(), (80, 24), Some(prompt), |_| {}, |_| {});
        let error = started.unwrap_err();
        // Serialising is what logs the detail.
        serde_json::to_value(&error).unwrap();
        error
    });

    let SessionError::SpawnFailed { detail } = &error else {
        panic!("{error:?}");
    };
    assert!(
        detail.starts_with("Claude Code could not be started"),
        "{detail}"
    );
    let silenced = |target: &str| {
        crate::SILENCED
            .iter()
            .any(|crate_name| target.split("::").next() == Some(crate_name))
    };
    for (target, line) in &log {
        assert!(
            !line.contains(prompt) || silenced(target),
            "{target}: {line}"
        );
    }
    // The app's logger drops portable-pty's own line.
    if cfg!(windows) {
        assert!(
            log.iter()
                .any(|(target, line)| line.contains(prompt) && silenced(target)),
            "{log:?}"
        );
    }
}

#[test]
fn closing_a_session_ends_its_child_processes() {
    let fake = Fake::start(Some("spawn-child"));
    let text = fake.wait_for("child", |text| {
        text.split_once("child ")
            .is_some_and(|(_, rest)| rest.contains('\n'))
    });
    let line = text
        .lines()
        .find(|line| line.starts_with("child "))
        .unwrap();
    let pid: u32 = line["child ".len()..].trim().parse().unwrap();
    assert!(alive(pid), "the child should be running before the close");

    fake.sessions.close(&fake.id).unwrap();

    let start = Instant::now();
    while alive(pid) {
        assert!(start.elapsed() < WAIT, "child {pid} outlived its session");
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(matches!(
        fake.sessions.close(&fake.id),
        Err(SessionError::SessionEnded)
    ));
}

#[test]
fn exit_is_reported_with_its_code() {
    let fake = Fake::start(None);
    fake.wait_ready();

    fake.write(b"q").unwrap();

    assert_eq!(fake.exited.recv_timeout(WAIT).unwrap(), Some(7));
    assert!(matches!(fake.write(b"x"), Err(SessionError::SessionEnded)));
    assert!(matches!(
        fake.sessions.resize(&fake.id, 90, 20),
        Err(SessionError::SessionEnded)
    ));
}

#[test]
fn the_reader_ends_after_the_program_exits() {
    let fake = Fake::start(None);
    fake.wait_ready();
    fake.write(b"q").unwrap();
    fake.exited.recv_timeout(WAIT).unwrap();

    let start = Instant::now();
    while fake.sessions.reading(&fake.id) {
        assert!(start.elapsed() < WAIT, "the reader is still running");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn unknown_sessions_have_ended() {
    let sessions = Sessions::default();
    assert!(matches!(
        sessions.write("nope", b"x"),
        Err(SessionError::SessionEnded)
    ));
    assert!(matches!(
        sessions.close("nope"),
        Err(SessionError::SessionEnded)
    ));
}

/// Whether `pid` is still running. A zombie, which only waits for its
/// parent to collect it, counts as gone.
#[cfg(target_os = "linux")]
fn alive(pid: u32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    if unsafe { libc::kill(pid as libc::pid_t, 0) } != 0 {
        return false;
    }
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    // The state follows the command name, which is in parentheses.
    let state = stat.rsplit(')').next().unwrap_or("").trim_start();
    !state.is_empty() && !state.starts_with('Z')
}

/// Whether `pid` is still running: it can be opened and hasn't exited.
#[cfg(windows)]
fn alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, WaitForSingleObject,
    };
    // SAFETY: the handle is checked for null and closed after one wait.
    unsafe {
        let handle = OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        );
        if handle.is_null() {
            return false;
        }
        let running = WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
        CloseHandle(handle);
        running
    }
}
