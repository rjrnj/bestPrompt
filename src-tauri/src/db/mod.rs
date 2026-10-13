//! SQLite data layer. Nothing in here depends on Tauri, so it is tested with
//! plain `cargo test` against in-memory databases.

pub mod builtins;
mod error;
pub mod migrate;
#[cfg(test)]
mod schema_tests;
#[cfg(test)]
mod test_support;

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

pub use error::DbError;

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
    use crate::db::test_support::foreign_keys_enabled;

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

    #[test]
    fn unix_millis_counts_from_1970() {
        assert_eq!(unix_millis(UNIX_EPOCH + Duration::from_millis(1500)), 1500);
    }

    #[test]
    fn clock_set_before_1970_reads_as_zero_instead_of_crashing() {
        assert_eq!(unix_millis(UNIX_EPOCH - Duration::from_secs(1)), 0);
    }
}
