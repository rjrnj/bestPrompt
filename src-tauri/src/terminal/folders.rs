//! Which folders a session may start in: only ones the user chose.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use super::SessionError;

/// A key for comparing chosen folders: forward slashes on Windows, no
/// verbatim prefix, no trailing slash, and on Windows no case.
fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy();
    let key = if cfg!(windows) {
        let plain = text.strip_prefix(r"\\?\").unwrap_or(&text);
        plain.replace('\\', "/").to_lowercase()
    } else {
        text.into_owned()
    };
    let trimmed = key.trim_end_matches('/');
    // A root keeps its slash (`/`, `C:/`), but a bare `C:` is the drive's
    // current folder, not its root.
    let is_root =
        trimmed.is_empty() || (cfg!(windows) && trimmed.len() == 2 && trimmed.ends_with(':'));
    if !is_root {
        trimmed.to_owned()
    } else if key.len() > trimmed.len() {
        format!("{trimmed}/")
    } else {
        key
    }
}

/// Folders the user picked in the folder dialog this run.
#[derive(Default)]
pub struct PickedFolders {
    folders: Mutex<HashSet<String>>,
}

impl PickedFolders {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, folder: PathBuf) {
        self.lock().insert(path_key(&folder));
    }

    pub fn contains(&self, folder: &Path) -> bool {
        self.lock().contains(&path_key(folder))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.folders.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The folder as a path, if it is absolute, was picked or is in `stored`,
/// and still exists as a directory.
pub fn allowed_folder(
    folder: &str,
    picked: &PickedFolders,
    stored: &[String],
) -> Result<PathBuf, SessionError> {
    let path = PathBuf::from(folder);
    if !path.is_absolute() {
        return Err(SessionError::FolderNotChosen);
    }
    let key = path_key(&path);
    let chosen = picked.contains(&path)
        || stored
            .iter()
            .any(|s| !s.is_empty() && path_key(Path::new(s)) == key);
    if !chosen {
        return Err(SessionError::FolderNotChosen);
    }
    if !path.is_dir() {
        return Err(SessionError::FolderMissing);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refused(result: Result<PathBuf, SessionError>) -> bool {
        matches!(result, Err(SessionError::FolderNotChosen))
    }

    #[test]
    fn a_folder_never_picked_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().to_str().unwrap();
        assert!(refused(allowed_folder(folder, &PickedFolders::new(), &[])));
    }

    #[test]
    fn a_missing_folder_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone");
        std::fs::create_dir(&gone).unwrap();
        let picked = PickedFolders::new();
        picked.record(gone.clone());
        std::fs::remove_dir(&gone).unwrap();
        let result = allowed_folder(gone.to_str().unwrap(), &picked, &[]);
        assert!(matches!(result, Err(SessionError::FolderMissing)));
    }

    #[test]
    fn a_file_is_not_a_folder() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file.txt");
        std::fs::write(&file, "x").unwrap();
        let picked = PickedFolders::new();
        picked.record(file.clone());
        let error = allowed_folder(file.to_str().unwrap(), &picked, &[]).unwrap_err();
        assert!(matches!(error, SessionError::FolderMissing));
        assert_eq!(error.to_string(), "That folder no longer exists.");
    }

    #[test]
    fn an_empty_stored_entry_allows_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let stored = [String::new()];
        for folder in [dir.path().to_str().unwrap(), "", "/"] {
            assert!(refused(allowed_folder(
                folder,
                &PickedFolders::new(),
                &stored
            )));
        }
    }

    #[test]
    fn a_relative_folder_is_refused() {
        let picked = PickedFolders::new();
        picked.record(PathBuf::from("relative"));
        assert!(refused(allowed_folder(
            "relative",
            &picked,
            &["relative".to_owned()]
        )));
        assert!(refused(allowed_folder("", &picked, &[])));
    }

    #[test]
    fn a_picked_folder_is_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let picked = PickedFolders::new();
        picked.record(dir.path().to_path_buf());
        assert!(picked.contains(dir.path()));
        let result = allowed_folder(dir.path().to_str().unwrap(), &picked, &[]);
        assert_eq!(result.unwrap(), dir.path());
    }

    #[test]
    fn a_stored_project_folder_is_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().to_str().unwrap().to_owned();
        let result = allowed_folder(
            &folder,
            &PickedFolders::new(),
            std::slice::from_ref(&folder),
        );
        assert_eq!(result.unwrap(), dir.path());
    }

    #[test]
    fn a_root_keeps_its_slash() {
        assert_eq!(path_key(Path::new("/")), "/");
        assert_ne!(path_key(Path::new("/")), path_key(Path::new("")));
    }

    #[cfg(not(windows))]
    #[test]
    fn a_backslash_is_not_a_separator_off_windows() {
        assert_ne!(path_key(Path::new(r"/a\b")), path_key(Path::new("/a/b")));
    }

    #[cfg(windows)]
    #[test]
    fn windows_roots_keep_their_slash_and_a_bare_drive_is_not_a_root() {
        assert_eq!(path_key(Path::new(r"C:\")), path_key(Path::new("C:/")));
        assert_eq!(path_key(Path::new("C:/")), "c:/");
        assert_ne!(path_key(Path::new("C:")), path_key(Path::new(r"C:\")));
    }

    #[cfg(windows)]
    #[test]
    fn a_verbatim_prefix_is_ignored() {
        assert_eq!(
            path_key(Path::new(r"\\?\C:\x")),
            path_key(Path::new(r"C:\x"))
        );
        assert_eq!(path_key(Path::new(r"\\?\C:\X\y\")), "c:/x/y");
    }

    #[cfg(windows)]
    #[test]
    fn path_keys_ignore_case_on_windows() {
        assert_eq!(
            path_key(Path::new(r"c:\DEV\App\")),
            path_key(Path::new(r"C:\dev\app"))
        );
    }
}
