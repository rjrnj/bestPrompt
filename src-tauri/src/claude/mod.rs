//! Finds the Claude Code CLI and holds what sessions need to launch it: the
//! detected executable and the base environment.

mod env;

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use env::Env;

/// The CLI as found on disk. `Cmd` is a `.cmd` or `.bat` shim, which has to
/// be run as `cmd.exe /d /c <path>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaudeExe {
    Exe(PathBuf),
    Cmd(PathBuf),
}

impl ClaudeExe {
    pub fn path(&self) -> &Path {
        match self {
            ClaudeExe::Exe(p) | ClaudeExe::Cmd(p) => p,
        }
    }
}

/// Whether the CLI was found, for the webview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClaudeStatus {
    pub found: bool,
    pub path: Option<String>,
}

/// Searches `path_var`, then `extra_dirs`, for the CLI; the first hit wins.
/// With `pathext` (Windows) it tries `claude` plus each listed extension
/// that names a program or a batch file, `.exe` first and `.cmd`/`.bat`
/// last; without it, a plain `claude`. Empty and relative entries are
/// skipped.
pub fn find_claude(
    path_var: &OsStr,
    pathext: Option<&OsStr>,
    extra_dirs: &[PathBuf],
    is_file: impl Fn(&Path) -> bool,
) -> Option<ClaudeExe> {
    let names = candidates(pathext);
    std::env::split_paths(path_var)
        .chain(extra_dirs.iter().cloned())
        .filter(|dir| dir.is_absolute())
        .find_map(|dir| {
            names.iter().find_map(|(name, is_cmd)| {
                let path = dir.join(name);
                if !is_file(&path) {
                    return None;
                }
                Some(if *is_cmd {
                    ClaudeExe::Cmd(path)
                } else {
                    ClaudeExe::Exe(path)
                })
            })
        })
}

/// File names to try in each folder, with whether each is a `.cmd` shim.
fn candidates(pathext: Option<&OsStr>) -> Vec<(String, bool)> {
    let Some(pathext) = pathext else {
        return vec![("claude".to_string(), false)];
    };
    // Anything else PATHEXT lists, such as `.js` or `.ps1`, can't be
    // started the way these are.
    let mut names: Vec<(String, bool)> = pathext
        .to_string_lossy()
        .split(';')
        .map(|ext| ext.trim().to_lowercase())
        .filter_map(|ext| match ext.as_str() {
            ".exe" | ".com" => Some((format!("claude{ext}"), false)),
            ".cmd" | ".bat" => Some((format!("claude{ext}"), true)),
            _ => None,
        })
        .collect();
    // Stable, so the order within each group stays PATHEXT's.
    names.sort_by_key(|(name, is_cmd)| match (*is_cmd, name.as_str()) {
        (_, "claude.exe") => 0,
        (false, _) => 1,
        (true, _) => 2,
    });
    names.dedup();
    names
}

/// Folders the CLI's installers use that may not be on the app's `PATH`.
fn extra_dirs(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        dirs.push(home.join(".local").join("bin"));
    }
    if cfg!(windows)
        && let Some(appdata) = std::env::var_os("APPDATA")
    {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    if cfg!(target_os = "linux")
        && let Some(home) = home
    {
        dirs.push(home.join(".npm-global").join("bin"));
    }
    dirs
}

/// How long a command waits for startup detection before going on with
/// whatever is there, so a login shell that never answers can't hang it.
const DETECTION_WAIT: Duration = Duration::from_secs(30);

/// Managed state: what detection found and the environment sessions start
/// from.
pub struct ClaudeState {
    exe: Mutex<Option<ClaudeExe>>,
    base_env: Mutex<Env>,
    /// The app's home folder, if it could be found.
    home: Option<PathBuf>,
    /// Whether startup detection has finished, with its signal.
    detected: Mutex<bool>,
    detected_signal: Condvar,
}

impl ClaudeState {
    /// Starts with the app's own environment and nothing detected. Commands
    /// that need the result wait until `init` has run.
    pub fn new(home: Option<PathBuf>) -> Self {
        Self::with_detected(None, std::env::vars_os().collect(), home, false)
    }

    /// State with everything set up front and no detection, for tests.
    pub fn from_parts(exe: Option<ClaudeExe>, base_env: Env, home: Option<PathBuf>) -> Self {
        Self::with_detected(exe, base_env, home, true)
    }

    fn with_detected(
        exe: Option<ClaudeExe>,
        base_env: Env,
        home: Option<PathBuf>,
        detected: bool,
    ) -> Self {
        Self {
            exe: Mutex::new(exe),
            base_env: Mutex::new(base_env),
            home,
            detected: Mutex::new(detected),
            detected_signal: Condvar::new(),
        }
    }

