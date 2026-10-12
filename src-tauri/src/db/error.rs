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
}
