//! The embedded terminal: Claude Code sessions running in a PTY, how one is
//! started with a prompt in Claude's input box, which folders a session may
//! start in, and the errors sessions report.

mod cleanup;
pub mod folders;
pub mod paste;
#[cfg(test)]
mod session_tests;

use std::collections::HashMap;
use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Serialize, Serializer};
use ts_rs::TS;
use uuid::Uuid;

use crate::claude::{ClaudeExe, ClaudeState};
use cleanup::ProcessTree;
use paste::{ModeTracker, paste_input};

/// What happens to a session, other than its output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum SessionEvent {
    Exited { code: Option<i32> },
}

/// What `start_session` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StartedSession {
    pub id: String,
    /// Whether the prompt was handed to Claude to fill its input box with.
    pub prefilled: bool,
}

/// How long the terminal stays open after its process exits. Windows builds
/// before 24H2 never end the output after the process exits; closing the
/// pseudo console does, and the delay lets the last output through first.
const LINGER: Duration = Duration::from_secs(1);

/// Managed state: every running session, by id.
#[derive(Default)]
pub struct Sessions {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

struct Session {
    io: Arc<Io>,
    /// Shared only weakly with the waiter thread, so dropping the session
    /// still ends the tree.
    tree: Arc<ProcessTree>,
}

/// What a session shares with its reader and waiter threads.
struct Io {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Option<Box<dyn Write + Send>>>,
    modes: Mutex<ModeTracker>,
    ended: AtomicBool,
    reading: AtomicBool,
}

/// Closes every session, so no process outlives the registry.
impl Drop for Sessions {
    fn drop(&mut self) {
        self.close_all();
    }
}

impl Sessions {
    /// Starts the detected Claude Code in `folder` with the base
    /// environment, in a terminal of `size` (columns, rows). Given a
    /// `prompt`, Claude fills its input box with it, unsent, once any
    /// questions it asks at startup are answered; `prefilled` says whether
    /// the prompt could be passed. `on_output` gets every chunk of output
    /// and `on_exit` the exit code, if the process had one.
    pub fn start(
        &self,
        claude: &ClaudeState,
        folder: &Path,
        size: (u16, u16),
        prompt: Option<&str>,
        on_output: impl Fn(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<i32>) + Send + 'static,
    ) -> Result<StartedSession, SessionError> {
        let exe = claude.exe().ok_or(SessionError::ClaudeNotFound)?;
        let Launch { cmd, prefilled } = launch(&exe, &claude.base_env(), folder, prompt)?;
        let id = self.spawn(cmd, prefilled, folder, size, on_output, on_exit)?;
        Ok(StartedSession { id, prefilled })
    }

    /// Starts `cmd` in `folder` and returns the new session's id. If `cmd`
    /// carries the prompt, a failed spawn reports none of its text.
    fn spawn(
        &self,
        cmd: CommandBuilder,
        prefilled: bool,
        folder: &Path,
        size: (u16, u16),
        on_output: impl Fn(&[u8]) + Send + 'static,
        on_exit: impl FnOnce(Option<i32>) + Send + 'static,
    ) -> Result<String, SessionError> {
        let pty = native_pty_system()
            .openpty(pty_size(size))
            .map_err(spawn_failed)?;
        let reader = pty.master.try_clone_reader().map_err(spawn_failed)?;
        let writer = pty.master.take_writer().map_err(spawn_failed)?;
        // Checked again here: the folder may have gone since it was allowed,
        // and portable-pty would then quietly start in the home folder.
        if !folder.is_dir() {
            return Err(SessionError::FolderMissing);
        }
        let mut child = pty.slave.spawn_command(cmd).map_err(|error| {
            if prefilled {
                spawn_failed_without_prompt(error)
            } else {
                spawn_failed(error)
            }
        })?;
        drop(pty.slave);
        let adopted = child
            .process_id()
            .ok_or_else(|| "the process has no id".to_owned())
            .and_then(ProcessTree::adopt);
        let tree = match adopted {
            Ok(tree) => Arc::new(tree),
            Err(detail) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(SessionError::SpawnFailed { detail });
            }
        };

        let io = Arc::new(Io {
            master: Mutex::new(Some(pty.master)),
            writer: Mutex::new(Some(writer)),
            modes: Mutex::new(ModeTracker::new()),
            ended: AtomicBool::new(false),
            reading: AtomicBool::new(true),
        });
        let id = Uuid::now_v7().to_string();
        log::info!("started Claude Code session {id}");

