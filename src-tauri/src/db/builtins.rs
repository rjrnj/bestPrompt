//! Built-in frameworks. They are defined in `builtins/frameworks.json`, and
//! `seed_builtins` copies them into the database. It is for the app to call on
//! every launch, so changing a built-in's wording needs no migration.
//!
//! A built-in's `id` is its identity across launches: history entries link to
//! it, and the sync below treats an id that disappears from the file as a
//! dropped framework. Renaming an id therefore unlinks every history entry of
//! that framework, so ids never change once they have shipped.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Deserialize;

use super::{DbError, now_millis};

const FRAMEWORKS_JSON: &str = include_str!("../../builtins/frameworks.json");

/// A built-in framework as the JSON file defines it. The file's `source` field
/// records where each framework's wording comes from; it isn't stored.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Builtin {
    id: String,
    name: String,
    description: String,
    template: String,
    sections: Vec<BuiltinSection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuiltinSection {
    key: String,
    label: String,
    help_text: String,
}

fn parse_builtins() -> Result<Vec<Builtin>, DbError> {
    parse(FRAMEWORKS_JSON)
}

/// The tests check the embedded file, so this only fails if a bad edit gets
/// past them. Even then it is an error rather than a panic: the release build
/// aborts on panic, which would leave the user with no message at all.
fn parse(json: &str) -> Result<Vec<Builtin>, DbError> {
    Ok(serde_json::from_str(json)?)
}

/// Makes the database's built-in frameworks match `builtins/frameworks.json`.
pub fn seed_builtins(conn: &mut Connection) -> Result<(), DbError> {
    sync(conn, &parse_builtins()?, now_millis())
}

