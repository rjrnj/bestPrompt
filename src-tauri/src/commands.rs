//! The Tauri commands the webview can call. Each is a thin wrapper; the
//! logic and its tests live in `db`, `claude` and `terminal`.
//!
//! The commands are `async` so they run off the main thread; a sync command
//! would freeze the window for as long as the query takes. One, the folder
//! dialog, can wait for as long as the user likes, so it hands the wait to a
//! blocking thread and doesn't hold an async worker.

use std::sync::{Mutex, PoisonError};

use rusqlite::Connection;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Builder, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

use crate::claude::{ClaudeState, ClaudeStatus};
use crate::db::DbError;
use crate::db::entries::{self, EntryCursor, EntryQuery, NewPromptEntry, PromptEntry};
use crate::db::frameworks::{self, Framework, FrameworkInput};
use crate::db::projects::{self, Project};
use crate::terminal::folders::{PickedFolders, allowed_folder};
use crate::terminal::{SessionError, SessionEvent, Sessions};

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

#[tauri::command(async)]
fn create_project(db: State<'_, Db>, name: String) -> Result<Project, DbError> {
    db.with(|conn| projects::create_project(conn, &name))
}

#[tauri::command(async)]
fn rename_project(db: State<'_, Db>, id: String, name: String) -> Result<Project, DbError> {
    db.with(|conn| projects::rename_project(conn, &id, &name))
}

#[tauri::command(async)]
fn delete_project(db: State<'_, Db>, id: String) -> Result<(), DbError> {
    db.with(|conn| projects::delete_project(conn, &id))
}

#[tauri::command(async)]
fn claude_status(claude: State<'_, ClaudeState>) -> ClaudeStatus {
    claude.status()
}

#[tauri::command(async)]
fn detect_claude(claude: State<'_, ClaudeState>) -> ClaudeStatus {
    claude.detect()
}

/// Asks the user for a folder and remembers it as one a session may start
/// in. `None` if they cancelled. The dialog stays open as long as the user
/// likes, so it waits on a blocking thread, not an async worker.
#[tauri::command]
async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .dialog()
            .file()
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

/// Starts Claude Code in `folder`, which must be one the user chose.
/// Output goes down `output` as raw bytes; the exit goes down `events`.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
fn start_session(
    claude: State<'_, ClaudeState>,
    sessions: State<'_, Sessions>,
    picked: State<'_, PickedFolders>,
    folder: String,
    cols: u16,
    rows: u16,
    output: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<String, SessionError> {
    // Saved project folders join the picked ones here once projects have them.
    let folder = allowed_folder(&folder, &picked, &[])?;
    sessions.start(
        &claude,
        &folder,
        (cols, rows),
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
