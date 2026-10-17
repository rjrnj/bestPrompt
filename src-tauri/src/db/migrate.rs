//! Schema migrations, tracked with SQLite's `user_version` header field.
//!
//! `user_version` holds how many migrations have been applied. Each pending
//! migration runs in its own transaction together with its version bump, so a
//! failure leaves the database at the last migration that succeeded.
//!
//! Foreign keys are switched off while migrations run, so a migration can
//! rebuild a table (SQLite's create, copy, drop, rename procedure) without the
//! drop firing `ON DELETE` actions on the tables that reference it. Before each
//! migration commits, `PRAGMA foreign_key_check` must come back clean, so a
//! migration that really breaks a reference still fails. Because each migration
//! already runs inside a transaction, a migration file must not contain
//! `BEGIN`/`COMMIT` or change `PRAGMA foreign_keys` itself.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};

use super::DbError;

/// The app's migrations, in order. Never edit or reorder a migration that has
/// shipped; add a new one to the end instead.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_initial.sql"),
    include_str!("migrations/002_history.sql"),
    include_str!("migrations/003_entry_version.sql"),
];

/// The schema version of a database that `migrate` would have to change,
/// or `None` if it is already current (or newer, which `migrate` refuses).
pub fn version_before_pending(conn: &Connection) -> Result<Option<usize>, DbError> {
    let current = user_version(conn)?;
    Ok((current < MIGRATIONS.len()).then_some(current))
}

/// Brings the database up to the latest schema version.
pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    apply(conn, MIGRATIONS)
}

fn apply(conn: &mut Connection, migrations: &[&str]) -> Result<(), DbError> {
    // SQLite ignores this pragma inside a transaction, so it has to be set here,
    // before any migration's transaction starts.
    conn.pragma_update(None, "foreign_keys", false)?;
    let result = apply_pending(conn, migrations);
    // Restore foreign keys whether or not a migration failed.
    let restored = conn.pragma_update(None, "foreign_keys", true);
    result?;
    restored?;
    Ok(())
}

fn apply_pending(conn: &mut Connection, migrations: &[&str]) -> Result<(), DbError> {
    loop {
        // IMMEDIATE takes the write lock before the version is read, so if two
        // copies of the app start at once, the second waits (busy_timeout) and
        // then sees the first one's migrations instead of re-running them.
        // An early return drops `tx`, which rolls it back.
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = user_version(&tx)?;
        if current > migrations.len() {
            return Err(DbError::SchemaTooNew {
                found: current,
                supported: migrations.len(),
            });
        }
        let Some(sql) = migrations.get(current) else {
            return Ok(());
        };

        // Migration N leaves the database at version N.
        let version = current + 1;
        tx.execute_batch(sql)?;
        if let Some(table) = first_foreign_key_violation(&tx)? {
            return Err(DbError::MigrationBrokeForeignKey { version, table });
        }
        set_user_version(&tx, version)?;
        tx.commit()?;
    }
}

