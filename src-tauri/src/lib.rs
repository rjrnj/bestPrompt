pub mod commands;
pub mod db;
mod window;

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use commands::Db;
use db::DbError;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Installed before the database opens: the data layer logs the full
        // text of SQLite errors through the `log` facade, and without a
        // backend those lines go nowhere. Writes to stdout and the app log dir.
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            open_database_or_exit(app);
            Ok(())
        });
    commands::register(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Why the app couldn't get a working database at startup.
#[derive(Debug, thiserror::Error)]
enum StartupError {
    #[error("could not resolve the app data directory: {0}")]
    AppDataDir(#[from] tauri::Error),
    #[error("could not create {path}: {source}")]
    CreateDataDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error(transparent)]
    Database(#[from] DbError),
}

/// Opens the database and puts it in managed state, then fits the main
/// window to the screen and shows it; `tauri.conf.json` creates it hidden.
/// If opening fails the window stays hidden, the user sees the error in a
/// dialog, and the app exits when they dismiss it, so nothing ever runs
/// against a missing database. Not a panic: the release build aborts on
/// panic with no message at all.
fn open_database_or_exit(app: &mut App) {
    match open_database(app.handle()) {
        Ok(conn) => {
            app.manage(Db(Mutex::new(conn)));
            match app.get_webview_window("main") {
                Some(window) => {
                    if let Err(error) = window::fit_to_screen(&window) {
                        log::warn!("could not fit the main window to the screen: {error}");
                    }
                    if let Err(error) = window.show() {
                        log::error!("could not show the main window: {error}");
                    }
                }
                None => log::error!("no main window to show"),
            }
        }
        Err(error) => {
            log::error!("startup failed: {error}");
            let handle = app.handle().clone();
            app.dialog()
                .message(format!("bestPrompt can't open its database.\n\n{error}"))
                .title("bestPrompt")
                .kind(MessageDialogKind::Error)
                .show(move |_| handle.exit(1));
        }
    }
}

fn open_database(app: &AppHandle) -> Result<Connection, StartupError> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir).map_err(|source| StartupError::CreateDataDir {
        path: dir.clone(),
        source,
    })?;
    let path = dir.join("bestprompt.db");
    log::info!("opening database {}", path.display());
    Ok(db::open_app_database(&path)?)
}
