//! Reading frameworks and their sections.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, ffi};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use super::{DbError, Entity, now_millis};

/// One input box of a framework's form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Section {
    pub key: String,
    pub label: String,
    pub help_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Framework {
    pub id: String,
    pub name: String,
    pub description: String,
    pub template: String,
    /// The key of the section that best summarises a prompt built with this
    /// framework, used to label entries that have no title.
    pub summary_key: Option<String>,
    pub is_custom: bool,
    pub sections: Vec<Section>,
    pub created_at: i64,
    pub updated_at: i64,
    /// When a custom framework was deleted; `None` while it is live.
    pub deleted_at: Option<i64>,
}

/// What the frontend sends to create or edit a custom framework. The id,
/// timestamps and built-in flag are never the caller's to set.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FrameworkInput {
    pub name: String,
    pub description: String,
    pub template: String,
    pub summary_key: String,
    pub sections: Vec<Section>,
}

const FRAMEWORK_COLUMNS: &str = "SELECT id, name, description, template, summary_key, is_custom,
            created_at, updated_at, deleted_at
     FROM frameworks";

/// Maps a `FRAMEWORK_COLUMNS` row; the sections are filled in by a second query.
fn framework_without_sections(row: &rusqlite::Row<'_>) -> rusqlite::Result<Framework> {
    Ok(Framework {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        template: row.get(3)?,
        summary_key: row.get(4)?,
        is_custom: row.get(5)?,
        sections: Vec::new(),
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

/// Every framework with its sections in form order. Built-ins come first,
/// then custom frameworks, each group by name.
pub fn list_frameworks(conn: &Connection) -> Result<Vec<Framework>, DbError> {
    let mut frameworks: Vec<Framework> = conn
        .prepare(&format!(
            "{FRAMEWORK_COLUMNS} ORDER BY is_custom, name COLLATE NOCASE, id"
        ))?
        .query_map([], framework_without_sections)?
        .collect::<Result<_, _>>()?;
    for framework in &mut frameworks {
        framework.sections = sections(conn, &framework.id)?;
    }
    Ok(frameworks)
}

/// One framework with its sections in form order.
pub fn get_framework(conn: &Connection, id: &str) -> Result<Framework, DbError> {
    let framework = conn
        .query_row(
            &format!("{FRAMEWORK_COLUMNS} WHERE id = ?1"),
            [id],
            framework_without_sections,
        )
        .optional()?;
    let Some(mut framework) = framework else {
        return Err(DbError::NotFound {
            entity: Entity::Framework,
            id: id.to_owned(),
        });
    };
    framework.sections = sections(conn, id)?;
    Ok(framework)
}

fn sections(conn: &Connection, framework_id: &str) -> Result<Vec<Section>, DbError> {
    let sections = conn
        .prepare(
            "SELECT key, label, help_text FROM framework_sections
             WHERE framework_id = ?1 ORDER BY position",
        )?
        .query_map([framework_id], |row| {
            Ok(Section {
                key: row.get(0)?,
                label: row.get(1)?,
                help_text: row.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(sections)
}

/// Creates a custom framework; the name is stored trimmed.
pub fn create_framework(
    conn: &mut Connection,
    input: &FrameworkInput,
) -> Result<Framework, DbError> {
    let input = checked(input)?;
    let id = Uuid::now_v7().to_string();
    let now = now_millis();
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(
        "INSERT INTO frameworks
             (id, name, description, template, summary_key, is_custom, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
        rusqlite::params![
            id,
            input.name,
            input.description,
            input.template,
            input.summary_key,
            now
        ],
    )
    .map_err(|error| name_conflict(error, &input.name))?;
    insert_sections(&tx, &id, &input.sections)?;
    let framework = get_framework(&tx, &id)?;
    tx.commit()?;
    Ok(framework)
}

/// Replaces a custom framework's name, description, template, summary key and
/// sections, and bumps its `updated_at`. Entries already saved keep the
/// snapshot they were saved with.
pub fn update_framework(
    conn: &mut Connection,
    id: &str,
    input: &FrameworkInput,
) -> Result<Framework, DbError> {
    // IMMEDIATE so the check that it is a live custom framework and the write
    // happen under one lock.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<(bool, Option<i64>)> = tx
        .query_row(
            "SELECT is_custom, deleted_at FROM frameworks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match existing {
        None | Some((true, Some(_))) => {
            return Err(DbError::NotFound {
                entity: Entity::Framework,
                id: id.to_owned(),
            });
        }
        Some((false, _)) => return Err(DbError::BuiltinReadOnly),
        Some((true, None)) => {}
    }
    let input = checked(input)?;
    tx.execute(
        "UPDATE frameworks
         SET name = ?1, description = ?2, template = ?3, summary_key = ?4, updated_at = ?5
         WHERE id = ?6",
        rusqlite::params![
            input.name,
            input.description,
            input.template,
            input.summary_key,
            now_millis(),
            id
        ],
    )
    .map_err(|error| name_conflict(error, &input.name))?;
    // Wholesale, as the built-in seeder does: updating rows in place could
    // collide on `position` while sections are reordered.
    tx.execute(
        "DELETE FROM framework_sections WHERE framework_id = ?1",
        [id],
    )?;
    insert_sections(&tx, id, &input.sections)?;
    let framework = get_framework(&tx, id)?;
    tx.commit()?;
    Ok(framework)
}

fn insert_sections(
    conn: &Connection,
    framework_id: &str,
    sections: &[Section],
) -> rusqlite::Result<()> {
    let mut insert = conn.prepare(
        "INSERT INTO framework_sections (framework_id, position, key, label, help_text)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for (position, section) in sections.iter().enumerate() {
        insert.execute(rusqlite::params![
            framework_id,
            position as i64,
            section.key,
            section.label,
            section.help_text
        ])?;
    }
    Ok(())
}

fn invalid(message: &str) -> DbError {
    DbError::InvalidFramework {
        message: message.to_owned(),
    }
}

/// The input with its name and labels trimmed, or the first structural problem
/// with it. Whether the template parses is for the frontend to check.
fn checked(input: &FrameworkInput) -> Result<FrameworkInput, DbError> {
    let mut input = input.clone();
    input.name = input.name.trim().to_owned();
    if input.name.is_empty() {
        return Err(invalid("A framework name can't be blank."));
    }
    if input.sections.is_empty() {
        return Err(invalid("A framework needs at least one section."));
    }
    let mut labels = HashSet::new();
    for section in &mut input.sections {
        section.label = section.label.trim().to_owned();
        if section.label.is_empty() {
            return Err(invalid("A section label can't be blank."));
        }
        // A label is not template text; one holding a tag would break the
        // template generated from the labels.
        if section.label.contains("{{") || section.label.contains("}}") {
            return Err(invalid("A section label can't contain {{ or }}."));
        }
        if !labels.insert(section.label.to_lowercase()) {
            return Err(invalid("Two sections can't have the same label."));
        }
    }
    let mut keys = HashSet::new();
    for section in &input.sections {
        let key = section.key.as_str();
        let allowed = !key.is_empty()
            && key
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
        if !allowed || !keys.insert(key) {
            return Err(invalid(
                "Section keys must be unique and use only a-z, 0-9 and _.",
            ));
        }
    }
    if !keys.contains(input.summary_key.as_str()) {
        return Err(invalid("The summary section must be one of the sections."));
    }
    Ok(input)
}

/// Turns SQLite's UNIQUE violation on the live-name index into a name-taken
/// error; anything else stays a database error.
fn name_conflict(error: rusqlite::Error, name: &str) -> DbError {
    if let rusqlite::Error::SqliteFailure(failure, Some(message)) = &error
        && failure.extended_code == ffi::SQLITE_CONSTRAINT_UNIQUE
        && message.contains("frameworks.name")
    {
        return DbError::FrameworkNameTaken {
            name: name.to_owned(),
        };
    }
    DbError::Sqlite(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::entries::{NewPromptEntry, save_prompt_entry};
    use crate::db::test_support::{count, insert_framework, insert_section, migrated};

    #[test]
    fn lists_a_framework_with_its_sections_in_position_order() {
        let conn = migrated();
        insert_framework(&conn, "f", false);
        insert_section(&conn, "f", 1, "second");
        insert_section(&conn, "f", 0, "first");

        let frameworks = list_frameworks(&conn).unwrap();

        assert_eq!(frameworks.len(), 1);
        let keys: Vec<&str> = frameworks[0]
            .sections
            .iter()
            .map(|section| section.key.as_str())
            .collect();
        assert_eq!(keys, ["first", "second"]);
    }

    fn insert_named(conn: &Connection, id: &str, name: &str, is_custom: bool) {
        conn.execute(
            "INSERT INTO frameworks (id, name, description, template, is_custom, created_at, updated_at)
             VALUES (?1, ?2, '', '', ?3, 0, 0)",
            rusqlite::params![id, name, is_custom],
        )
        .unwrap();
    }

    #[test]
    fn lists_builtins_first_then_customs_each_by_name_ignoring_case() {
        let conn = migrated();
        insert_named(&conn, "0192d4c8-7b3a-7f00-8a1e-3c5d7e9f0b2a", "Zed", true);
        insert_named(&conn, "rtf", "RTF", false);
        insert_named(&conn, "0192d4c8-7b3a-7f00-8a1e-3c5d7e9f0b2b", "alpha", true);
        insert_named(&conn, "costar", "CO-STAR", false);

        let names: Vec<String> = list_frameworks(&conn)
            .unwrap()
            .into_iter()
            .map(|framework| framework.name)
            .collect();

        assert_eq!(names, ["CO-STAR", "RTF", "alpha", "Zed"]);
    }

    #[test]
    fn gets_one_framework_by_id_with_its_sections() {
        let conn = migrated();
        insert_framework(&conn, "f", false);
        insert_section(&conn, "f", 0, "a");
        insert_framework(&conn, "other", false);
        insert_section(&conn, "other", 0, "b");

        let framework = get_framework(&conn, "f").unwrap();

        assert_eq!(framework.id, "f");
        assert_eq!(framework.name, "Framework f");
        assert!(!framework.is_custom);
        let keys: Vec<&str> = framework
            .sections
            .iter()
            .map(|section| section.key.as_str())
            .collect();
        assert_eq!(keys, ["a"]);
    }

    #[test]
    fn getting_an_unknown_framework_is_a_not_found_error() {
        let conn = migrated();

        let result = get_framework(&conn, "missing");

        assert!(matches!(
            result,
            Err(DbError::NotFound {
                entity: Entity::Framework,
                ..
            })
        ));
    }

    fn section(key: &str, label: &str) -> Section {
        Section {
            key: key.to_owned(),
            label: label.to_owned(),
            help_text: format!("about {key}"),
        }
    }

    fn input() -> FrameworkInput {
        FrameworkInput {
            name: "Mine".to_owned(),
            description: "A framework".to_owned(),
            template: "{{goal}} {{tone}}".to_owned(),
            summary_key: "goal".to_owned(),
            sections: vec![section("goal", "Goal"), section("tone", "Tone")],
        }
    }

    fn invalid_message(result: Result<Framework, DbError>) -> String {
        match result {
            Err(DbError::InvalidFramework { message }) => message,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn create_trims_the_name_and_returns_the_framework_with_its_sections() {
        let mut conn = migrated();
        let before = now_millis();
        let mut new = input();
        new.name = " \tMine\n ".to_owned();

        let created = create_framework(&mut conn, &new).unwrap();

        assert_eq!(created.name, "Mine");
        assert_eq!(created.description, "A framework");
        assert_eq!(created.template, "{{goal}} {{tone}}");
        assert_eq!(created.summary_key.as_deref(), Some("goal"));
        assert!(created.is_custom);
        assert_eq!(created.deleted_at, None);
        assert_eq!(created.sections, new.sections);
        let id = Uuid::parse_str(&created.id).expect("a UUID");
        assert_eq!(id.get_version_num(), 7);
        assert!(created.created_at >= before && created.created_at <= now_millis());
        assert_eq!(created.updated_at, created.created_at);
        assert_eq!(get_framework(&conn, &created.id).unwrap(), created);
    }

    #[test]
    fn create_rejects_a_blank_name() {
        let mut conn = migrated();
        let mut new = input();
        new.name = " \t ".to_owned();

        let message = invalid_message(create_framework(&mut conn, &new));

        assert_eq!(message, "A framework name can't be blank.");
    }

    #[test]
    fn create_rejects_a_name_taken_by_a_builtin_in_another_case() {
        let mut conn = migrated();
        insert_named(&conn, "rtf", "RTF", false);
        let mut new = input();
        new.name = " rtf ".to_owned();

        let result = create_framework(&mut conn, &new);

        match result {
            Err(DbError::FrameworkNameTaken { name }) => assert_eq!(name, "rtf"),
            other => panic!("{other:?}"),
        }
        assert_eq!(list_frameworks(&conn).unwrap().len(), 1);
    }

    #[test]
    fn create_rejects_no_sections() {
        let mut conn = migrated();
        let mut new = input();
        new.sections.clear();

        let message = invalid_message(create_framework(&mut conn, &new));

        assert_eq!(message, "A framework needs at least one section.");
    }

    #[test]
    fn rejects_a_blank_label() {
        let mut conn = migrated();
        let mut new = input();
        new.sections[1].label = " \t".to_owned();

        let message = invalid_message(create_framework(&mut conn, &new));

        assert_eq!(message, "A section label can't be blank.");
    }

    #[test]
    fn rejects_a_label_with_template_braces() {
        let mut conn = migrated();

        for label in ["Goal {{x}}", "a }} b", "{{", "}}"] {
            let mut new = input();
            new.sections[0].label = label.to_owned();

            let message = invalid_message(create_framework(&mut conn, &new));

            assert_eq!(
                message, "A section label can't contain {{ or }}.",
                "{label}"
            );
        }
        assert!(list_frameworks(&conn).unwrap().is_empty());
    }

    #[test]
    fn rejects_duplicate_labels_ignoring_case() {
        let mut conn = migrated();
        let mut new = input();
        new.sections[1].label = " GOAL ".to_owned();

        let message = invalid_message(create_framework(&mut conn, &new));

        assert_eq!(message, "Two sections can't have the same label.");
    }

    #[test]
    fn rejects_a_key_with_other_characters() {
        let mut conn = migrated();

        for key in ["", "Goal", "my-key", "a b", "café", "x{{"] {
            let mut new = input();
            new.sections[0].key = key.to_owned();
            new.summary_key = "tone".to_owned();

            let message = invalid_message(create_framework(&mut conn, &new));

            assert_eq!(
                message, "Section keys must be unique and use only a-z, 0-9 and _.",
                "{key:?}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_keys() {
        let mut conn = migrated();
        let mut new = input();
        new.sections[1].key = "goal".to_owned();

        let message = invalid_message(create_framework(&mut conn, &new));

        assert_eq!(
            message,
            "Section keys must be unique and use only a-z, 0-9 and _."
        );
    }

    #[test]
    fn rejects_a_summary_key_that_is_not_a_section() {
        let mut conn = migrated();
        let mut new = input();
        new.summary_key = "missing".to_owned();

        let message = invalid_message(create_framework(&mut conn, &new));

        assert_eq!(message, "The summary section must be one of the sections.");
    }

    #[test]
    fn labels_are_stored_trimmed_and_free_text_is_kept_as_given() {
        let mut conn = migrated();
        let mut new = input();
        new.sections[0].label = "  Goal ".to_owned();
        new.sections[0].help_text = "use {{ freely }}".to_owned();
        new.description = "  spaced {{ out }} ".to_owned();

        let created = create_framework(&mut conn, &new).unwrap();

        assert_eq!(created.sections[0].label, "Goal");
        assert_eq!(created.sections[0].help_text, "use {{ freely }}");
        assert_eq!(created.description, "  spaced {{ out }} ");
    }

    #[test]
    fn a_failed_create_leaves_nothing_behind() {
        let mut conn = migrated();
        create_framework(&mut conn, &input()).unwrap();

        assert!(create_framework(&mut conn, &input()).is_err());

        assert_eq!(count(&conn, "SELECT count(*) FROM frameworks"), 1);
        assert_eq!(count(&conn, "SELECT count(*) FROM framework_sections"), 2);
    }

    #[test]
    fn update_replaces_sections_and_bumps_updated_at() {
        let mut conn = migrated();
        let created = create_framework(&mut conn, &input()).unwrap();
        conn.execute("UPDATE frameworks SET updated_at = 0", [])
            .unwrap();
        let changed = FrameworkInput {
            name: " Renamed ".to_owned(),
            description: "New description".to_owned(),
            template: "{{tone}} {{goal}} {{extra}}".to_owned(),
            summary_key: "tone".to_owned(),
            sections: vec![
                section("tone", "Tone"),
                section("goal", "Goal"),
                section("extra", "Extra"),
            ],
        };

        let updated = update_framework(&mut conn, &created.id, &changed).unwrap();

        assert_eq!(updated.name, "Renamed");
        assert_eq!(updated.description, "New description");
        assert_eq!(updated.template, "{{tone}} {{goal}} {{extra}}");
        assert_eq!(updated.summary_key.as_deref(), Some("tone"));
        let keys: Vec<&str> = updated.sections.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["tone", "goal", "extra"]);
        assert!(updated.updated_at > 0);
        assert_eq!(get_framework(&conn, &created.id).unwrap(), updated);
    }

    #[test]
    fn update_keeps_created_at_and_id() {
        let mut conn = migrated();
        let created = create_framework(&mut conn, &input()).unwrap();

        let updated = update_framework(&mut conn, &created.id, &input()).unwrap();

        assert_eq!(updated.id, created.id);
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.is_custom);
    }

    #[test]
    fn update_may_keep_its_own_name_in_another_case() {
        let mut conn = migrated();
        let created = create_framework(&mut conn, &input()).unwrap();
        let mut changed = input();
        changed.name = "MINE".to_owned();

        let updated = update_framework(&mut conn, &created.id, &changed).unwrap();

        assert_eq!(updated.name, "MINE");
    }

    #[test]
    fn update_rejects_another_frameworks_name_and_changes_nothing() {
        let mut conn = migrated();
        let created = create_framework(&mut conn, &input()).unwrap();
        let mut other = input();
        other.name = "Other".to_owned();
        create_framework(&mut conn, &other).unwrap();
        let mut changed = input();
        changed.name = "other".to_owned();
        changed.sections.truncate(1);

        let result = update_framework(&mut conn, &created.id, &changed);

        assert!(matches!(result, Err(DbError::FrameworkNameTaken { .. })));
        assert_eq!(get_framework(&conn, &created.id).unwrap(), created);
    }

    #[test]
    fn update_refuses_a_builtin() {
        let mut conn = migrated();
        insert_named(&conn, "rtf", "RTF", false);

        let result = update_framework(&mut conn, "rtf", &input());

        assert!(
            matches!(result, Err(DbError::BuiltinReadOnly)),
            "{result:?}"
        );
        assert_eq!(get_framework(&conn, "rtf").unwrap().name, "RTF");
    }

    #[test]
    fn update_of_an_unknown_or_deleted_id_is_not_found() {
        let mut conn = migrated();
        let created = create_framework(&mut conn, &input()).unwrap();
        conn.execute("UPDATE frameworks SET deleted_at = 1", [])
            .unwrap();

        for id in ["missing", created.id.as_str()] {
            let result = update_framework(&mut conn, id, &input());

            assert!(
                matches!(
                    result,
                    Err(DbError::NotFound {
                        entity: Entity::Framework,
                        ..
                    })
                ),
                "{id}: {result:?}"
            );
        }
    }

    #[test]
    fn updating_never_changes_saved_entries() {
        let mut conn = migrated();
        let created = create_framework(&mut conn, &input()).unwrap();
        let saved = save_prompt_entry(
            &mut conn,
            &NewPromptEntry {
                framework_id: created.id.clone(),
                section_values: [("goal".to_owned(), "ship".to_owned())].into(),
                rendered_prompt: "ship".to_owned(),
                title: None,
                project_id: None,
            },
        )
        .unwrap();
        let stored = |conn: &Connection| -> (String, String, String) {
            conn.query_row(
                "SELECT framework_snapshot, section_values, rendered_prompt
                 FROM prompt_entries WHERE id = ?1",
                [&saved.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap()
        };
        let before = stored(&conn);
        let changed = FrameworkInput {
            name: "Renamed".to_owned(),
            description: String::new(),
            template: "{{other}}".to_owned(),
            summary_key: "other".to_owned(),
            sections: vec![section("other", "Other")],
        };

        update_framework(&mut conn, &created.id, &changed).unwrap();

        assert_eq!(stored(&conn), before);
    }
}
