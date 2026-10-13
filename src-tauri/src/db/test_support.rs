//! Helpers shared by the data layer's tests.

use std::sync::{Mutex, Once};
use std::thread::{self, ThreadId};

use rusqlite::Connection;

use super::migrate::migrate;
use super::open_in_memory;

/// A fresh in-memory database with every migration applied.
pub fn migrated() -> Connection {
    let mut conn = open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn
}

/// Runs a query that returns one number, such as `SELECT count(*) ...`.
pub fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

pub fn foreign_keys_enabled(conn: &Connection) -> bool {
    conn.pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .unwrap()
}

/// Whether the schema has an object of `kind` (`table`, `index`, ...) named `name`.
pub fn schema_object_exists(conn: &Connection, kind: &str, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = ?1 AND name = ?2)",
        [kind, name],
        |row| row.get(0),
    )
    .unwrap()
}

pub fn table_exists(conn: &Connection, name: &str) -> bool {
    schema_object_exists(conn, "table", name)
}

/// Inserts a framework with placeholder text in every other column.
pub fn try_insert_framework(
    conn: &Connection,
    id: &str,
    is_custom: bool,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO frameworks (id, name, description, template, is_custom, created_at, updated_at)
         VALUES (?1, 'Framework', '', '', ?2, 0, 0)",
        rusqlite::params![id, is_custom],
    )
}

pub fn insert_framework(conn: &Connection, id: &str, is_custom: bool) {
    try_insert_framework(conn, id, is_custom).unwrap();
}

/// Inserts a section whose label is its key in upper case.
pub fn try_insert_section(
    conn: &Connection,
    framework_id: &str,
    position: i64,
    key: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO framework_sections (framework_id, position, key, label, help_text)
         VALUES (?1, ?2, ?3, ?4, '')",
        rusqlite::params![framework_id, position, key, key.to_uppercase()],
    )
}

pub fn insert_section(conn: &Connection, framework_id: &str, position: i64, key: &str) {
    try_insert_section(conn, framework_id, position, key).unwrap();
}

/// Inserts a prompt entry with the given JSON columns.
pub fn try_insert_entry(
    conn: &Connection,
    id: &str,
    framework_id: Option<&str>,
    snapshot: &str,
    values: &str,
) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO prompt_entries (id, framework_id, framework_snapshot, section_values, rendered_prompt, created_at)
         VALUES (?1, ?2, ?3, ?4, 'rendered', 0)",
        rusqlite::params![id, framework_id, snapshot, values],
    )
}

/// Inserts a prompt entry with empty JSON objects for its snapshot and values.
pub fn insert_entry(conn: &Connection, id: &str, framework_id: Option<&str>) {
    try_insert_entry(conn, id, framework_id, "{}", "{}").unwrap();
}

/// Runs `f` and returns its result together with every line it logged, each as
/// `"LEVEL message"`. Only the calling thread's log lines are collected, so
/// tests running in parallel don't see each other's.
pub fn logged<T>(f: impl FnOnce() -> T) -> (T, Vec<String>) {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        log::set_logger(&RECORDER).expect("no other logger is installed in tests");
        log::set_max_level(log::LevelFilter::Trace);
    });

    let thread = thread::current().id();
    RECORDER.lock().push((thread, Vec::new()));
    let result = f();
    let mut captures = RECORDER.lock();
    let index = captures
        .iter()
        .rposition(|(id, _)| *id == thread)
        .expect("this thread's capture is still registered");
    let (_, lines) = captures.remove(index);
    (result, lines)
}

static RECORDER: Recorder = Recorder {
    captures: Mutex::new(Vec::new()),
};

/// One capture per thread currently inside `logged`.
struct Recorder {
    captures: Mutex<Vec<(ThreadId, Vec<String>)>>,
}

impl Recorder {
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<(ThreadId, Vec<String>)>> {
        // A test that panicked while holding the lock shouldn't fail the others.
        self.captures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl log::Log for Recorder {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        let thread = thread::current().id();
        if let Some((_, lines)) = self.lock().iter_mut().rfind(|(id, _)| *id == thread) {
            lines.push(format!("{} {}", record.level(), record.args()));
        }
    }

    fn flush(&self) {}
}