        let reader_io = io.clone();
        std::thread::spawn(move || read_output(reader, &reader_io, on_output));
        let waiter_io = io.clone();
        let waiter_id = id.clone();
        let waiter_tree = Arc::downgrade(&tree);
        std::thread::spawn(move || {
            let code = match child.wait() {
                Ok(status) if status.signal().is_none() => Some(status.exit_code() as i32),
                Ok(_) => None,
                Err(error) => {
                    log::warn!("could not wait for session {waiter_id}: {error}");
                    None
                }
            };
            log::info!("Claude Code session {waiter_id} exited with {code:?}");
            if let Some(tree) = waiter_tree.upgrade() {
                tree.exited();
            }
            waiter_io.ended.store(true, Ordering::SeqCst);
            on_exit(code);
            std::thread::sleep(LINGER);
            lock(&waiter_io.writer).take();
            lock(&waiter_io.master).take();
        });

        let session = Session { io, tree };
        lock(&self.sessions).insert(id.clone(), Arc::new(session));
        Ok(id)
    }

    /// Writes input from the terminal.
    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), SessionError> {
        let io = &self.get(id)?.io;
        let mut writer = lock(&io.writer);
        io.send(&mut writer, data)
    }

    /// Writes a person's paste: bracketed if Claude asked for that. Empty
    /// text writes nothing.
    pub fn paste(&self, id: &str, text: &str) -> Result<(), SessionError> {
        let io = &self.get(id)?.io;
        let mut writer = lock(&io.writer);
        if text.is_empty() {
            return Ok(());
        }
        let bracketed = lock(&io.modes).bracketed();
        io.send(&mut writer, &paste_input(text, bracketed))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), SessionError> {
        let io = &self.get(id)?.io;
        let master = lock(&io.master);
        let master = match master.as_ref() {
            Some(master) if !io.ended.load(Ordering::SeqCst) => master,
            _ => return Err(SessionError::SessionEnded),
        };
        master.resize(pty_size((cols, rows))).map_err(|error| {
            log::warn!("could not resize session {id}: {error}");
            SessionError::SessionEnded
        })
    }

    /// Ends the session's process and everything it started.
    pub fn close(&self, id: &str) -> Result<(), SessionError> {
        let session = lock(&self.sessions)
            .remove(id)
            .ok_or(SessionError::SessionEnded)?;
        // Not joined: the caller needn't wait out the grace period.
        let _ = session.end();
        Ok(())
    }

    /// Closes every session, waiting until their processes are gone.
    pub fn close_all(&self) {
        let sessions: Vec<_> = lock(&self.sessions).drain().collect();
        let ending: Vec<_> = sessions
            .iter()
            .filter_map(|(_, session)| session.end())
            .collect();
        for handle in ending {
            let _ = handle.join();
        }
    }

    fn get(&self, id: &str) -> Result<Arc<Session>, SessionError> {
        lock(&self.sessions)
            .get(id)
            .cloned()
            .ok_or(SessionError::SessionEnded)
    }

    #[cfg(test)]
    fn reading(&self, id: &str) -> bool {
        self.get(id)
            .is_ok_and(|session| session.io.reading.load(Ordering::SeqCst))
    }
}

impl Session {
    /// Marks the session ended first, so nothing more is written to it,
    /// then ends its process tree.
    fn end(&self) -> Option<std::thread::JoinHandle<()>> {
        self.io.ended.store(true, Ordering::SeqCst);
        self.tree.end()
    }
}

impl Io {
    /// Writes `data` through the locked writer unless the session has
    /// ended.
    fn send(
        &self,
        writer: &mut Option<Box<dyn Write + Send>>,
        data: &[u8],
    ) -> Result<(), SessionError> {
        let writer = match writer.as_mut() {
            Some(writer) if !self.ended.load(Ordering::SeqCst) => writer,
            _ => return Err(SessionError::SessionEnded),
        };
        writer
            .write_all(data)
            .and_then(|()| writer.flush())
            .map_err(|error| {
                log::warn!("could not write to a session: {error}");
                SessionError::SessionEnded
            })
    }
}

/// Reads the terminal until it closes, tracking Claude's modes.
fn read_output(mut reader: Box<dyn Read + Send>, io: &Io, on_output: impl Fn(&[u8])) {
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = &buf[..n];
                lock(&io.modes).feed(chunk);
                on_output(chunk);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            // Linux reports the end of the terminal as an error (EIO).
            Err(_) => break,
        }
    }
    io.reading.store(false, Ordering::SeqCst);
}

