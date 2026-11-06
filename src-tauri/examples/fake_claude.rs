//! A stand-in for the Claude Code CLI in the session tests. It behaves like
//! the parts of Claude the session manager depends on: it puts its terminal
//! in raw mode, asks for bracketed paste, and then reports every chunk of
//! input it reads as `hex <bytes>`, followed by the terminal size.
//!
//! `FAKE_CLAUDE_MODE` picks a mode:
//!
//! - `spawn-child`: starts a copy of itself that sleeps, and prints
//!   `child <pid>`.
//! - `sleep`: what that copy runs; sleeps for a minute.
//!
//! Reading a lone `q` makes it exit with code 7.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::Duration;

/// The exit code for a lone `q`.
const QUIT_CODE: i32 = 7;

/// The variable that picks the mode.
const MODE: &str = "FAKE_CLAUDE_MODE";

fn main() {
    let mode = std::env::var(MODE).unwrap_or_default();
    if mode == "sleep" {
        std::thread::sleep(Duration::from_secs(60));
        return;
    }

    raw_mode();
    print_raw("\x1b[?2004h");
    print_line("ready");
    let cwd = std::env::current_dir().expect("current dir");
    print_line(&format!("cwd {}", cwd.display()));
    print_size();
    if mode == "spawn-child" {
        // Never waited for: the test checks that closing the session ends it.
        #[allow(clippy::zombie_processes)]
        let child = Command::new(std::env::current_exe().expect("current exe"))
            .env(MODE, "sleep")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn child");
        print_line(&format!("child {}", child.id()));
    }

    let mut stdin = std::io::stdin().lock();
    let mut buf = [0u8; 4096];
    loop {
        let n = match stdin.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        let chunk = &buf[..n];
        if chunk == b"q" {
            std::process::exit(QUIT_CODE);
        }
        print_line(&format!("hex {}", hex(chunk)));
        print_size();
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn print_raw(text: &str) {
    let mut out = std::io::stdout().lock();
    out.write_all(text.as_bytes()).expect("write");
    out.flush().expect("flush");
}

/// Raw mode turns off the terminal's newline translation, so lines end in
/// `\r\n` explicitly.
fn print_line(text: &str) {
    print_raw(&format!("{text}\r\n"));
}

fn print_size() {
    let (cols, rows) = size();
    print_line(&format!("size {cols}x{rows}"));
}

#[cfg(target_os = "linux")]
fn raw_mode() {
    // SAFETY: termios is plain data, and fd 0 is this process's terminal.
    unsafe {
        let mut termios: libc::termios = std::mem::zeroed();
        assert_eq!(libc::tcgetattr(0, &mut termios), 0, "tcgetattr");
        libc::cfmakeraw(&mut termios);
        assert_eq!(libc::tcsetattr(0, libc::TCSANOW, &termios), 0, "tcsetattr");
    }
}

#[cfg(target_os = "linux")]
fn size() -> (u16, u16) {
    // SAFETY: winsize is plain data, filled in by the ioctl.
    unsafe {
        let mut ws: libc::winsize = std::mem::zeroed();
        assert_eq!(libc::ioctl(1, libc::TIOCGWINSZ, &mut ws), 0, "TIOCGWINSZ");
        (ws.ws_col, ws.ws_row)
    }
}

#[cfg(windows)]
fn raw_mode() {
    use windows_sys::Win32::System::Console::{
        ENABLE_PROCESSED_OUTPUT, ENABLE_VIRTUAL_TERMINAL_INPUT, ENABLE_VIRTUAL_TERMINAL_PROCESSING,
        ENABLE_WRAP_AT_EOL_OUTPUT, GetStdHandle, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
        SetConsoleMode,
    };
    // SAFETY: plain Win32 calls on this process's own console handles.
    unsafe {
        // No line input, echo or processed input: every key arrives as it
        // is, as VT sequences.
        let input = GetStdHandle(STD_INPUT_HANDLE);
        assert_ne!(
            SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT),
            0,
            "SetConsoleMode(stdin)"
        );
        // Without wrapping, a long `hex` line would overwrite its last
        // column instead of going on to the next row.
        let output = GetStdHandle(STD_OUTPUT_HANDLE);
        let modes = ENABLE_PROCESSED_OUTPUT
            | ENABLE_WRAP_AT_EOL_OUTPUT
            | ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        assert_ne!(SetConsoleMode(output, modes), 0, "SetConsoleMode(stdout)");
    }
}

#[cfg(windows)]
fn size() -> (u16, u16) {
    use windows_sys::Win32::System::Console::{
        CONSOLE_SCREEN_BUFFER_INFO, GetConsoleScreenBufferInfo, GetStdHandle, STD_OUTPUT_HANDLE,
    };
    // SAFETY: the info struct is plain data, filled in by the call.
    unsafe {
        let mut info: CONSOLE_SCREEN_BUFFER_INFO = std::mem::zeroed();
        let output = GetStdHandle(STD_OUTPUT_HANDLE);
        assert_ne!(
            GetConsoleScreenBufferInfo(output, &mut info),
            0,
            "GetConsoleScreenBufferInfo"
        );
        let window = info.srWindow;
        (
            (window.Right - window.Left + 1) as u16,
            (window.Bottom - window.Top + 1) as u16,
        )
    }
}
