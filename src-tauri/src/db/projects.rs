//! Projects, which group prompt entries.

use rusqlite::{Connection, OptionalExtension, ffi};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use super::{DbError, Entity, now_millis};

/// A named group of prompt entries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
}

const PROJECT_COLUMNS: &str = "SELECT id, name, created_at, updated_at FROM projects";

fn project_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
    })
}

/// Every project, by name ignoring case.
pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, DbError> {
    let projects = conn
        .prepare(&format!(
            "{PROJECT_COLUMNS} ORDER BY name COLLATE NOCASE, id"
        ))?
        .query_map([], project_from_row)?
        .collect::<Result<_, _>>()?;
    Ok(projects)
}

/// Creates a project; the name is stored trimmed.
pub fn create_project(conn: &Connection, name: &str) -> Result<Project, DbError> {
    let name = checked_name(name)?;
    let now = now_millis();
    let project = Project {
        id: Uuid::now_v7().to_string(),
        name: name.to_owned(),
        created_at: now,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![
            project.id,
            project.name,
            project.created_at,
            project.updated_at
        ],
    )
    .map_err(|error| name_conflict(error, name))?;
    Ok(project)
}

/// Renames a project and bumps its `updated_at`.
pub fn rename_project(conn: &Connection, id: &str, name: &str) -> Result<Project, DbError> {
    let name = checked_name(name)?;
    let changed = conn
        .execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![name, now_millis(), id],
        )
        .map_err(|error| name_conflict(error, name))?;
    if changed == 0 {
        return Err(not_found(id));
    }
    let project = conn
        .query_row(
            &format!("{PROJECT_COLUMNS} WHERE id = ?1"),
            [id],
            project_from_row,
        )
        .optional()?;
    project.ok_or_else(|| not_found(id))
}

/// Deletes a project. Its entries are kept and left without a project.
pub fn delete_project(conn: &Connection, id: &str) -> Result<(), DbError> {
    let deleted = conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    if deleted == 0 {
        return Err(not_found(id));
    }
    Ok(())
}

fn not_found(id: &str) -> DbError {
    DbError::NotFound {
        entity: Entity::Project,
        id: id.to_owned(),
    }
}

/// The name without surrounding whitespace. The table's CHECK only strips
/// spaces, so a name of tabs or newlines is caught here.
fn checked_name(name: &str) -> Result<&str, DbError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DbError::BlankProjectName);
    }
    Ok(name)
}

/// Turns SQLite's UNIQUE violation on `projects.name` into a name-taken error;
/// anything else stays a database error.
fn name_conflict(error: rusqlite::Error, name: &str) -> DbError {
    if let rusqlite::Error::SqliteFailure(failure, Some(message)) = &error
        && failure.extended_code == ffi::SQLITE_CONSTRAINT_UNIQUE
        && message.contains("projects.name")
    {
        return DbError::ProjectNameTaken {
            name: name.to_owned(),
        };
    }
    DbError::Sqlite(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{count, insert_entry, migrated};
    use crate::db::{Entity, now_millis};
    use uuid::Uuid;

    fn names(conn: &Connection) -> Vec<String> {
        list_projects(conn)
            .unwrap()
            .into_iter()
            .map(|project| project.name)
            .collect()
    }

    #[test]
    fn create_trims_and_returns_the_project() {
        let conn = migrated();
        let before = now_millis();

        let project = create_project(&conn, " \tAPI work\n ").unwrap();

        assert_eq!(project.name, "API work");
        let id = Uuid::parse_str(&project.id).expect("a UUID");
        assert_eq!(id.get_version_num(), 7);
        assert!(project.created_at >= before && project.created_at <= now_millis());
        assert_eq!(project.updated_at, project.created_at);
        assert_eq!(list_projects(&conn).unwrap(), [project]);
    }

    #[test]
    fn create_rejects_a_blank_name() {
        let conn = migrated();

        for name in ["", "   ", "\t\n"] {
            let result = create_project(&conn, name);
            assert!(
                matches!(result, Err(DbError::BlankProjectName)),
                "{result:?}"
            );
        }
        assert_eq!(count(&conn, "SELECT count(*) FROM projects"), 0);
    }

    #[test]
    fn create_rejects_a_name_that_differs_only_by_case_or_spaces() {
        let conn = migrated();
        create_project(&conn, "api").unwrap();

        let result = create_project(&conn, " API ");

        match result {
            Err(DbError::ProjectNameTaken { name }) => assert_eq!(name, "API"),
            other => panic!("{other:?}"),
        }
        assert_eq!(names(&conn), ["api"]);
    }

    #[test]
    fn rename_changes_the_name_and_updated_at() {
        let conn = migrated();
        let project = create_project(&conn, "old").unwrap();
        conn.execute("UPDATE projects SET updated_at = 0", [])
            .unwrap();

        let renamed = rename_project(&conn, &project.id, "  new ").unwrap();

        assert_eq!(renamed.id, project.id);
        assert_eq!(renamed.name, "new");
        assert_eq!(renamed.created_at, project.created_at);
        assert!(renamed.updated_at > 0);
        assert_eq!(list_projects(&conn).unwrap(), [renamed]);
    }

    #[test]
    fn rename_to_its_own_name_in_another_case_is_allowed() {
        let conn = migrated();
        let project = create_project(&conn, "api").unwrap();

        let renamed = rename_project(&conn, &project.id, "API").unwrap();

        assert_eq!(renamed.name, "API");
    }

    #[test]
    fn rename_to_another_projects_name_or_a_blank_one_is_rejected() {
        let conn = migrated();
        create_project(&conn, "one").unwrap();
        let two = create_project(&conn, "two").unwrap();

        assert!(matches!(
            rename_project(&conn, &two.id, "ONE"),
            Err(DbError::ProjectNameTaken { .. })
        ));
        assert!(matches!(
            rename_project(&conn, &two.id, "  "),
            Err(DbError::BlankProjectName)
        ));
        assert_eq!(names(&conn), ["one", "two"]);
    }

    #[test]
    fn rename_and_delete_report_an_unknown_id_as_not_found() {
        let conn = migrated();

        let renamed = rename_project(&conn, "nope", "x");
        let deleted = delete_project(&conn, "nope");

        for result in [renamed.map(|_| ()), deleted] {
            assert!(
                matches!(
                    result,
                    Err(DbError::NotFound {
                        entity: Entity::Project,
                        ..
                    })
                ),
                "{result:?}"
            );
        }
    }

    #[test]
    fn delete_unlinks_the_projects_entries() {
        let conn = migrated();
        let project = create_project(&conn, "p").unwrap();
        insert_entry(&conn, "e", None);
        conn.execute("UPDATE prompt_entries SET project_id = ?1", [&project.id])
            .unwrap();

        delete_project(&conn, &project.id).unwrap();

        assert_eq!(count(&conn, "SELECT count(*) FROM projects"), 0);
        assert_eq!(count(&conn, "SELECT count(*) FROM prompt_entries"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT count(*) FROM prompt_entries WHERE project_id IS NULL"
            ),
            1
        );
    }

    #[test]
    fn list_is_sorted_by_name_ignoring_case() {
        let conn = migrated();
        for name in ["beta", "Alpha", "alpine", "Zed"] {
            create_project(&conn, name).unwrap();
        }

        assert_eq!(names(&conn), ["Alpha", "alpine", "beta", "Zed"]);
    }
}
