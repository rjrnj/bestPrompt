//! Making sure no process outlives its session or the app.
//!
//! On Windows each session's process goes into a job object that kills
//! everything in it when closed, nested under one job the app holds for its
//! whole life, so the processes go even if the app crashes. On Linux the
//! process leads its own process group, which is signalled as a whole.

use std::sync::{Mutex, PoisonError};
use std::thread::JoinHandle;

/// The process a session started and everything that process starts.
pub struct ProcessTree {
    tree: Mutex<Option<imp::Tree>>,
}

impl ProcessTree {
    /// Takes charge of the just-spawned process `pid`. An error is for the
    /// log; the caller should end the process itself.
    pub fn adopt(pid: u32) -> Result<Self, String> {
        Ok(Self {
            tree: Mutex::new(Some(imp::adopt(pid)?)),
        })
    }

    /// Ends every process in the tree. Ending can take a while (on Linux,
    /// a grace period before `SIGKILL`); it happens on a thread whose handle
    /// is returned, for a caller that wants to wait. Only the first call
    /// does anything.
    pub fn end(&self) -> Option<JoinHandle<()>> {
        let tree = self.lock().take()?;
        tree.end()
    }

    /// Called once the process itself has exited and been collected. If
    /// nothing it started is left either, the tree is forgotten, so its
    /// group id is never signalled after the system hands it out again.
    pub fn exited(&self) {
        let mut tree = self.lock();
        if tree.as_ref().is_some_and(imp::Tree::is_gone) {
            *tree = None;
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<imp::Tree>> {
        self.tree.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// A tree dropped without `end` still ends, as it would be if closed.
impl Drop for ProcessTree {
    fn drop(&mut self) {
        let _ = self.end();
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::sync::OnceLock;
    use std::thread::JoinHandle;

    use win32job::{ExtendedLimitInfo, Job};

    /// The rights `AssignProcessToJobObject` needs.
    const PROCESS_TERMINATE: u32 = 0x0001;
    const PROCESS_SET_QUOTA: u32 = 0x0100;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(
            desired_access: u32,
            inherit_handle: i32,
            process_id: u32,
        ) -> *mut std::ffi::c_void;
    }

    /// The session's own job; dropping it kills everything in it.
    pub struct Tree {
        _job: Job,
    }

    impl Tree {
        /// The job keeps whatever is left; dropping it is always safe.
        pub fn is_gone(&self) -> bool {
            false
        }

        pub fn end(self) -> Option<JoinHandle<()>> {
            None
        }
    }

    fn kill_on_close_job() -> Result<Job, String> {
        let mut info = ExtendedLimitInfo::new();
        info.limit_kill_on_job_close();
        Job::create_with_limit_info(&info).map_err(|e| format!("could not create a job: {e}"))
    }

    /// Created on first use and never closed, so its processes die with the
    /// app however it ends.
    fn app_job() -> Result<&'static Job, String> {
        static APP_JOB: OnceLock<Result<Job, String>> = OnceLock::new();
        APP_JOB
            .get_or_init(kill_on_close_job)
            .as_ref()
            .map_err(Clone::clone)
    }

    /// Puts the process in the app's job, then in a new job of its own.
    /// That order nests the session's job under the app's.
    ///
    /// The process is already running by then: portable-pty can't start
    /// it suspended. Anything it starts in that first moment escapes both
    /// jobs; Claude takes far longer than that to start anything.
    pub fn adopt(pid: u32) -> Result<Tree, String> {
        // SAFETY: no pointers are passed; a null result is checked before the
        // handle is owned and closed on drop.
        let process = unsafe {
            let raw = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if raw.is_null() {
                let error = std::io::Error::last_os_error();
                return Err(format!("could not open process {pid}: {error}"));
            }
            OwnedHandle::from_raw_handle(raw)
        };
        let handle = process.as_raw_handle() as isize;
        app_job()?
            .assign_process(handle)
            .map_err(|e| format!("could not add process {pid} to the app's job: {e}"))?;
        let job = kill_on_close_job()?;
        job.assign_process(handle)
            .map_err(|e| format!("could not add process {pid} to its session's job: {e}"))?;
        Ok(Tree { _job: job })
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::thread::JoinHandle;
    use std::time::{Duration, Instant};

    /// How long the group has to exit after `SIGTERM` before `SIGKILL`.
    const GRACE: Duration = Duration::from_secs(1);

    /// The session's process group. portable-pty makes the child a session
    /// leader, so its pid is the group's id.
    pub struct Tree {
        group: libc::pid_t,
    }

    pub fn adopt(pid: u32) -> Result<Tree, String> {
        // 0 and 1 would make `kill(-pid, ..)` signal this app's own group or
        // every process the user owns.
        match libc::pid_t::try_from(pid) {
            Ok(group) if group > 1 => Ok(Tree { group }),
            _ => Err(format!("unusable process id {pid}")),
        }
    }

    /// Whether nothing is left in the group. Signal 0 only asks; it isn't
    /// sent.
    fn group_is_gone(group: libc::pid_t) -> bool {
        // SAFETY: kill takes no pointers.
        let probe = unsafe { libc::kill(-group, 0) };
        probe != 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
    }

    impl Tree {
        pub fn is_gone(&self) -> bool {
            group_is_gone(self.group)
        }

        /// Does nothing once the group is empty; `ProcessTree::exited`
        /// forgets an empty group before its id can be handed out again.
        pub fn end(self) -> Option<JoinHandle<()>> {
            let group = self.group;
            if group_is_gone(group) {
                return None;
            }
            // SAFETY: kill takes no pointers; `group` is a group of ours.
            unsafe { libc::kill(-group, libc::SIGTERM) };
            Some(std::thread::spawn(move || {
                let deadline = Instant::now() + GRACE;
                while Instant::now() < deadline {
                    if group_is_gone(group) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                // SAFETY: as above.
                unsafe { libc::kill(-group, libc::SIGKILL) };
            }))
        }
    }
}

/// Other platforms aren't supported; their processes end only when they
/// exit by themselves.
#[cfg(not(any(windows, target_os = "linux")))]
mod imp {
    use std::thread::JoinHandle;

    pub struct Tree;

    pub fn adopt(_pid: u32) -> Result<Tree, String> {
        Ok(Tree)
    }

    impl Tree {
        pub fn is_gone(&self) -> bool {
            false
        }

        pub fn end(self) -> Option<JoinHandle<()>> {
            None
        }
    }
}
