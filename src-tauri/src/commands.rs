//! The Tauri commands the webview can call. Each is a thin wrapper around a
//! data-layer function; the logic and its tests live in `db`.
//!
//! The commands are `async` so they run off the main thread; a sync command
//! would freeze the window for as long as the query takes.

use std::sync::{Mutex, PoisonError};

use rusqlite::Connection;
use tauri::{Builder, Runtime, State};

use crate::db::DbError;
use crate::db::entries::{self, NewPromptEntry, PromptEntry};
use crate::db::frameworks::{self, Framework};

/// The app's database connection, held in Tauri's managed state.
pub struct Db(pub Mutex<Connection>);

impl Db {
    /// Runs `f` on the connection. A thread that panicked while holding the
    /// lock leaves the connection itself intact, so the poison is ignored.
    fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T, DbError>) -> Result<T, DbError> {
        let conn = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        f(&conn)
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
    ])
}

#[tauri::command(async)]
fn list_frameworks(db: State<'_, Db>) -> Result<Vec<Framework>, DbError> {
    db.with(frameworks::list_frameworks)
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
    limit: u32,
    offset: u32,
) -> Result<Vec<PromptEntry>, DbError> {
    db.with(|conn| entries::list_prompt_entries(conn, limit, offset))
}

#[tauri::command(async)]
fn get_prompt_entry(db: State<'_, Db>, id: String) -> Result<PromptEntry, DbError> {
    db.with(|conn| entries::get_prompt_entry(conn, &id))
}
