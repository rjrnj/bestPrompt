//! The Tauri commands the webview can call. Each is a thin wrapper; the
//! logic and its tests live in `db`, `claude` and `terminal`.
//!
//! The commands are `async` so they run off the main thread; a sync command
//! would freeze the window for as long as the query takes. One, the folder
//! dialog, can wait for as long as the user likes, so it hands the wait to a
//! blocking thread and doesn't hold an async worker.

use std::sync::{Mutex, PoisonError};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Builder, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::claude::{ClaudeState, ClaudeStatus};
use crate::db::DbError;
use crate::db::entries::{self, EntryCursor, EntryQuery, NewPromptEntry, PromptEntry};
use crate::db::frameworks::{self, Framework, FrameworkInput};
use crate::db::projects::{self, Project};
use crate::db::settings::{self, Setting, Settings};
use crate::terminal::folders::{PickedFolders, allowed_folder};
use crate::terminal::{SessionError, SessionEvent, Sessions, StartedSession};

/// The app's database connection, held in Tauri's managed state.
pub struct Db(pub Mutex<Connection>);

impl Db {
    /// Runs `f` on the connection. A thread that panicked while holding the
    /// lock leaves the connection itself intact, so the poison is ignored.
    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, DbError>) -> Result<T, DbError> {
        let mut conn = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        f(&mut conn)
    }
}

/// Registers every command. Shared by the app and its tests.
pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        list_frameworks,
        get_framework,
        create_framework,
        update_framework,
        delete_framework,
        restore_framework,
        save_prompt_entry,
        list_prompt_entries,
        get_prompt_entry,
        set_entry_title,
        set_entry_project,
        delete_prompt_entry,
        latest_entry_project,
        list_projects,
        create_project,
        set_project_folder,
        rename_project,
        delete_project,
        claude_status,
        detect_claude,
        pick_folder,
        start_session,
        write_session,
        resize_session,
        paste_clipboard,
        close_session,
        get_settings,
        set_setting,
    ])
}

#[tauri::command(async)]
fn list_frameworks(db: State<'_, Db>) -> Result<Vec<Framework>, DbError> {
    db.with(|conn| frameworks::list_frameworks(conn))
}

#[tauri::command(async)]
fn get_framework(db: State<'_, Db>, id: String) -> Result<Framework, DbError> {
    db.with(|conn| frameworks::get_framework(conn, &id))
}

#[tauri::command(async)]
fn create_framework(db: State<'_, Db>, input: FrameworkInput) -> Result<Framework, DbError> {
    db.with(|conn| frameworks::create_framework(conn, &input))
}

#[tauri::command(async)]
fn update_framework(
    db: State<'_, Db>,
    id: String,
    input: FrameworkInput,
) -> Result<Framework, DbError> {
    db.with(|conn| frameworks::update_framework(conn, &id, &input))
}

#[tauri::command(async)]
fn delete_framework(db: State<'_, Db>, id: String) -> Result<Framework, DbError> {
    db.with(|conn| frameworks::delete_framework(conn, &id))
}

#[tauri::command(async)]
fn restore_framework(db: State<'_, Db>, id: String) -> Result<Framework, DbError> {
    db.with(|conn| frameworks::restore_framework(conn, &id))
}

#[tauri::command(async)]
fn save_prompt_entry(db: State<'_, Db>, entry: NewPromptEntry) -> Result<PromptEntry, DbError> {
    db.with(|conn| entries::save_prompt_entry(conn, &entry))
}

#[tauri::command(async)]
fn list_prompt_entries(
    db: State<'_, Db>,
    query: EntryQuery,
    limit: u32,
    after: Option<EntryCursor>,
) -> Result<Vec<PromptEntry>, DbError> {
    db.with(|conn| entries::list_prompt_entries(conn, &query, limit, after.as_ref()))
}

#[tauri::command(async)]
fn get_prompt_entry(db: State<'_, Db>, id: String) -> Result<PromptEntry, DbError> {
    db.with(|conn| entries::get_prompt_entry(conn, &id))
}

#[tauri::command(async)]
fn set_entry_title(
    db: State<'_, Db>,
    id: String,
    title: Option<String>,
) -> Result<PromptEntry, DbError> {
    db.with(|conn| entries::set_entry_title(conn, &id, title.as_deref()))
}

#[tauri::command(async)]
fn set_entry_project(
    db: State<'_, Db>,
    id: String,
    project_id: Option<String>,
) -> Result<PromptEntry, DbError> {
    db.with(|conn| entries::set_entry_project(conn, &id, project_id.as_deref()))
}

