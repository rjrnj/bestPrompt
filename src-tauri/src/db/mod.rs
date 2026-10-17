//! SQLite data layer. Nothing in here depends on Tauri, so it is tested with
//! plain `cargo test` against in-memory databases.

pub mod builtins;
pub mod entries;
mod error;
pub mod frameworks;
pub mod migrate;
pub mod projects;
#[cfg(test)]
mod schema_tests;
#[cfg(test)]
mod test_support;

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

pub use error::{DbError, Entity};

/// Opens (creating if needed) the database file at `path`.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    // WAL lets readers and the writer work without blocking each other. If the
    // filesystem can't support it, SQLite keeps its default journal mode, which
    // is slower but still correct, so the result is deliberately not checked.
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))?;
    Ok(conn)
}

/// Opens the app's database, ready to use: created if missing, migrated and
/// with the built-in frameworks seeded. An existing database is copied to a
/// backup next to it before any pending migration runs, so a migration that
/// goes wrong in a way the tests didn't catch still leaves the user's history
/// recoverable.
pub fn open_app_database(path: &Path) -> Result<Connection, DbError> {
    let existed = path.exists();
    let mut conn = open(path)?;
    if existed
        && let Some(version) = migrate::version_before_pending(&conn)?
        && has_any_table(&conn)?
    {
        backup(&conn, path, version)?;
    }
    migrate::migrate(&mut conn)?;
    builtins::seed_builtins(&mut conn)?;
    Ok(conn)
}

/// Whether the database holds anything at all. A file left behind by a launch
/// that failed before its first migration has no tables, and backing it up on
/// every retry would only pile up empty copies.
fn has_any_table(conn: &Connection) -> Result<bool, DbError> {
    let any = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'table')",
        [],
        |row| row.get(0),
    )?;
    Ok(any)
}

/// Copies the database to `<name>.v<version>.<time>.bak` in the same directory.
/// `VACUUM INTO` writes a consistent copy that includes changes still in the
/// WAL, which copying the file would miss.
fn backup(conn: &Connection, path: &Path, version: usize) -> Result<(), DbError> {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(format!(".v{version}.{}.bak", now_millis()));
    let backup_path = path.with_file_name(name);
    // SQLite takes the file name as text; a lossy conversion would write the
    // backup under a different name than the one reported.
    let Some(backup_path_text) = backup_path.to_str() else {
        return Err(DbError::BackupPathNotUnicode { path: backup_path });
    };
    log::info!("backing up database to {backup_path_text}");
    conn.execute("VACUUM INTO ?1", [backup_path_text])?;
    Ok(())
}

/// Opens a private in-memory database, used by tests.
pub fn open_in_memory() -> Result<Connection, DbError> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    Ok(conn)
}

/// Settings that SQLite applies per connection, not per database file.
fn configure(conn: &Connection) -> Result<(), DbError> {
    // Stock SQLite leaves foreign keys off, so REFERENCES clauses go unenforced.
    // rusqlite's bundled build happens to turn them on; setting it here keeps
    // that true regardless of how SQLite was built.
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}

/// The current time as the database stores it: UTC Unix milliseconds.
fn now_millis() -> i64 {
    unix_millis(SystemTime::now())
}

/// A clock set before 1970 reads as 0 rather than failing: a wrong timestamp
/// is better than an app that won't start.
fn unix_millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH).map_or(0, |since| {
        i64::try_from(since.as_millis()).unwrap_or(i64::MAX)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{count, foreign_keys_enabled};

    #[test]
    fn in_memory_database_enforces_foreign_keys() {
        let conn = open_in_memory().unwrap();
        assert!(foreign_keys_enabled(&conn));

        conn.execute_batch(
            "CREATE TABLE parent (id INTEGER PRIMARY KEY);
             CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent(id));",
        )
        .unwrap();
        let orphan = conn.execute("INSERT INTO child (parent_id) VALUES (1)", []);
        assert!(orphan.is_err(), "inserting an orphan row should fail");
    }

    #[test]
    fn file_database_enforces_foreign_keys_and_uses_wal() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("test.db")).unwrap();

        assert!(foreign_keys_enabled(&conn));
        let mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    fn backups(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".bak"))
            .collect();
        names.sort();
        names
    }

    /// A file name the platform allows but that isn't valid Unicode.
    #[cfg(windows)]
    fn not_unicode_file_name() -> std::ffi::OsString {
        use std::os::windows::ffi::OsStringExt;
        // "a", a lone surrogate, ".db"
        std::ffi::OsString::from_wide(&[0x61, 0xD800, 0x2E, 0x64, 0x62])
    }

    #[cfg(unix)]
    fn not_unicode_file_name() -> std::ffi::OsString {
        use std::os::unix::ffi::OsStringExt;
        std::ffi::OsString::from_vec(b"a\xff.db".to_vec())
    }

    /// SQLite takes the backup's file name as text, so a name that isn't
    /// Unicode can't be passed faithfully. It is refused outright rather
    /// than written under a substituted name.
    #[test]
    fn backup_refuses_a_file_name_that_is_not_unicode() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("app.db")).unwrap();
        let path = dir.path().join(not_unicode_file_name());

        let result = backup(&conn, &path, 0);

        assert!(
            matches!(result, Err(DbError::BackupPathNotUnicode { .. })),
            "{result:?}"
        );
        assert_eq!(backups(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn opening_a_new_app_database_migrates_and_seeds_it_without_a_backup() {
        let dir = tempfile::tempdir().unwrap();

        let conn = open_app_database(&dir.path().join("app.db")).unwrap();

        assert_eq!(
            count(&conn, "SELECT count(*) FROM frameworks WHERE is_custom = 0"),
            4
        );
        assert_eq!(backups(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn an_existing_database_is_backed_up_before_its_pending_migrations_run() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.db");
        // A database from before the first migration, with something in it.
        open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE old_stuff (id INTEGER PRIMARY KEY); INSERT INTO old_stuff VALUES (7);")
            .unwrap();

        open_app_database(&path).unwrap();

        let names = backups(dir.path());
        assert_eq!(names.len(), 1, "{names:?}");
        assert!(names[0].starts_with("app.db.v0."), "{}", names[0]);
        let backup = open(&dir.path().join(&names[0])).unwrap();
        assert_eq!(count(&backup, "SELECT id FROM old_stuff"), 7);
        assert_eq!(count(&backup, "PRAGMA user_version"), 0);
    }

    /// A file left by a launch that failed before its first migration holds
    /// nothing worth keeping, so it isn't backed up on every retry.
    #[test]
    fn an_existing_but_empty_database_is_not_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.db");
        drop(open(&path).unwrap());
        assert!(path.exists());

        open_app_database(&path).unwrap();

        assert_eq!(backups(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn an_up_to_date_database_is_not_backed_up_again() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.db");
        open_app_database(&path).unwrap();

        open_app_database(&path).unwrap();

        assert_eq!(backups(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn unix_millis_counts_from_1970() {
        assert_eq!(unix_millis(UNIX_EPOCH + Duration::from_millis(1500)), 1500);
    }

    #[test]
    fn clock_set_before_1970_reads_as_zero_instead_of_crashing() {
        assert_eq!(unix_millis(UNIX_EPOCH - Duration::from_secs(1)), 0);
    }
}
