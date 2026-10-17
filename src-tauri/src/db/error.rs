use serde::{Serialize, Serializer};
use ts_rs::TS;

/// Errors from the data layer. They reach the frontend serialized as
/// `{ kind, message }`, where `kind` is what the frontend branches on and
/// `message` is the text it can show.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),

    /// The database was last migrated by a newer version of the app.
    #[error(
        "database schema version {found} is newer than this app supports ({supported}); update the app"
    )]
    SchemaTooNew { found: usize, supported: usize },

    /// A migration left a row whose foreign key points at nothing.
    #[error("migration {version} left a broken foreign key reference in table {table}")]
    MigrationBrokeForeignKey { version: usize, table: String },

    /// The built-in framework definitions compiled into the app don't parse.
    #[error("builtins/frameworks.json is not valid: {0}")]
    BuiltinsUnreadable(#[from] serde_json::Error),

    /// No row has the id that was asked for.
    #[error("{entity} {id} not found")]
    NotFound { entity: Entity, id: String },

    /// SQLite takes a backup's file name as text, which this path can't be.
    #[error("backup path {} is not valid Unicode", path.display())]
    BackupPathNotUnicode { path: std::path::PathBuf },

    /// A project name that is empty once surrounding whitespace is removed.
    #[error("A project name can't be blank.")]
    BlankProjectName,

    /// Another project already has this name, ignoring ASCII case.
    #[error("A project named “{name}” already exists.")]
    ProjectNameTaken { name: String },
}

/// What a `NotFound` error was looking for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entity {
    Framework,
    PromptEntry,
    Project,
}

impl std::fmt::Display for Entity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Entity::Framework => "framework",
            Entity::PromptEntry => "prompt entry",
            Entity::Project => "project",
        })
    }
}

/// The error as the frontend receives it.
#[derive(Debug, Serialize, TS)]
#[serde(rename = "DbError")]
#[ts(export)]
struct Payload {
    kind: Kind,
    message: String,
}

/// What the frontend can branch on. `NotFound` is an expected outcome of a
/// lookup and `Invalid` a rejected input whose message can be shown as is;
/// everything else is something wrong with the database.
#[derive(Debug, Clone, Copy, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export_to = "DbError.ts", rename = "DbErrorKind")]
enum Kind {
    Database,
    NotFound,
    Invalid,
}

impl DbError {
    fn kind(&self) -> Kind {
        match self {
            DbError::Sqlite(_)
            | DbError::SchemaTooNew { .. }
            | DbError::MigrationBrokeForeignKey { .. }
            | DbError::BuiltinsUnreadable(_)
            | DbError::BackupPathNotUnicode { .. } => Kind::Database,
            DbError::NotFound { .. } => Kind::NotFound,
            DbError::BlankProjectName | DbError::ProjectNameTaken { .. } => Kind::Invalid,
        }
    }

    /// The text shown to the user. Errors that quote SQL, table names or JSON
    /// are for developers, so they get a generic message instead.
    fn message(&self) -> String {
        match self {
            DbError::Sqlite(_)
            | DbError::MigrationBrokeForeignKey { .. }
            | DbError::BuiltinsUnreadable(_)
            | DbError::BackupPathNotUnicode { .. } => "A database error occurred.".to_owned(),
            DbError::SchemaTooNew { .. }
            | DbError::NotFound { .. }
            | DbError::BlankProjectName
            | DbError::ProjectNameTaken { .. } => self.to_string(),
        }
    }
}

/// Serializing is the point where the error leaves the data layer for the
/// frontend, and the user-facing message drops the detail (SQLite's error
/// code, the table name), so the full text is logged here first. Otherwise a
/// full disk or a read-only database file would be indistinguishable from a
/// bug. A lookup that found nothing isn't a fault, so it isn't logged.
impl Serialize for DbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let kind = self.kind();
        if matches!(kind, Kind::Database) {
            log::error!("{self}");
        }
        Payload {
            kind,
            message: self.message(),
        }
        .serialize(serializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::db::test_support::logged;
    use serde_json::json;

    #[test]
    fn sqlite_error_serializes_without_its_raw_text_and_logs_it() {
        let conn = open_in_memory().unwrap();
        let error = DbError::from(conn.execute("NOT VALID SQL", []).unwrap_err());
        assert!(error.to_string().contains("syntax error"));

        let (serialized, log) = logged(|| serde_json::to_value(&error).unwrap());

        assert_eq!(
            serialized,
            json!({ "kind": "database", "message": "A database error occurred." })
        );
        assert_eq!(log, [format!("ERROR {error}")]);
    }

    #[test]
    fn migration_error_serializes_without_the_table_name() {
        let error = DbError::MigrationBrokeForeignKey {
            version: 2,
            table: "framework_sections".to_owned(),
        };

        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({ "kind": "database", "message": "A database error occurred." })
        );
    }

    #[test]
    fn unreadable_builtins_serialize_without_the_parse_error() {
        let error = DbError::from(serde_json::from_str::<()>("not json").unwrap_err());

        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({ "kind": "database", "message": "A database error occurred." })
        );
    }

    #[test]
    fn not_found_serializes_with_its_own_kind_and_message_without_logging() {
        let error = DbError::NotFound {
            entity: Entity::Framework,
            id: "costar".to_owned(),
        };

        let (serialized, log) = logged(|| serde_json::to_value(&error).unwrap());

        assert_eq!(
            serialized,
            json!({ "kind": "notFound", "message": "framework costar not found" })
        );
        assert_eq!(log, Vec::<String>::new());
    }

    #[test]
    fn invalid_errors_serialize_with_their_own_kind_and_message() {
        let (blank, blank_log) =
            logged(|| serde_json::to_value(DbError::BlankProjectName).unwrap());
        let (taken, taken_log) = logged(|| {
            serde_json::to_value(DbError::ProjectNameTaken {
                name: "API".to_owned(),
            })
            .unwrap()
        });

        assert_eq!(
            blank,
            json!({ "kind": "invalid", "message": "A project name can't be blank." })
        );
        assert_eq!(
            taken,
            json!({
                "kind": "invalid",
                "message": "A project named “API” already exists."
            })
        );
        assert_eq!(blank_log, Vec::<String>::new());
        assert_eq!(taken_log, Vec::<String>::new());
    }

    #[test]
    fn app_error_serializes_with_its_own_message() {
        let error = DbError::SchemaTooNew {
            found: 3,
            supported: 2,
        };

        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({ "kind": "database", "message": error.to_string() })
        );
    }
}