/// The first character in a `.cmd` shim's path that `cmd /c` would read as
/// syntax rather than as part of the name.
fn cmd_metachar(path: &Path) -> Option<char> {
    path.to_string_lossy()
        .chars()
        .find(|c| "&<>()@^|%!\"".contains(*c))
}

/// `cmd.exe` by its full path, so nothing named `cmd.exe` on `PATH` or in
/// the folder can stand in for it.
fn cmd_exe(env: &[(OsString, OsString)]) -> PathBuf {
    let root = env
        .iter()
        .find(|(name, value)| name.eq_ignore_ascii_case("SystemRoot") && !value.is_empty())
        .map_or_else(
            || PathBuf::from(r"C:\Windows"),
            |(_, value)| PathBuf::from(value),
        );
    root.join("System32").join("cmd.exe")
}

/// Variables sessions don't inherit. A running Claude Code sets the first
/// group for the programs it starts; they would tie a new session to that
/// one or make it ignore the folders the user trusted. An IDE's terminal
/// sets the second; they would make Claude attach to that IDE, though the
/// session's terminal is ours.
const STRIPPED_VARS: [&str; 19] = [
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_BRIDGE_SESSION_ID",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_PID",
    "CLAUDE_EFFORT",
    "CLAUDE_CODE_IGNORE_PERSISTED_TRUST",
    "CLAUDE_CODE_SSE_PORT",
    "ENABLE_IDE_INTEGRATION",
    "FORCE_CODE_TERMINAL",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "TERMINAL_EMULATOR",
    "CURSOR_TRACE_ID",
];

/// What a session's process is started with.
struct Launch {
    cmd: CommandBuilder,
    /// Whether `cmd` passes the prompt.
    prefilled: bool,
}

/// The launch of `exe` in `folder` from the base environment `env`, with
/// `prompt` for Claude's input box when it can be passed. When it can't,
/// the reason is logged, never the prompt.
fn launch(
    exe: &ClaudeExe,
    env: &[(OsString, OsString)],
    folder: &Path,
    prompt: Option<&str>,
) -> Result<Launch, SessionError> {
    let mut cmd = command(exe, env, folder)?;
    let prefilled = match prompt.map(|prompt| prefill_arg(exe, cmd.get_argv(), prompt)) {
        None => false,
        Some(Ok(arg)) => {
            cmd.arg(arg);
            true
        }
        Some(Err(reason)) => {
            log::info!("starting Claude Code without the prompt: {reason}");
            false
        }
    };
    Ok(Launch { cmd, prefilled })
}

/// The option that fills Claude's input box with its value, unsent. Joined
/// to the prompt by `=`, so a prompt starting with `-` can't be read as
/// another option.
const PREFILL: &str = "--prefill=";

/// CreateProcess's limit on a command line, in UTF-16 units, its
/// terminating NUL included.
#[cfg(windows)]
const COMMAND_LINE_MAX: usize = 32_767;

/// Room left under that limit for a launcher `.exe` that starts the real
/// CLI again with a longer command line.
#[cfg(windows)]
const LAUNCHER_MARGIN: usize = 1_024;

/// Linux's limit on one argument (`MAX_ARG_STRLEN`), in bytes, its NUL
/// included. macOS is held to it as well.
#[cfg(unix)]
const ARG_MAX: usize = 131_072;

/// Why a session starts without its prompt. Only this is ever logged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
enum NoPrefill {
    #[error("the prompt is empty")]
    Empty,
    #[error("the prompt contains a NUL, which no argument can hold")]
    Nul,
    #[error("Claude Code runs through cmd.exe, which would read the prompt as its own syntax")]
    ThroughCmd,
    #[error("the prompt would make the command line too long")]
    TooLong,
}

/// The argument that has Claude fill its input box with `prompt`, its line
/// endings made LF and its other control characters shown as pictures, to
/// follow `argv`, the command so far with the program first.
fn prefill_arg(exe: &ClaudeExe, argv: &[OsString], prompt: &str) -> Result<OsString, NoPrefill> {
    let prompt = prompt.replace("\r\n", "\n").replace('\r', "\n");
    if prompt.is_empty() {
        return Err(NoPrefill::Empty);
    }
    if prompt.contains('\0') {
        return Err(NoPrefill::Nul);
    }
    // `cmd.exe` would expand `%...%` and act on `&`, `|` and the rest, and
    // takes no more than 8191 characters.
    if matches!(exe, ClaudeExe::Cmd(_)) {
        return Err(NoPrefill::ThroughCmd);
    }
    let arg = OsString::from(format!("{PREFILL}{}", shown(&prompt)));
    if !fits(argv, &arg) {
        return Err(NoPrefill::TooLong);
    }
    Ok(arg)
}

