//! The environment Claude Code sessions run with. A GUI app started from a
//! desktop launcher doesn't inherit the user's shell setup, so on Linux the
//! login shell is asked for its environment; elsewhere the app's own is used.

use std::ffi::{OsStr, OsString};
use std::io::Read;

pub type Env = Vec<(OsString, OsString)>;

/// Pulls the environment out of the output of `printf M; env -0; printf M`.
/// Only the bytes between the first two markers count, so banners a shell
/// prints around them are ignored. `None` if either marker is missing.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_shell_env(output: &[u8], marker: &str) -> Option<Env> {
    let marker = marker.as_bytes();
    let start = find(output, marker)? + marker.len();
    let len = find(&output[start..], marker)?;
    let vars = output[start..start + len]
        .split(|&b| b == 0)
        .filter_map(|entry| {
            let eq = entry.iter().position(|&b| b == b'=')?;
            (eq > 0).then(|| (to_os(&entry[..eq]), to_os(&entry[eq + 1..])))
        })
        .collect();
    Some(vars)
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

#[cfg(unix)]
fn to_os(bytes: &[u8]) -> OsString {
    use std::os::unix::ffi::OsStringExt;
    OsString::from_vec(bytes.to_vec())
}

#[cfg(not(unix))]
fn to_os(bytes: &[u8]) -> OsString {
    OsString::from(String::from_utf8_lossy(bytes).into_owned())
}

/// The login shell's environment as sessions get it: without the variable
/// that told the shell it is only being asked, and with the app's own
/// `XDG_RUNTIME_DIR`, which belongs to this desktop session, if it has one.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn shell_env_for_sessions(mut env: Env, runtime_dir: Option<OsString>) -> Env {
    env.retain(|(name, _)| name != RESOLVING_VAR && name != "XDG_RUNTIME_DIR");
    if let Some(dir) = runtime_dir {
        env.push(("XDG_RUNTIME_DIR".into(), dir));
    }
    env
}

/// Set for the login shell, so its startup files can tell it is only being
/// asked for its environment.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const RESOLVING_VAR: &str = "BESTPROMPT_RESOLVING_ENV";

/// Set by the AppImage's runtime and its startup scripts for the app's own
/// use. They aren't the user's: a program run in a session would pick up the
/// bundle's settings, and `PYTHONHOME` points at a folder with no Python, so
/// `python3` can't start.
const APPIMAGE_VARS: [&str; 15] = [
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "GTK_DATA_PREFIX",
    "GTK_THEME",
    "GSETTINGS_SCHEMA_DIR",
    "GI_TYPELIB_PATH",
    "GIO_MODULE_DIR",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "PYTHONHOME",
    "PYTHONDONTWRITEBYTECODE",
];

/// Lists the AppImage's launcher puts its own folders at the front of.
const APPIMAGE_LISTS: [&str; 8] = [
    "PATH",
    "LD_LIBRARY_PATH",
    "XDG_DATA_DIRS",
    "PYTHONPATH",
    "PERLLIB",
    "QT_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
];

/// `env` without the AppImage's own setup: the variables the AppImage sets
/// for itself are removed, and so are the `:`-separated list entries that are
/// empty (the launcher leaves one when a list was unset, and an empty entry
/// means the current folder) or that point into `appdir`. A list with
/// nothing left is removed. Everything else keeps its place, including the
/// plain `/usr/share` the GTK script adds to `XDG_DATA_DIRS`.
/// Only whole path components match: `/tmp/.mount_ab` doesn't match
/// `/tmp/.mount_abc/usr`.
pub fn without_appimage(env: Env, appdir: &OsStr) -> Env {
    let dir = trim_slashes(appdir.as_encoded_bytes());
    env.into_iter()
        .filter(|(name, _)| !APPIMAGE_VARS.iter().any(|v| name == v))
        .filter_map(|(name, value)| {
            if !APPIMAGE_LISTS.iter().any(|v| &name == v) {
                return Some((name, value));
            }
            let kept: Vec<&[u8]> = value
                .as_encoded_bytes()
                .split(|&b| b == b':')
                .filter(|entry| !entry.is_empty() && !is_under(entry, dir))
                .collect();
            if kept.is_empty() {
                return None;
            }
            // SAFETY: `kept` holds pieces of an `OsStr`'s encoded bytes cut
            // at `:`, an ASCII byte, so each is valid on its own; joining
            // them with `:` keeps that true.
            let joined = unsafe { OsString::from_encoded_bytes_unchecked(kept.join(&b':')) };
            Some((name, joined))
        })
        .collect()
}

/// `path` without its trailing slashes.
fn trim_slashes(mut path: &[u8]) -> &[u8] {
    while let Some(rest) = path.strip_suffix(b"/") {
        path = rest;
    }
    path
}

/// Whether `entry` is `dir` or a path below it.
fn is_under(entry: &[u8], dir: &[u8]) -> bool {
    entry
        .strip_prefix(dir)
        .is_some_and(|rest| rest.is_empty() || rest[0] == b'/')
}