fn sync(conn: &mut Connection, builtins: &[Builtin], now: i64) -> Result<(), DbError> {
    // Nothing changes between launches of the same build, so the common case
    // is decided with reads alone and never takes the write lock.
    if !needs_sync(conn, builtins)? {
        return Ok(());
    }
    // IMMEDIATE for the same reason as migrations: a second app instance
    // starting at the same time waits for this one instead of failing.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    remove_dropped(&tx, builtins)?;
    for builtin in builtins {
        // Skipping unchanged built-ins keeps `updated_at` meaning "last
        // changed" rather than "last launched".
        if stored(&tx, &builtin.id)?.as_ref() != Some(builtin) {
            upsert(&tx, builtin, now)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Whether the database differs from the file in any way the sync would fix.
fn needs_sync(conn: &mut Connection, builtins: &[Builtin]) -> Result<bool, DbError> {
    // A deferred transaction gives the reads one consistent view of the
    // database without blocking, or being blocked by, a writer.
    let tx = conn.transaction()?;
    if has_dropped(&tx, builtins)? {
        return Ok(true);
    }
    for builtin in builtins {
        if stored(&tx, &builtin.id)?.as_ref() != Some(builtin) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The built-ins' ids as a JSON array, for `json_each` in SQL.
fn ids_json(builtins: &[Builtin]) -> String {
    let ids: Vec<&str> = builtins.iter().map(|builtin| builtin.id.as_str()).collect();
    serde_json::to_string(&ids).expect("a list of strings serializes")
}

/// Whether the database holds a built-in that is no longer in the file.
fn has_dropped(conn: &Connection, builtins: &[Builtin]) -> Result<bool, DbError> {
    let dropped = conn.query_row(
        "SELECT EXISTS (
             SELECT 1 FROM frameworks
             WHERE is_custom = 0 AND id NOT IN (SELECT value FROM json_each(?1))
         )",
        [ids_json(builtins)],
        |row| row.get(0),
    )?;
    Ok(dropped)
}

/// Deletes built-ins that are no longer in the file. Their sections go with
/// them; history entries keep their snapshot and lose only the link.
fn remove_dropped(conn: &Connection, builtins: &[Builtin]) -> Result<(), DbError> {
    conn.execute(
        "DELETE FROM frameworks
         WHERE is_custom = 0 AND id NOT IN (SELECT value FROM json_each(?1))",
        [ids_json(builtins)],
    )?;
    Ok(())
}

fn upsert(conn: &Connection, builtin: &Builtin, now: i64) -> Result<(), DbError> {
    // Not INSERT OR REPLACE: that deletes the existing row first, and the
    // delete would unlink every history entry from the framework.
    conn.execute(
        "INSERT INTO frameworks (id, name, description, template, is_custom, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
         ON CONFLICT (id) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             template = excluded.template,
             updated_at = excluded.updated_at",
        params![builtin.id, builtin.name, builtin.description, builtin.template, now],
    )?;
    // Replaced wholesale: updating rows in place could collide on the unique
    // position while sections are being reordered.
    conn.execute(
        "DELETE FROM framework_sections WHERE framework_id = ?1",
        [&builtin.id],
    )?;
    let mut insert = conn.prepare(
        "INSERT INTO framework_sections (framework_id, position, key, label, help_text)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (position, section) in (0_i64..).zip(&builtin.sections) {
        insert.execute(params![
            builtin.id,
            position,
            section.key,
            section.label,
            section.help_text
        ])?;
    }
    Ok(())
}

/// Reads a built-in back from the database, in the file's shape.
fn stored(conn: &Connection, id: &str) -> Result<Option<Builtin>, DbError> {
    let Some((name, description, template)) = conn
        .query_row(
            "SELECT name, description, template FROM frameworks WHERE id = ?1 AND is_custom = 0",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?
    else {
        return Ok(None);
    };
    let sections = conn
        .prepare(
            "SELECT key, label, help_text FROM framework_sections
             WHERE framework_id = ?1 ORDER BY position",
        )?
        .query_map([id], |row| {
            Ok(BuiltinSection {
                key: row.get(0)?,
                label: row.get(1)?,
                help_text: row.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Some(Builtin {
        id: id.to_owned(),
        name,
        description,
        template,
        sections,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate::migrate;
    use crate::db::open;
    use crate::db::test_support::{count, insert_entry, insert_framework, migrated};

    fn builtin(id: &str, name: &str, keys: &[&str]) -> Builtin {
        Builtin {
            id: id.to_owned(),
            name: name.to_owned(),
            description: format!("{name} description"),
            template: keys.iter().map(|key| format!("{{{{{key}}}}}")).collect(),
            sections: keys
                .iter()
                .map(|key| BuiltinSection {
                    key: (*key).to_owned(),
                    label: key.to_uppercase(),
                    help_text: format!("help for {key}"),
                })
                .collect(),
        }
    }

    /// A template's tags as `(sigil, name)`: `{{#name}}` gives `("#", name)`,
    /// `{{/name}}` gives `("/", name)` and `{{name}}` gives `("", name)`.
    fn template_tags(template: &str) -> Vec<(&str, &str)> {
        template
            .split("{{")
            .skip(1)
            .map(|rest| {
                let (tag, _) = rest.split_once("}}").expect("every {{ has a closing }}");
                match tag.strip_prefix(['#', '/']) {
                    Some(name) => (&tag[..1], name),
                    None => ("", tag),
                }
            })
            .collect()
    }

    /// The tags a built-in's template is expected to have: for each section in
    /// order, its block opened, its value, and its block closed, and nothing
    /// else. Checking the sequence rather than the set of tags catches a value
    /// placed outside its block, which would render even when the section is
    /// empty, and a block that is opened or closed twice.
    fn expected_tags(builtin: &Builtin) -> Vec<(&str, &str)> {
        builtin
            .sections
            .iter()
            .flat_map(|section| {
                let key = section.key.as_str();
                [("#", key), ("", key), ("/", key)]
            })
            .collect()
    }

    fn timestamps(conn: &Connection, id: &str) -> (i64, i64) {
        conn.query_row(
            "SELECT created_at, updated_at FROM frameworks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    fn entry_framework_id(conn: &Connection) -> Option<String> {
        conn.query_row(
            "SELECT framework_id FROM prompt_entries WHERE id = 'entry'",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    /// Changing an id unlinks every history entry of that framework (see the
    /// module doc), so the shipped ids are pinned here. A new built-in extends
    /// this list; an existing one is never renamed.
    #[test]
    fn builtin_ids_never_change() {
        let ids: Vec<String> = parse_builtins()
            .unwrap()
            .into_iter()
            .map(|builtin| builtin.id)
            .collect();
        assert_eq!(ids, ["costar", "risen", "race", "rtf"]);
    }

    #[test]
    fn seeds_the_builtins_from_the_file() {
        let mut conn = migrated();
        seed_builtins(&mut conn).unwrap();

        let builtins = parse_builtins().unwrap();
        assert_eq!(
            count(&conn, "SELECT count(*) FROM frameworks WHERE is_custom = 0"),
            i64::try_from(builtins.len()).unwrap()
        );
        for builtin in &builtins {
            assert_eq!(stored(&conn, &builtin.id).unwrap().as_ref(), Some(builtin));
        }
    }

    #[test]
    fn malformed_builtins_file_is_an_error_not_a_panic() {
        let result = parse("[{\"id\": \"costar\"");

        assert!(matches!(result, Err(DbError::BuiltinsUnreadable(_))));
    }

    #[test]
    fn template_tags_reads_each_kind_of_tag() {
        assert_eq!(
            template_tags(
                "{{#a}}# A
{{a}}{{/a}} and {{b}}"
            ),
            [("#", "a"), ("", "a"), ("/", "a"), ("", "b")]
        );
    }

    #[test]
    fn builtin_templates_wrap_each_section_value_in_its_own_block() {
        for builtin in parse_builtins().unwrap() {
            assert_eq!(
                template_tags(&builtin.template),
                expected_tags(&builtin),
                "{}",
                builtin.id
            );
        }
    }

    #[test]
    fn a_value_outside_its_block_fails_the_template_check() {
        let mut misplaced = builtin("a", "A", &["role"]);
        misplaced.template = "{{#role}}# Role{{/role}}\n{{role}}".to_owned();

        assert_ne!(
            template_tags(&misplaced.template),
            expected_tags(&misplaced)
        );
    }

    #[test]
    fn seeding_an_unchanged_builtin_again_writes_nothing() {
        let mut conn = migrated();
        let builtins = [builtin("a", "A", &["x", "y"])];

        sync(&mut conn, &builtins, 1).unwrap();
        sync(&mut conn, &builtins, 2).unwrap();

        assert_eq!(count(&conn, "SELECT count(*) FROM frameworks"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM framework_sections"), 2);
        assert_eq!(timestamps(&conn, "a"), (1, 1));
    }

    #[test]
    fn seeding_an_unchanged_builtin_takes_no_write_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut conn = open(&path).unwrap();
        migrate(&mut conn).unwrap();
        let builtins = [builtin("a", "A", &["x"])];
        sync(&mut conn, &builtins, 1).unwrap();

        // Another connection holds the write lock. If the sync tried to take it
        // too, it would wait out busy_timeout and then fail.
        let mut other = open(&path).unwrap();
        let writer = other
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();

        sync(&mut conn, &builtins, 2).unwrap();

        drop(writer);
        assert_eq!(timestamps(&conn, "a"), (1, 1));
    }

    #[test]
    fn changed_builtin_is_updated_in_place() {
        let mut conn = migrated();
        sync(&mut conn, &[builtin("a", "A", &["x", "y", "z"])], 1).unwrap();

        // Renamed, one section dropped, the others reordered.
        let changed = builtin("a", "Renamed", &["z", "x"]);
        sync(&mut conn, std::slice::from_ref(&changed), 2).unwrap();

        assert_eq!(stored(&conn, "a").unwrap(), Some(changed));
        assert_eq!(count(&conn, "SELECT count(*) FROM frameworks"), 1);
        assert_eq!(timestamps(&conn, "a"), (1, 2));
    }

    #[test]
    fn updating_a_builtin_keeps_history_linked_to_it() {
        let mut conn = migrated();
        sync(&mut conn, &[builtin("a", "A", &["x"])], 1).unwrap();
        insert_entry(&conn, "entry", Some("a"));

        sync(&mut conn, &[builtin("a", "Renamed", &["y"])], 2).unwrap();

        assert_eq!(entry_framework_id(&conn).as_deref(), Some("a"));
    }

    #[test]
    fn builtin_dropped_from_the_file_is_removed() {
        let mut conn = migrated();
        sync(
            &mut conn,
            &[
                builtin("kept", "Kept", &["x"]),
                builtin("dropped", "Dropped", &["x"]),
            ],
            1,
        )
        .unwrap();
        insert_entry(&conn, "entry", Some("dropped"));
        let custom_id = "0192d4c8-7b3a-7f00-8a1e-3c5d7e9f0b2a";
        insert_framework(&conn, custom_id, true);

        sync(&mut conn, &[builtin("kept", "Kept", &["x"])], 2).unwrap();

        assert_eq!(stored(&conn, "dropped").unwrap(), None);
        assert_eq!(
            count(
                &conn,
                "SELECT count(*) FROM framework_sections WHERE framework_id = 'dropped'"
            ),
            0
        );
        // History survives through its snapshot; only the link goes.
        assert_eq!(entry_framework_id(&conn), None);
        assert!(stored(&conn, "kept").unwrap().is_some());
        assert_eq!(
            count(
                &conn,
                &format!("SELECT count(*) FROM frameworks WHERE id = '{custom_id}'")
            ),
            1
        );
    }

    #[test]
    fn failed_seeding_leaves_the_database_unchanged() {
        let mut conn = migrated();
        let mut duplicate_keys = builtin("bad", "Bad", &["x", "x"]);
        duplicate_keys.template = "{{x}}".to_owned();

        let result = sync(
            &mut conn,
            &[builtin("good", "Good", &["x"]), duplicate_keys],
            1,
        );

        assert!(matches!(result, Err(DbError::Sqlite(_))));
        assert_eq!(count(&conn, "SELECT count(*) FROM frameworks"), 0);
    }
}