#[tauri::command(async)]
fn delete_prompt_entry(db: State<'_, Db>, id: String) -> Result<(), DbError> {
    db.with(|conn| entries::delete_prompt_entry(conn, &id))
}

#[tauri::command(async)]
fn latest_entry_project(db: State<'_, Db>) -> Result<Option<String>, DbError> {
    db.with(|conn| entries::latest_entry_project(conn))
}

#[tauri::command(async)]
fn list_projects(db: State<'_, Db>) -> Result<Vec<Project>, DbError> {
    db.with(|conn| projects::list_projects(conn))
}

/// Why a project command failed: the database refused, or the folder isn't
/// one the project may use. Both go to the webview as `{ kind, message }`.
#[derive(Debug, thiserror::Error, Serialize)]
#[serde(untagged)]
enum ProjectError {
    #[error(transparent)]
    Db(#[from] DbError),
    #[error(transparent)]
    Folder(#[from] SessionError),
}

/// The folders saved on projects, which a session may start in without a
/// fresh pick.
fn saved_folders(db: &Db) -> Result<Vec<String>, DbError> {
    let projects = db.with(|conn| projects::list_projects(conn))?;
    Ok(projects
        .into_iter()
        .filter_map(|project| project.folder)
        .collect())
}

/// The saved folders, or none if they couldn't be read. They only add
/// permission, so a failed read must not stop a picked folder from starting.
fn saved_or_none(saved: Result<Vec<String>, DbError>) -> Vec<String> {
    saved.unwrap_or_else(|error| {
        log::error!("couldn't read the saved project folders: {error}");
        Vec::new()
    })
}

#[tauri::command(async)]
fn create_project(
    db: State<'_, Db>,
    picked: State<'_, PickedFolders>,
    name: String,
    folder: Option<String>,
) -> Result<Project, ProjectError> {
    if let Some(folder) = &folder {
        allowed_folder(folder, &picked, &[])?;
    }
    Ok(db.with(|conn| projects::create_project(conn, &name, folder.as_deref()))?)
}

/// Sets the folder a project's sessions start in, or clears it with `null`.
/// A folder must be one picked this run, or the one the project already has.
#[tauri::command(async)]
fn set_project_folder(
    db: State<'_, Db>,
    picked: State<'_, PickedFolders>,
    id: String,
    folder: Option<String>,
) -> Result<Project, ProjectError> {
    if let Some(folder) = &folder {
        let current = db.with(|conn| {
            let listed = projects::list_projects(conn)?;
            let project = listed.into_iter().find(|project| project.id == id);
            Ok(project.map(|project| project.folder))
        })?;
        // The folder check runs before the update, so an unknown id (which
        // has no current folder) with a folder that wasn't picked is refused
        // as not chosen; the update reports an unknown id only after that.
        let stored: Vec<String> = current.flatten().into_iter().collect();
        allowed_folder(folder, &picked, &stored)?;
    }
    Ok(db.with(|conn| projects::set_project_folder(conn, &id, folder.as_deref()))?)
}

#[tauri::command(async)]
fn rename_project(db: State<'_, Db>, id: String, name: String) -> Result<Project, DbError> {
    db.with(|conn| projects::rename_project(conn, &id, &name))
}

#[tauri::command(async)]
fn delete_project(db: State<'_, Db>, id: String) -> Result<(), DbError> {
    db.with(|conn| projects::delete_project(conn, &id))
}

/// What detection found. Waits for startup detection first, on a worker
/// thread, so an early call doesn't report the CLI missing.
#[tauri::command(async)]
fn claude_status(claude: State<'_, ClaudeState>) -> ClaudeStatus {
    claude.wait_until_detected();
    claude.status()
}

/// Looks for the CLI again, once startup detection has read the
/// environment it searches.
#[tauri::command(async)]
fn detect_claude(claude: State<'_, ClaudeState>) -> ClaudeStatus {
    claude.wait_until_detected();
    claude.detect()
}

/// What a chosen folder is for, which decides how the chooser is titled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FolderPurpose {
    /// The folder Claude Code works in.
    Claude,
    /// A project's folder.
    Project,
}

/// The chooser's title for `purpose`; `None` keeps the system's default.
fn chooser_title(purpose: FolderPurpose) -> Option<&'static str> {
    match purpose {
        FolderPurpose::Claude => Some("Choose a folder for Claude Code"),
        FolderPurpose::Project => None,
    }
}

