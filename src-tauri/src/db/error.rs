use serde::ser::{Serialize, SerializeStruct, Serializer};

/// Errors from the data layer. They reach the frontend serialized as
/// `{ message }`. A `kind` field for the frontend to branch on can be added
/// once there is more than one kind to tell apart.
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
}

impl DbError {
    /// The text shown to the user. Errors that quote SQL, table names or JSON
    /// are for developers, so they get a generic message instead.
    fn message(&self) -> String {
        match self {
            DbError::Sqlite(_)
            | DbError::MigrationBrokeForeignKey { .. }
            | DbError::BuiltinsUnreadable(_) => "A database error occurred.".to_owned(),
            DbError::SchemaTooNew { .. } => self.to_string(),
        }
    }
}

/// Serializing is the point where the error leaves the data layer for the
/// frontend, and the user-facing message drops the detail (SQLite's error
/// code, the table name), so the full text is logged here first. Otherwise a
/// full disk or a read-only database file would be indistinguishable from a
/// bug.
impl Serialize for DbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        log::error!("{self}");
        let mut payload = serializer.serialize_struct("DbError", 1)?;
        payload.serialize_field("message", &self.message())?;
        payload.end()
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
            json!({ "message": "A database error occurred." })
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
            json!({ "message": "A database error occurred." })
        );
    }

    #[test]
    fn unreadable_builtins_serialize_without_the_parse_error() {
        let error = DbError::from(serde_json::from_str::<()>("not json").unwrap_err());

        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({ "message": "A database error occurred." })
        );
    }

    #[test]
    fn app_error_serializes_with_its_own_message() {
        let error = DbError::SchemaTooNew {
            found: 3,
            supported: 2,
        };

        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            json!({ "message": error.to_string() })
        );
    }
}