/// `prompt` with each control character other than tab and newline made
/// its Unicode picture, so Claude's terminal shows it instead of acting on
/// it: ESC becomes U+241B and DEL U+2421. The C1 controls have no pictures
/// and become U+FFFD.
fn shown(prompt: &str) -> String {
    prompt
        .chars()
        .map(|c| match c {
            '\t' | '\n' => c,
            '\x00'..='\x1f' => char::from_u32(0x2400 + c as u32).unwrap_or(c),
            '\x7f' => '\u{2421}',
            '\u{80}'..='\u{9f}' => '\u{fffd}',
            c => c,
        })
        .collect()
}

/// Whether the command line `argv` and then `arg` make is within
/// CreateProcess's limit, less the margin. portable-pty starts the program
/// `argv[0]` names, which is the detected path as it is.
#[cfg(windows)]
fn fits(argv: &[OsString], arg: &OsStr) -> bool {
    let all = argv.iter().map(OsString::as_os_str).chain([arg]);
    command_line_len(all) <= COMMAND_LINE_MAX - LAUNCHER_MARGIN
}

/// Whether `arg` and its NUL are within the limit on one argument.
#[cfg(unix)]
fn fits(_argv: &[OsString], arg: &OsStr) -> bool {
    arg.len() < ARG_MAX
}

/// The length in UTF-16 units, terminating NUL included, of the command
/// line portable-pty builds for `argv`, the program first. It writes each
/// one quoted as `CommandBuilder::append_quoted` does, with a space between
/// them, and ends the line with a NUL (portable-pty 0.9,
/// `src/cmdbuilder.rs`, `CommandBuilder::cmdline`).
#[cfg(windows)]
fn command_line_len<'a>(argv: impl IntoIterator<Item = &'a OsStr>) -> usize {
    use std::os::windows::ffi::OsStrExt;
    // Each `+ 1` is the space after an argument, or the NUL after the last.
    argv.into_iter()
        .map(|arg| quoted_len(&arg.encode_wide().collect::<Vec<_>>()) + 1)
        .sum()
}

/// The length of `arg` as portable-pty quotes it. An argument that isn't
/// empty and holds no space, tab, newline, vertical tab or quote is written
/// as it is. Any other is put in quotes, where a quote is escaped with a
/// backslash and the backslashes before it, or before the closing quote,
/// are doubled.
#[cfg(windows)]
fn quoted_len(arg: &[u16]) -> usize {
    const BACKSLASH: u16 = b'\\' as u16;
    const QUOTE: u16 = b'"' as u16;
    let special = [b' ', b'\t', b'\n', 0x0b, b'"'].map(u16::from);
    if !arg.is_empty() && !arg.iter().any(|unit| special.contains(unit)) {
        return arg.len();
    }
    let mut len = 2;
    let mut backslashes = 0;
    for &unit in arg {
        match unit {
            BACKSLASH => {
                backslashes += 1;
                continue;
            }
            QUOTE => len += 2 * backslashes + 2,
            _ => len += backslashes + 1,
        }
        backslashes = 0;
    }
    len + 2 * backslashes
}

/// `env` without the variables in `STRIPPED_VARS`.
fn session_env(env: &[(OsString, OsString)]) -> Vec<(OsString, OsString)> {
    env.iter()
        .filter(|(name, _)| {
            !STRIPPED_VARS
                .iter()
                .any(|var| name.eq_ignore_ascii_case(var))
        })
        .cloned()
        .collect()
}