/// Asks the user for a folder and remembers it as one a session may start
/// in. `None` if they cancelled. The dialog stays open as long as the user
/// likes, so it waits on a blocking thread, not an async worker. The
/// calling window owns the dialog, so it can't be used until the dialog
/// closes.
#[tauri::command]
async fn pick_folder<R: Runtime>(
    window: tauri::WebviewWindow<R>,
    purpose: FolderPurpose,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let app = window.app_handle();
        let mut dialog = app.dialog().file().set_parent(&window);
        if let Some(title) = chooser_title(purpose) {
            dialog = dialog.set_title(title);
        }
        let path = dialog
            .blocking_pick_folder()?
            .into_path()
            .map_err(|error| log::warn!("the picked folder isn't a path: {error}"))
            .ok()?;
        let text = path
            .to_str()
            .or_else(|| {
                log::warn!("the picked folder's name isn't valid text");
                None
            })?
            .to_owned();
        app.state::<PickedFolders>().record(path);
        Some(text)
    })
    .await
    .unwrap_or_else(|error| {
        log::error!("the folder dialog failed: {error}");
        None
    })
}

/// Starts Claude Code in `folder`, which must be one the user chose, with
/// `prompt` in its input box if it can be passed. Output goes down `output`
/// as raw bytes; the exit goes down `events`.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
fn start_session(
    db: State<'_, Db>,
    claude: State<'_, ClaudeState>,
    sessions: State<'_, Sessions>,
    picked: State<'_, PickedFolders>,
    folder: String,
    cols: u16,
    rows: u16,
    prompt: Option<String>,
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<StartedSession, SessionError> {
    // Not `ClaudeNotFound` just because startup detection hasn't finished.
    claude.wait_until_detected();
    // A folder saved on a project may start a session without a fresh pick.
    let saved = saved_or_none(saved_folders(&db));
    let folder = allowed_folder(&folder, &picked, &saved)?;
    sessions.start(
        &claude,
        &folder,
        (cols, rows),
        prompt.as_deref(),
        move |chunk| {
            let _ = output.send(InvokeResponseBody::Raw(chunk.to_vec()));
        },
        move |code| {
            let _ = events.send(SessionEvent::Exited { code });
        },
    )
}

#[tauri::command(async)]
fn write_session(
    sessions: State<'_, Sessions>,
    id: String,
    data: String,
) -> Result<(), SessionError> {
    sessions.write(&id, data.as_bytes())
}

#[tauri::command(async)]
fn resize_session(
    sessions: State<'_, Sessions>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), SessionError> {
    sessions.resize(&id, cols, rows)
}

/// Pastes the system clipboard into the session. The text is read here and
/// goes straight to Claude: the webview is not allowed to read the clipboard.
/// A clipboard with no text pastes nothing.
#[tauri::command(async)]
fn paste_clipboard<R: Runtime>(
    app: AppHandle<R>,
    sessions: State<'_, Sessions>,
    id: String,
) -> Result<(), SessionError> {
    // An unknown session never touches the clipboard.
    sessions.paste(&id, "")?;
    let text = match app.clipboard().read_text() {
        Ok(text) => text,
        Err(error) => {
            log::info!("nothing to paste from the clipboard: {error}");
            return Ok(());
        }
    };
    sessions.paste(&id, &text)
}

#[tauri::command(async)]
fn close_session(sessions: State<'_, Sessions>, id: String) -> Result<(), SessionError> {
    sessions.close(&id)
}

#[tauri::command(async)]
fn get_settings(db: State<'_, Db>) -> Result<Settings, DbError> {
    db.with(|conn| settings::get_settings(conn))
}

#[tauri::command(async)]
fn set_setting(db: State<'_, Db>, setting: Setting) -> Result<(), DbError> {
    db.with(|conn| settings::set_setting(conn, &setting))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_folder_titles_the_claude_chooser() {
        assert_eq!(
            chooser_title(FolderPurpose::Claude),
            Some("Choose a folder for Claude Code")
        );
        assert_eq!(chooser_title(FolderPurpose::Project), None);
    }

    #[test]
    fn saved_folders_that_cannot_be_read_count_as_none() {
        assert!(saved_or_none(Err(DbError::BlankProjectName)).is_empty());
        assert_eq!(saved_or_none(Ok(vec!["/a".into()])), ["/a"]);
    }
}
