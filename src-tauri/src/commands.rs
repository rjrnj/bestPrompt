//! The Tauri commands the webview can call. Each is a thin wrapper around a
//! data-layer function; the logic and its tests live in `db`.
//!
//! The commands are `async` so they run off the main thread; a sync command
//! would freeze the window for as long as the query takes.

use std::sync::{Mutex, PoisonError};

use rusqlite::Connection;
use tauri::{Builder, Runtime, State};

use crate::db::DbError;
use crate::db::entries::{self, EntryCursor, EntryQuery, NewPromptEntry, PromptEntry};
use crate::db::frameworks::{self, Framework};
use crate::db::projects::{self, Project};

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
