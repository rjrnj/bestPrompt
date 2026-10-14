//! Reading frameworks and their sections.

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{DbError, Entity};

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
    pub is_custom: bool,
    pub sections: Vec<Section>,
    pub created_at: i64,
    pub updated_at: i64,
}

const FRAMEWORK_COLUMNS: &str =
    "SELECT id, name, description, template, is_custom, created_at, updated_at FROM frameworks";

/// Maps a `FRAMEWORK_COLUMNS` row; the sections are filled in by a second query.
fn framework_without_sections(row: &rusqlite::Row<'_>) -> rusqlite::Result<Framework> {
    Ok(Framework {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        template: row.get(3)?,
        is_custom: row.get(4)?,
        sections: Vec::new(),
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{insert_framework, insert_section, migrated};

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
        assert_eq!(framework.name, "Framework");
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
}