/// The folder the app's AppImage is mounted at, when it was started from
/// one: both `APPIMAGE` and an `APPDIR` other than the root have to be set.
/// An empty `APPDIR` or the root must never count, since every absolute path
/// would be under it.
pub fn appimage_dir_from(appimage: Option<OsString>, appdir: Option<OsString>) -> Option<OsString> {
    appimage?;
    appdir.filter(|dir| !trim_slashes(dir.as_encoded_bytes()).is_empty())
}

/// `env` with the AppImage's setup removed when `appdir` is given, and as it
/// is otherwise.
pub fn outside_appimage(env: Env, appdir: Option<&OsStr>) -> Env {
    match appdir {
        Some(dir) => without_appimage(env, dir),
        None => env,
    }
}

/// `env` without the AppImage's setup, if the app itself runs from one.
pub fn outside_own_appimage(env: Env) -> Env {
    outside_appimage(env, own_appimage_dir().as_deref())
}

/// The folder the app's own AppImage is mounted at, if it runs from one.
fn own_appimage_dir() -> Option<OsString> {
    appimage_dir_from(std::env::var_os("APPIMAGE"), std::env::var_os("APPDIR"))
}

/// The environment the login shell is spawned with: the app's own, without
/// the AppImage's setup, so the shell's startup files run as they would from
/// a terminal.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn shell_start_env(app_env: Env, appdir: Option<&OsStr>) -> Env {
    outside_appimage(app_env, appdir)
}

/// The base environment: the login shell's output as it is, since the shell
/// started clean and what it prints is the user's own; the app's own
/// environment without the AppImage's setup when the shell couldn't be read.
pub fn base_env_from(shell: Option<Env>, app_env: Env, appdir: Option<&OsStr>) -> Env {
    shell.unwrap_or_else(|| outside_appimage(app_env, appdir))
}

/// The environment sessions start from, read now: the login shell's on
/// Linux, the app's own everywhere else. None when the login shell can't
/// be read.
pub fn read_base_env() -> Option<Env> {
    #[cfg(target_os = "linux")]
    return linux::login_shell_env(
        shell_start_env(std::env::vars_os().collect(), own_appimage_dir().as_deref()),
        std::env::var_os("HOME")
            .filter(|home| !home.is_empty())
            .map(Into::into),
    );
    #[cfg(not(target_os = "linux"))]
    Some(outside_own_appimage(std::env::vars_os().collect()))
}

/// `read_base_env`, falling back to the app's own environment when the
/// login shell can't be read. Either way the AppImage's own setup is left
/// out.
pub fn base_env() -> Env {
    base_env_from(
        read_base_env(),
        std::env::vars_os().collect(),
        own_appimage_dir().as_deref(),
    )
}

/// Reads the login shell's output until both markers have arrived, or the
/// output ends, and returns what was read. Something the shell's setup
/// started in the background may hold the pipe open long after that, so
/// nothing is read past the second marker.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn read_to_marker(mut reader: impl Read, marker: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                bytes.extend_from_slice(&buf[..n]);
                if parse_shell_env(&bytes, marker).is_some() {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => break,
        }
    }
    bytes
}

#[cfg(target_os = "linux")]
mod linux {
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    use super::{Env, RESOLVING_VAR, parse_shell_env, read_to_marker, shell_env_for_sessions};

    const TIMEOUT: Duration = Duration::from_secs(10);

    /// Runs the user's shell as an interactive login shell, started in
    /// `home` with exactly `start_env`, and reads its environment, giving up
    /// after ten seconds.
    pub fn login_shell_env(start_env: Env, home: Option<PathBuf>) -> Option<Env> {
        let marker = uuid::Uuid::now_v7().to_string();
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
        let script = format!("printf '{marker}'; env -0; printf '{marker}'");
        let mut command = Command::new(shell);
        command
            .args(["-i", "-l", "-c", &script])
            .env_clear()
            .envs(start_env)
            .env(RESOLVING_VAR, "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // The AppImage's launcher moves into its own folder; the shell
        // starts where a terminal would.
        if let Some(home) = home {
            command.current_dir(home);
        }
        let mut child = command
            .spawn()
            .map_err(|e| log::warn!("could not start the login shell: {e}"))
            .ok()?;
        let stdout = child.stdout.take()?;
        let (tx, rx) = mpsc::channel();
        let end = marker.clone();
        std::thread::spawn(move || {
            let _ = tx.send(read_to_marker(stdout, &end));
        });
        let read = rx.recv_timeout(TIMEOUT);
        // Either way the shell is done with: it may still be finishing its
        // setup, or be stuck. Nothing waits on the pipe.
        if !matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.kill();
        }
        let _ = child.wait();
        let Ok(bytes) = read else {
            log::warn!("the login shell took too long; using the app's environment");
            return None;
        };
        let env = parse_shell_env(&bytes, &marker)?;
        Some(shell_env_for_sessions(
            env,
            std::env::var_os("XDG_RUNTIME_DIR"),
        ))
    }
}
