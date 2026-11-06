//! The environment Claude Code sessions run with. A GUI app started from a
//! desktop launcher doesn't inherit the user's shell setup, so on Linux the
//! login shell is asked for its environment; elsewhere the app's own is used.

use std::ffi::OsString;
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

/// The environment sessions start from: the login shell's on Linux, the
/// app's own everywhere else or when the shell can't be read.
pub fn base_env() -> Env {
    #[cfg(target_os = "linux")]
    if let Some(env) = linux::login_shell_env() {
        return env;
    }
    std::env::vars_os().collect()
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
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    use super::{Env, RESOLVING_VAR, parse_shell_env, read_to_marker, shell_env_for_sessions};

    const TIMEOUT: Duration = Duration::from_secs(10);

    /// Runs the user's shell as an interactive login shell and reads its
    /// environment, giving up after ten seconds.
    pub fn login_shell_env() -> Option<Env> {
        let marker = uuid::Uuid::now_v7().to_string();
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
        let script = format!("printf '{marker}'; env -0; printf '{marker}'");
        let mut child = Command::new(shell)
            .args(["-i", "-l", "-c", &script])
            .env(RESOLVING_VAR, "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
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