    /// Reads the base environment (seconds on Linux) and detects the CLI
    /// with it, then lets waiting commands go on. Meant for a background
    /// thread at startup.
    pub fn init(&self) {
        self.init_with(env::base_env);
    }

    /// `init`, with `read_env` reading the base environment.
    fn init_with(&self, read_env: impl FnOnce() -> Env) {
        /// Marks detection done when dropped, so a panic while detecting
        /// still lets waiting commands go on rather than each wait out the
        /// bound.
        struct Finished<'a>(&'a ClaudeState);
        impl Drop for Finished<'_> {
            fn drop(&mut self) {
                self.0.detection_finished();
            }
        }

        let _finished = Finished(self);
        self.redetect_with(|| Some(read_env()));
    }

    /// Marks startup detection as done and wakes everything waiting on it.
    fn detection_finished(&self) {
        *self.detected.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.detected_signal.notify_all();
    }

    /// Blocks until startup detection has finished, or for at most
    /// `DETECTION_WAIT`, after which it goes on with whatever is there.
    pub fn wait_until_detected(&self) {
        if !self.wait_for_detection(DETECTION_WAIT) {
            log::warn!(
                "Claude Code detection is still running after {} s; going on without it",
                DETECTION_WAIT.as_secs()
            );
        }
    }

    /// Blocks until startup detection has finished or `limit` has passed.
    /// True if it finished.
    fn wait_for_detection(&self, limit: Duration) -> bool {
        let detected = self.detected.lock().unwrap_or_else(PoisonError::into_inner);
        let (detected, _) = self
            .detected_signal
            .wait_timeout_while(detected, limit, |done| !*done)
            .unwrap_or_else(PoisonError::into_inner);
        *detected
    }

    /// The environment sessions start from.
    pub fn base_env(&self) -> Env {
        self.base_env
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// The detected executable, if any.
    pub fn exe(&self) -> Option<ClaudeExe> {
        self.exe
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Reads the base environment again, so a CLI installed since startup is
    /// on the `PATH` searched, then detects with it. Sessions started
    /// afterwards use the new environment. When the environment can't be
    /// read, the one already held stays.
    pub fn redetect(&self) -> ClaudeStatus {
        self.redetect_with(env::read_base_env)
    }

    /// `redetect`, with `read_env` reading the base environment: None keeps
    /// the one held now.
    fn redetect_with(&self, read_env: impl FnOnce() -> Option<Env>) -> ClaudeStatus {
        if let Some(env) = read_env() {
            *self.base_env.lock().unwrap_or_else(PoisonError::into_inner) = env;
        }
        self.detect()
    }

    /// Looks for the CLI again and remembers the result.
    pub fn detect(&self) -> ClaudeStatus {
        let path_var = self
            .base_env()
            .into_iter()
            .find(|(name, _)| is_path_name(name))
            .map(|(_, value)| value)
            .or_else(|| std::env::var_os("PATH"))
            .unwrap_or_default();
        let pathext = cfg!(windows).then(|| {
            std::env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"))
        });
        let found = find_claude(
            &path_var,
            pathext.as_deref(),
            &extra_dirs(self.home.as_deref()),
            |p| p.is_file(),
        );
        *self.exe.lock().unwrap_or_else(PoisonError::into_inner) = found;
        self.status()
    }

    /// What the last detection found.
    pub fn status(&self) -> ClaudeStatus {
        let exe = self.exe();
        ClaudeStatus {
            found: exe.is_some(),
            path: exe.map(|e| e.path().to_string_lossy().into_owned()),
        }
    }
}

/// Windows environment names are case-insensitive (`Path`).
fn is_path_name(name: &OsStr) -> bool {
    if cfg!(windows) {
        name.eq_ignore_ascii_case("PATH")
    } else {
        name == "PATH"
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::ffi::OsString;

    use std::collections::VecDeque;
    use std::io::Read;

    use super::env::{parse_shell_env, read_to_marker, shell_env_for_sessions};
    use super::*;

    fn root() -> PathBuf {
        std::env::temp_dir().join("bp-claude-tests")
    }

    fn join(dirs: &[PathBuf]) -> OsString {
        std::env::join_paths(dirs).unwrap()
    }

    fn find(
        dirs: &[PathBuf],
        pathext: Option<&str>,
        extra: &[PathBuf],
        files: &[PathBuf],
    ) -> Option<ClaudeExe> {
        let files: HashSet<PathBuf> = files.iter().cloned().collect();
        find_claude(&join(dirs), pathext.map(OsStr::new), extra, |p| {
            files.contains(p)
        })
    }

    #[test]
    fn finds_claude_exe_on_path() {
        let bin = root().join("bin");
        let file = bin.join("claude.exe");
        let found = find(&[bin], Some(".EXE;.CMD"), &[], std::slice::from_ref(&file));
        assert_eq!(found, Some(ClaudeExe::Exe(file)));
    }

    #[test]
    fn finds_claude_cmd_when_no_exe() {
        let bin = root().join("bin");
        let file = bin.join("claude.cmd");
        let found = find(&[bin], Some(".EXE;.CMD"), &[], std::slice::from_ref(&file));
        assert_eq!(found, Some(ClaudeExe::Cmd(file)));
    }

    #[test]
    fn prefers_exe_over_cmd_in_the_same_folder() {
        let bin = root().join("bin");
        let exe = bin.join("claude.exe");
        let files = [bin.join("claude.cmd"), exe.clone()];
        let found = find(&[bin], Some(".CMD;.EXE"), &[], &files);
        assert_eq!(found, Some(ClaudeExe::Exe(exe)));
    }

    #[test]
    fn first_path_entry_wins() {
        let (a, b) = (root().join("a"), root().join("b"));
        let first = a.join("claude");
        let files = [b.join("claude"), first.clone()];
        let found = find(&[a, b], None, &[], &files);
        assert_eq!(found, Some(ClaudeExe::Exe(first)));
    }

    #[test]
    fn skips_empty_and_relative_entries() {
        let bin = root().join("bin");
        let file = bin.join("claude");
        let rel_file = PathBuf::from("rel").join("claude");
        let dirs = [PathBuf::from("rel"), bin];
        let found = find(&dirs, None, &[], &[rel_file.clone(), file.clone()]);
        assert_eq!(found, Some(ClaudeExe::Exe(file)));
        // An empty PATH entry must not resolve to the current folder either.
        let path = std::env::join_paths([PathBuf::new(), PathBuf::from("rel")]).unwrap();
        let files: HashSet<PathBuf> = [rel_file, PathBuf::from("claude")].into();
        let found = find_claude(&path, None, &[], |p| files.contains(p));
        assert_eq!(found, None);
    }

    #[test]
    fn honours_pathext_case_insensitively() {
        let bin = root().join("bin");
        let file = bin.join("claude.cmd");
        let found = find(
            &[bin],
            Some(".Com;.BAT;.CmD"),
            &[],
            std::slice::from_ref(&file),
        );
        assert_eq!(found, Some(ClaudeExe::Cmd(file)));
    }

    #[test]
    fn only_exe_com_cmd_and_bat_count() {
        let bin = root().join("bin");
        let cmd = bin.join("claude.cmd");
        let files = [bin.join("claude.js"), bin.join("claude.ps1"), cmd.clone()];
        let pathext = Some(".JS;.PS1;.VBS;.CMD");
        assert_eq!(
            find(std::slice::from_ref(&bin), pathext, &[], &files),
            Some(ClaudeExe::Cmd(cmd))
        );
        assert_eq!(
            find(std::slice::from_ref(&bin), Some(".JS;.PS1"), &[], &files),
            None
        );

        let com = bin.join("claude.com");
        let files = [bin.join("claude.bat"), com.clone()];
        let found = find(&[bin], Some(".bat;.Com"), &[], &files);
        assert_eq!(found, Some(ClaudeExe::Exe(com)));
    }

    #[test]
    fn falls_back_to_extra_dirs() {
        let (bin, extra) = (root().join("bin"), root().join("extra"));
        let file = extra.join("claude");
        let found = find(&[bin], None, &[extra], std::slice::from_ref(&file));
        assert_eq!(found, Some(ClaudeExe::Exe(file)));
    }

    #[test]
    fn none_when_absent() {
        let bin = root().join("bin");
        assert_eq!(
            find(
                std::slice::from_ref(&bin),
                None,
                std::slice::from_ref(&bin),
                &[]
            ),
            None
        );
        assert_eq!(find(&[bin], Some(".EXE;.CMD"), &[], &[]), None);
    }

    #[test]
    fn status_waits_for_detection_to_finish() {
        let state = std::sync::Arc::new(ClaudeState::new(None));
        let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let detector = {
            let (state, finished) = (state.clone(), finished.clone());
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));
                state.detect();
                finished.store(true, std::sync::atomic::Ordering::SeqCst);
                state.detection_finished();
            })
        };

        state.wait_until_detected();

        assert!(finished.load(std::sync::atomic::Ordering::SeqCst));
        detector.join().unwrap();
    }

    #[test]
    fn redetect_uses_a_fresh_environment() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        };
        std::fs::write(dir.path().join(name), b"").unwrap();
        let fresh: Env = vec![("PATH".into(), dir.path().into())];
        let state = ClaudeState::from_parts(None, vec![("PATH".into(), "".into())], None);
        assert!(!state.status().found);

        let status = state.redetect_with(|| Some(fresh.clone()));

        assert!(status.found, "{status:?}");
        assert_eq!(state.base_env(), fresh);
        assert_eq!(state.status(), status);
    }

    #[test]
    fn redetect_keeps_the_environment_it_has_when_none_can_be_read() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "claude.exe"
        } else {
            "claude"
        };
        std::fs::write(dir.path().join(name), b"").unwrap();
        let held: Env = vec![("PATH".into(), dir.path().into())];
        let state = ClaudeState::from_parts(None, held.clone(), None);

        let status = state.redetect_with(|| None);

        // Detected with the environment held, which stays for sessions.
        assert!(status.found, "{status:?}");
        assert_eq!(state.base_env(), held);
    }

    #[test]
    fn a_state_from_parts_does_not_wait() {
        let state = ClaudeState::from_parts(None, Vec::new(), None);
        let started = std::time::Instant::now();

        state.wait_until_detected();

        assert!(started.elapsed() < std::time::Duration::from_secs(1));
    }

    #[test]
    fn a_panic_during_detection_still_ends_the_wait() {
        let state = std::sync::Arc::new(ClaudeState::new(None));
        let detector = {
            let state = state.clone();
            std::thread::spawn(move || state.init_with(|| panic!("the shell blew up")))
        };

        assert!(detector.join().is_err());
        assert!(state.wait_for_detection(std::time::Duration::ZERO));
    }

    #[test]
    fn the_wait_gives_up_after_its_bound() {
        let state = ClaudeState::new(None);
        let started = std::time::Instant::now();

        let detected = state.wait_for_detection(std::time::Duration::from_millis(100));

        assert!(!detected);
        assert!(started.elapsed() >= std::time::Duration::from_millis(100));
    }

    #[test]
    fn parse_shell_env_reads_between_markers_ignoring_banners() {
        let out = b"welcome\nMARKA=1\0PATH=/bin:/usr/bin\0EMPTY=\0MARKtrailing";
        let env = parse_shell_env(out, "MARK").unwrap();
        let get = |k: &str| env.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        assert_eq!(get("A"), Some("1".into()));
        assert_eq!(get("PATH"), Some("/bin:/usr/bin".into()));
        assert_eq!(get("EMPTY"), Some("".into()));
        assert_eq!(env.len(), 3);
    }

    #[test]
    fn the_shells_probe_and_runtime_dir_are_not_kept() {
        let env: Vec<(OsString, OsString)> = [
            ("BESTPROMPT_RESOLVING_ENV", "1"),
            ("XDG_RUNTIME_DIR", "/run/user/shell"),
            ("PATH", "/bin"),
        ]
        .map(|(name, value)| (name.into(), value.into()))
        .into();

        let env = shell_env_for_sessions(env, Some("/run/user/app".into()));

        let names: Vec<_> = env.iter().map(|(name, _)| name.clone()).collect();
        assert_eq!(names, ["PATH", "XDG_RUNTIME_DIR"]);
        assert_eq!(env[1].1, "/run/user/app");
        let without = shell_env_for_sessions(vec![("XDG_RUNTIME_DIR".into(), "/x".into())], None);
        assert!(without.is_empty());
    }

    #[test]
    fn parse_shell_env_is_none_without_markers() {
        assert!(parse_shell_env(b"A=1\0B=2\0", "MARK").is_none());
        assert!(parse_shell_env(b"MARKA=1\0B=2\0", "MARK").is_none());
    }

    /// Hands out one chunk per read; an empty one is the end. Reading on
    /// after the last fails the test, as a pipe something still holds open
    /// would block.
    struct Chunks(VecDeque<&'static [u8]>);

    impl Read for Chunks {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let chunk = self.0.pop_front().expect("read on after the end marker");
            buf[..chunk.len()].copy_from_slice(chunk);
            Ok(chunk.len())
        }
    }

    #[test]
    fn the_login_shell_is_read_only_up_to_its_end_marker() {
        let chunks: [&[u8]; 4] = [b"banner MA", b"RKA=1\0B", b"=2\0MA", b"RK"];

        let bytes = read_to_marker(Chunks(chunks.into()), "MARK");

        let env = parse_shell_env(&bytes, "MARK").unwrap();
        let names: Vec<_> = env.iter().map(|(name, _)| name.clone()).collect();
        assert_eq!(names, ["A", "B"]);
    }

    #[test]
    fn output_without_the_end_marker_is_read_to_its_end() {
        let chunks: [&[u8]; 3] = [b"MARKA=1\0", b"B=2\0", b""];

        let bytes = read_to_marker(Chunks(chunks.into()), "MARK");

        assert_eq!(bytes, b"MARKA=1\0B=2\0");
        assert!(parse_shell_env(&bytes, "MARK").is_none());
    }
}