fn first_foreign_key_violation(conn: &Connection) -> Result<Option<String>, DbError> {
    let table = conn
        .query_row(
            "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(table)
}

fn user_version(conn: &Connection) -> Result<usize, DbError> {
    let version: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    // Lossless: usize is at least 32 bits on every platform the app targets.
    Ok(version as usize)
}

fn set_user_version(conn: &Connection, version: usize) -> Result<(), DbError> {
    // user_version is a 32-bit header field; the app will never have that many migrations.
    let version = u32::try_from(version).expect("migration count fits in user_version");
    conn.pragma_update(None, "user_version", version)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{count, foreign_keys_enabled, table_exists};
    use crate::db::{open, open_in_memory};
    use std::thread;
    use std::time::Duration;

    // Plain CREATE TABLE (no IF NOT EXISTS), so applying one twice would fail.
    const TWO_MIGRATIONS: &[&str] = &[
        "CREATE TABLE first (id INTEGER PRIMARY KEY);",
        "CREATE TABLE second (id INTEGER PRIMARY KEY);",
    ];

    // A parent table with two kinds of children, mirroring the app's schema:
    // one child is deleted with its parent, the other only loses its link.
    const PARENT_AND_CHILDREN: &str = "
        CREATE TABLE parent (id TEXT PRIMARY KEY);
        CREATE TABLE cascade_child (
            parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE
        );
        CREATE TABLE set_null_child (
            parent_id TEXT REFERENCES parent(id) ON DELETE SET NULL
        );
        INSERT INTO parent VALUES ('p');
        INSERT INTO cascade_child VALUES ('p'), ('p');
        INSERT INTO set_null_child VALUES ('p');
    ";

    #[test]
    fn app_migrations_apply_to_a_fresh_database() {
        let mut conn = open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(user_version(&conn).unwrap(), MIGRATIONS.len());
    }

    #[test]
    fn entries_saved_before_versions_start_at_version_zero() {
        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, &MIGRATIONS[..2]).unwrap();
        conn.execute(
            "INSERT INTO prompt_entries (id, framework_snapshot, section_values, rendered_prompt, created_at)
             VALUES ('e', '{}', '{}', 'rendered', 0)",
            [],
        )
        .unwrap();

        apply(&mut conn, MIGRATIONS).unwrap();

        assert_eq!(
            count(&conn, "SELECT version FROM prompt_entries WHERE id = 'e'"),
            0
        );
    }

    #[test]
    fn migration_backfills_the_fts_index_for_existing_entries() {
        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, &MIGRATIONS[..1]).unwrap();
        conn.execute(
            "INSERT INTO prompt_entries (id, framework_snapshot, section_values, rendered_prompt, created_at)
             VALUES ('e', '{}', '{\"a\":\"needle here\",\"b\":\"other\"}', 'rendered', 0)",
            [],
        )
        .unwrap();

        apply(&mut conn, MIGRATIONS).unwrap();

        let found: Vec<String> = conn
            .prepare(
                "SELECT entry_id FROM prompt_entries_fts WHERE prompt_entries_fts MATCH 'needle'",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(found, ["e"]);
        assert_eq!(count(&conn, "SELECT count(*) FROM prompt_entries_fts"), 1);
    }

    #[test]
    fn fresh_database_gets_every_migration() {
        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, TWO_MIGRATIONS).unwrap();

        assert_eq!(user_version(&conn).unwrap(), 2);
        assert!(table_exists(&conn, "first"));
        assert!(table_exists(&conn, "second"));
    }

    #[test]
    fn running_again_is_a_no_op() {
        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, TWO_MIGRATIONS).unwrap();
        apply(&mut conn, TWO_MIGRATIONS).unwrap();

        assert_eq!(user_version(&conn).unwrap(), 2);
    }

    #[test]
    fn older_database_gets_only_missing_migrations() {
        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, &TWO_MIGRATIONS[..1]).unwrap();
        assert_eq!(user_version(&conn).unwrap(), 1);

        apply(&mut conn, TWO_MIGRATIONS).unwrap();
        assert_eq!(user_version(&conn).unwrap(), 2);
        assert!(table_exists(&conn, "second"));
    }

    #[test]
    fn failing_migration_rolls_back_and_keeps_earlier_ones() {
        let mut conn = open_in_memory().unwrap();
        let migrations = [
            "CREATE TABLE first (id INTEGER PRIMARY KEY);",
            // The CREATE succeeds before the syntax error, so it must be rolled back.
            "CREATE TABLE half_done (id INTEGER PRIMARY KEY); NOT VALID SQL;",
        ];

        let result = apply(&mut conn, &migrations);

        assert!(matches!(result, Err(DbError::Sqlite(_))));
        assert_eq!(user_version(&conn).unwrap(), 1);
        assert!(table_exists(&conn, "first"));
        assert!(!table_exists(&conn, "half_done"));
    }

    #[test]
    fn newer_database_is_refused_and_left_untouched() {
        let mut conn = open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();

        let result = apply(&mut conn, TWO_MIGRATIONS);

        assert!(matches!(
            result,
            Err(DbError::SchemaTooNew {
                found: 3,
                supported: 2
            })
        ));
        assert_eq!(user_version(&conn).unwrap(), 3);
        assert!(!table_exists(&conn, "first"));
    }

    #[test]
    fn rebuilding_a_parent_table_keeps_child_rows() {
        let mut conn = open_in_memory().unwrap();
        let migrations = [
            PARENT_AND_CHILDREN,
            // SQLite's procedure for changing a table's definition.
            "CREATE TABLE parent_new (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
             INSERT INTO parent_new (id) SELECT id FROM parent;
             DROP TABLE parent;
             ALTER TABLE parent_new RENAME TO parent;",
        ];

        apply(&mut conn, &migrations).unwrap();

        assert_eq!(user_version(&conn).unwrap(), 2);
        assert_eq!(count(&conn, "SELECT count(*) FROM cascade_child"), 2);
        assert_eq!(
            count(
                &conn,
                "SELECT count(*) FROM set_null_child WHERE parent_id = 'p'"
            ),
            1
        );
    }

    #[test]
    fn migration_that_breaks_a_reference_is_rejected() {
        let mut conn = open_in_memory().unwrap();
        let migrations = [PARENT_AND_CHILDREN, "DELETE FROM parent;"];

        let result = apply(&mut conn, &migrations);

        assert!(matches!(
            result,
            Err(DbError::MigrationBrokeForeignKey { version: 2, .. })
        ));
        assert_eq!(user_version(&conn).unwrap(), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM parent"), 1);
    }

    #[test]
    fn foreign_keys_are_back_on_after_success_and_failure() {
        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, TWO_MIGRATIONS).unwrap();
        assert!(foreign_keys_enabled(&conn));

        let mut conn = open_in_memory().unwrap();
        apply(&mut conn, &["NOT VALID SQL;"]).unwrap_err();
        assert!(foreign_keys_enabled(&conn));
    }

    #[test]
    fn second_app_instance_waits_instead_of_rerunning_migrations() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut first = open(&path).unwrap();

        // The first instance holds the write lock, partway through migrating.
        let tx = first
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        tx.execute_batch(TWO_MIGRATIONS[0]).unwrap();
        set_user_version(&tx, 1).unwrap();

        // The second instance starts migrating meanwhile.
        let second_path = path.clone();
        let second = thread::spawn(move || {
            let mut conn = open(&second_path).unwrap();
            apply(&mut conn, TWO_MIGRATIONS)
        });
        // Give the second instance time to reach the lock. If it hasn't yet, the
        // test still passes, it just doesn't exercise the wait.
        thread::sleep(Duration::from_millis(200));
        tx.commit().unwrap();

        second.join().unwrap().unwrap();
        assert_eq!(user_version(&first).unwrap(), 2);
    }
}