/// The command for `exe`, with exactly `session_env(env)` plus what a
/// terminal sets, in `folder`.
fn command(
    exe: &ClaudeExe,
    env: &[(OsString, OsString)],
    folder: &Path,
) -> Result<CommandBuilder, SessionError> {
    let mut cmd = match exe {
        ClaudeExe::Exe(path) => CommandBuilder::new(path),
        ClaudeExe::Cmd(path) => {
            if let Some(c) = cmd_metachar(path) {
                return Err(SessionError::SpawnFailed {
                    detail: format!(
                        "refusing to run {} through cmd.exe: {c:?} in its path would be read as syntax",
                        path.display()
                    ),
                });
            }
            let mut cmd = CommandBuilder::new(cmd_exe(env));
            cmd.args([OsStr::new("/d"), OsStr::new("/c"), path.as_os_str()]);
            cmd
        }
    };
    // portable-pty starts from an environment of its own (on Windows, read
    // from the registry); sessions get the base environment only.
    cmd.env_clear();
    for (name, value) in session_env(env) {
        cmd.env(name, value);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.cwd(folder);
    Ok(cmd)
}

fn pty_size((cols, rows): (u16, u16)) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn spawn_failed(error: impl std::fmt::Display) -> SessionError {
    SessionError::SpawnFailed {
        detail: format!("{error:#}"),
    }
}

/// A failed spawn of a command that carries the prompt. On Windows,
/// portable-pty's error quotes the whole command line, so only the OS error
/// code at its end is kept.
fn spawn_failed_without_prompt(error: impl std::fmt::Display) -> SessionError {
    let detail = match os_error_code(&format!("{error:#}")) {
        Some(code) => format!("Claude Code could not be started (os error {code})"),
        None => "Claude Code could not be started".to_owned(),
    };
    SessionError::SpawnFailed { detail }
}

/// The code in the `(os error N)` that `text` ends with, as the text of an
/// I/O error does.
fn os_error_code(text: &str) -> Option<i32> {
    let (_, code) = text.strip_suffix(')')?.rsplit_once("(os error ")?;
    code.parse().ok()
}

/// A poisoned lock is still usable: every value behind one stays valid
/// whatever a panicking thread was doing.
fn lock<T: ?Sized>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Errors from starting and driving sessions. They reach the frontend
/// serialized as `{ kind, message }`, like `DbError`.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("Claude Code wasn't found.")]
    ClaudeNotFound,

    /// The folder is not one the user picked or saved.
    #[error("That folder isn't one you chose.")]
    FolderNotChosen,

    #[error("That folder no longer exists.")]
    FolderMissing,

    #[error("That session has ended.")]
    SessionEnded,

    /// The process or its terminal couldn't be created; `detail` is for the
    /// log only.
    #[error("Couldn't start Claude Code.")]
    SpawnFailed { detail: String },
}

/// The error as the frontend receives it.
#[derive(Debug, Serialize, TS)]
#[serde(rename = "SessionError")]
#[ts(export)]
struct Payload {
    kind: Kind,
    message: String,
}

#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "SessionError.ts", rename = "SessionErrorKind")]
enum Kind {
    NotFound,
    Invalid,
    Failed,
}

impl SessionError {
    fn kind(&self) -> Kind {
        match self {
            SessionError::ClaudeNotFound | SessionError::SessionEnded => Kind::NotFound,
            SessionError::FolderNotChosen | SessionError::FolderMissing => Kind::Invalid,
            SessionError::SpawnFailed { .. } => Kind::Failed,
        }
    }
}

