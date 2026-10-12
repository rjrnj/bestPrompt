//! SQLite data layer. Nothing in here depends on Tauri, so it is tested with
//! plain `cargo test` against in-memory databases.

mod error;
pub mod migrate;

use std::path::Path;
use std::time::Duration;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn foreign_keys_enabled(conn: &Connection) -> bool {
        conn.pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap()
    }

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
}