/// Logs the detail a user-facing message leaves out before the error leaves
/// for the frontend.
impl Serialize for SessionError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if let SessionError::SpawnFailed { detail } = self {
            log::error!("couldn't start Claude Code: {detail}");
        }
        Payload {
            kind: self.kind(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::logged;
    use serde_json::json;

    #[test]
    fn a_cmd_shim_whose_path_cmd_would_parse_is_refused() {
        let cases = [
            (r"C:\Users\me\AppData\Roaming\npm\claude.cmd", None),
            (r"C:\Users\Zoë Smith\npm\claude.cmd", None),
            (r"C:\a & b\claude.cmd", Some('&')),
            (r"C:\a<b\claude.cmd", Some('<')),
            (r"C:\a>b\claude.cmd", Some('>')),
            (r"C:\Program Files (x86)\claude.cmd", Some('(')),
            (r"C:\a)b\claude.cmd", Some(')')),
            (r"C:\@a\claude.cmd", Some('@')),
            (r"C:\a^b\claude.cmd", Some('^')),
            (r"C:\a|b\claude.cmd", Some('|')),
            (r"C:\%PATH%\claude.cmd", Some('%')),
            (r"C:\a!b\claude.cmd", Some('!')),
            ("C:\\a\"b\\claude.cmd", Some('"')),
        ];
        for (path, refused) in cases {
            assert_eq!(cmd_metachar(Path::new(path)), refused, "{path}");
        }

        let env: Vec<(OsString, OsString)> = Vec::new();
        let shim = ClaudeExe::Cmd(PathBuf::from(r"C:\a & b\claude.cmd"));
        let error = command(&shim, &env, Path::new("work")).unwrap_err();
        assert!(
            matches!(error, SessionError::SpawnFailed { .. }),
            "{error:?}"
        );
    }

    #[test]
    fn a_cmd_shim_runs_through_cmd_by_its_full_path() {
        let shim = PathBuf::from(r"C:\npm\claude.cmd");
        let args = |env: &[(OsString, OsString)]| {
            command(&ClaudeExe::Cmd(shim.clone()), env, Path::new("work"))
                .unwrap()
                .get_argv()
                .clone()
        };
        let cmd_in = |root: &str| {
            Path::new(root)
                .join("System32")
                .join("cmd.exe")
                .into_os_string()
        };

        let env = [("SYSTEMROOT".into(), r"D:\Win".into())];
        assert_eq!(
            args(&env),
            [
                cmd_in(r"D:\Win"),
                "/d".into(),
                "/c".into(),
                shim.clone().into()
            ]
        );
        assert_eq!(args(&[])[0], cmd_in(r"C:\Windows"));
    }

    #[test]
    fn session_errors_serialize_with_their_kind_and_message() {
        let cases = [
            (
                SessionError::ClaudeNotFound,
                "notFound",
                "Claude Code wasn't found.",
            ),
            (
                SessionError::FolderNotChosen,
                "invalid",
                "That folder isn't one you chose.",
            ),
            (
                SessionError::FolderMissing,
                "invalid",
                "That folder no longer exists.",
            ),
            (
                SessionError::SessionEnded,
                "notFound",
                "That session has ended.",
            ),
        ];
        for (error, kind, message) in cases {
            assert_eq!(
                serde_json::to_value(&error).unwrap(),
                json!({ "kind": kind, "message": message })
            );
        }

        let error = SessionError::SpawnFailed {
            detail: "pty exploded".to_owned(),
        };
        let (value, log) = logged(|| serde_json::to_value(&error).unwrap());
        assert_eq!(
            value,
            json!({ "kind": "failed", "message": "Couldn't start Claude Code." })
        );
        assert_eq!(log, ["ERROR couldn't start Claude Code: pty exploded"]);
    }

    #[test]
    fn a_running_claude_codes_session_is_not_passed_on() {
        let env: Vec<(OsString, OsString)> = [
            ("CLAUDECODE", "1"),
            ("claude_code_session_id", "abc"),
            ("CLAUDE_EFFORT", "high"),
            ("CLAUDE_CODE_IGNORE_PERSISTED_TRUST", "1"),
            ("CLAUDE_CODE_USE_BEDROCK", "1"),
            ("PATH", "/bin"),
        ]
        .map(|(name, value)| (name.into(), value.into()))
        .into();
        let exe = ClaudeExe::Exe(PathBuf::from("claude"));

        let cmd = command(&exe, &env, Path::new("work")).unwrap();

        assert!(cmd.get_env("CLAUDECODE").is_none());
        assert!(cmd.get_env("claude_code_session_id").is_none());
        assert!(cmd.get_env("CLAUDE_EFFORT").is_none());
        assert!(cmd.get_env("CLAUDE_CODE_IGNORE_PERSISTED_TRUST").is_none());
        assert!(cmd.get_env("CLAUDE_CODE_USE_BEDROCK").is_some());
        assert!(cmd.get_env("PATH").is_some());
    }

    /// Started from an IDE's terminal, the app would otherwise pass on what
    /// makes Claude attach to that IDE.
    #[test]
    fn an_ides_terminal_variables_are_not_passed_on() {
        let ide = [
            "CLAUDE_CODE_SSE_PORT",
            "ENABLE_IDE_INTEGRATION",
            "FORCE_CODE_TERMINAL",
            "TERM_PROGRAM",
            "TERM_PROGRAM_VERSION",
            "TERMINAL_EMULATOR",
            "CURSOR_TRACE_ID",
        ];
        let env: Vec<(OsString, OsString)> = ide
            .iter()
            .map(|name| (name.into(), "1".into()))
            .chain([("PATH".into(), "/bin".into())])
            .collect();
        let exe = ClaudeExe::Exe(PathBuf::from("claude"));

        let cmd = command(&exe, &env, Path::new("work")).unwrap();

        for name in ide {
            assert!(cmd.get_env(name).is_none(), "{name}");
        }
        assert!(cmd.get_env("PATH").is_some());
    }

    fn claude_exe() -> (ClaudeExe, Vec<OsString>) {
        let path = PathBuf::from(r"C:\Program Files\Claude\claude.exe");
        (ClaudeExe::Exe(path.clone()), vec![path.into()])
    }

    #[test]
    fn a_prompt_is_one_prefill_argument_with_lf_line_endings() {
        let (exe, argv) = claude_exe();
        let cases = [
            ("hello", "--prefill=hello"),
            ("a\r\nb\rc\nd\r\n\r\n", "--prefill=a\nb\nc\nd\n\n"),
            ("-p print", "--prefill=-p print"),
            ("--help", "--prefill=--help"),
            (" ", "--prefill= "),
        ];
        for (prompt, arg) in cases {
            assert_eq!(
                prefill_arg(&exe, &argv, prompt),
                Ok(arg.into()),
                "{prompt:?}"
            );
        }
    }

    #[test]
    fn only_the_os_error_code_is_taken_from_a_spawn_error() {
        let cases = [
            (
                "CreateProcessW `\"p --prefill=x (os error 9)\"` failed: Not found. (os error 2)",
                Some(2),
            ),
            ("failed: Access is denied. (os error 5)", Some(5)),
            ("Unable to spawn p because it does not exist", None),
            ("failed (os error two)", None),
            ("failed (os error 2) after", None),
        ];
        for (text, code) in cases {
            assert_eq!(os_error_code(text), code, "{text}");
        }
    }

    /// Claude shows the prompt on its terminal, so a control character is
    /// shown as its picture instead of acting there.
    #[test]
    fn control_characters_become_their_pictures() {
        let (exe, argv) = claude_exe();
        let cases = [
            ("a\x1b[31mb", "a\u{241b}[31mb"),
            ("ding\x07", "ding\u{2407}"),
            (
                "\x01\x08\x0b\x0c\x1f",
                "\u{2401}\u{2408}\u{240b}\u{240c}\u{241f}",
            ),
            ("x\x7fy", "x\u{2421}y"),
            ("a\u{9b}31mb\u{80}\u{9f}", "a\u{fffd}31mb\u{fffd}\u{fffd}"),
            ("a\tb\nc", "a\tb\nc"),
            ("a\r\nb\rc", "a\nb\nc"),
        ];
        for (prompt, shown) in cases {
            let arg = format!("{PREFILL}{shown}");
            assert_eq!(
                prefill_arg(&exe, &argv, prompt),
                Ok(arg.into()),
                "{prompt:?}"
            );
        }
    }

    #[test]
    fn an_empty_prompt_is_not_passed() {
        let (exe, argv) = claude_exe();
        assert_eq!(prefill_arg(&exe, &argv, ""), Err(NoPrefill::Empty));
    }

    #[test]
    fn a_prompt_with_a_nul_is_not_passed() {
        let (exe, argv) = claude_exe();
        for prompt in ["a\0b", "\0"] {
            assert_eq!(prefill_arg(&exe, &argv, prompt), Err(NoPrefill::Nul));
        }
    }

    #[test]
    fn a_prompt_is_not_passed_through_cmd() {
        let shim = PathBuf::from(r"C:\npm\claude.cmd");
        let argv = command(&ClaudeExe::Cmd(shim.clone()), &[], Path::new("work"))
            .unwrap()
            .get_argv()
            .clone();
        let result = prefill_arg(&ClaudeExe::Cmd(shim), &argv, "hello");
        assert_eq!(result, Err(NoPrefill::ThroughCmd));
    }

    /// Each case is the command line as portable-pty's `cmdline` writes it.
    #[cfg(windows)]
    #[test]
    fn the_command_line_length_counts_what_portable_pty_writes() {
        let cases: [(&[&str], &str); 13] = [
            (&[r"C:\claude.exe"], r"C:\claude.exe"),
            (&[r"C:\claude.exe", "x"], r"C:\claude.exe x"),
            (
                &[r"C:\Program Files\claude.exe", "--prefill=a b"],
                r#""C:\Program Files\claude.exe" "--prefill=a b""#,
            ),
            (&["p", ""], r#"p """#),
            (&["p", r"a\b\"], r"p a\b\"),
            (&["p", r#"a"b"#], r#"p "a\"b""#),
            (&["p", r#"a\"b"#], r#"p "a\\\"b""#),
            (&["p", r#"a\\"b"#], r#"p "a\\\\\"b""#),
            (&["p", r"a b\"], r#"p "a b\\""#),
            (&["p", r"a\\ b"], r#"p "a\\ b""#),
            (&["p", "a\tb\nc\x0bd"], "p \"a\tb\nc\x0bd\""),
            (&["p", "%PATH%^&|<>"], "p %PATH%^&|<>"),
            (&["p", "é🎉", "q"], "p é🎉 q"),
        ];
        for (argv, line) in cases {
            let expected = line.encode_utf16().count() + 1;
            assert_eq!(
                command_line_len(argv.iter().map(OsStr::new)),
                expected,
                "{argv:?}"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_prompt_that_would_make_the_command_line_too_long_is_not_passed() {
        let (exe, argv) = claude_exe();
        let program = argv[0].as_os_str();
        let overhead = command_line_len([program, OsStr::new(PREFILL)]);
        let max = COMMAND_LINE_MAX - LAUNCHER_MARGIN;
        // An `x` adds one unit and no quoting.
        let fits = "x".repeat(max - overhead);
        let over = format!("{fits}x");
        assert!(prefill_arg(&exe, &argv, &fits).is_ok());
        assert_eq!(prefill_arg(&exe, &argv, &over), Err(NoPrefill::TooLong));
        // CreateProcess would take it, but a launcher may not.
        let in_margin = "x".repeat(COMMAND_LINE_MAX - overhead);
        assert_eq!(
            prefill_arg(&exe, &argv, &in_margin),
            Err(NoPrefill::TooLong)
        );

        // A space quotes the argument, and each quote takes a backslash.
        let quoted = format!("{} \"", "x".repeat(max - overhead - 5));
        let arg = format!("{PREFILL}{quoted}");
        assert_eq!(command_line_len([program, OsStr::new(&arg)]), max);
        assert!(prefill_arg(&exe, &argv, &quoted).is_ok());
        let over = format!("x{quoted}");
        assert_eq!(prefill_arg(&exe, &argv, &over), Err(NoPrefill::TooLong));
    }

    #[cfg(unix)]
    #[test]
    fn a_prompt_longer_than_an_argument_may_be_is_not_passed() {
        let path = PathBuf::from("/usr/local/bin/claude");
        let argv = [path.clone().into_os_string()];
        let exe = ClaudeExe::Exe(path);
        // The argument and its NUL fill the limit exactly.
        let fits = "x".repeat(ARG_MAX - PREFILL.len() - 1);
        let over = format!("{fits}x");
        assert!(prefill_arg(&exe, &argv, &fits).is_ok());
        assert_eq!(prefill_arg(&exe, &argv, &over), Err(NoPrefill::TooLong));
    }

    /// `launch` in `work` from an empty environment, with what it logged
    /// at info or above: portable-pty traces the environment it reads.
    fn launch_logged(
        exe: &ClaudeExe,
        prompt: Option<&str>,
    ) -> (Result<Launch, SessionError>, Vec<String>) {
        let (launch, log) = logged(|| launch(exe, &[], Path::new("work"), prompt));
        let log = log
            .into_iter()
            .filter(|line| !line.starts_with("TRACE ") && !line.starts_with("DEBUG "))
            .collect();
        (launch, log)
    }

    #[test]
    fn a_launch_passes_the_prompt_after_everything_else() {
        let exe = ClaudeExe::Exe(PathBuf::from("claude"));

        let (with, log) = launch_logged(&exe, Some("a\r\nb"));
        let without = launch(&exe, &[], Path::new("work"), None).unwrap();

        let with = with.unwrap();
        assert!(with.prefilled);
        assert_eq!(with.cmd.get_argv(), &["claude", "--prefill=a\nb"]);
        assert!(log.is_empty(), "{log:?}");
        assert!(!without.prefilled);
        assert_eq!(without.cmd.get_argv(), &["claude"]);
    }

    /// The reason is logged, once, and never the prompt.
    #[test]
    fn a_launch_without_its_prompt_logs_only_why() {
        let shim = ClaudeExe::Cmd(PathBuf::from(r"C:\npm\claude.cmd"));
        let exe = ClaudeExe::Exe(PathBuf::from("claude"));
        let cases = [
            (&shim, "secret plan", NoPrefill::ThroughCmd),
            (&exe, "", NoPrefill::Empty),
            (&exe, "secret\0plan", NoPrefill::Nul),
        ];
        for (exe, prompt, reason) in cases {
            let (launch, log) = launch_logged(exe, Some(prompt));

            let launch = launch.unwrap();
            assert!(!launch.prefilled);
            assert!(
                !launch
                    .cmd
                    .get_argv()
                    .iter()
                    .any(|arg| arg.to_string_lossy().starts_with(PREFILL))
            );
            assert_eq!(
                log,
                [format!(
                    "INFO starting Claude Code without the prompt: {reason}"
                )]
            );
        }
    }
}
