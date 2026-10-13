//! Tests for the app's schema as the migrations leave it. The migration
//! runner's own behaviour is tested in `migrate.rs`.

use rusqlite::Connection;

use super::test_support::{
    count, insert_entry, insert_framework, insert_section, migrated, schema_object_exists,
    try_insert_entry, try_insert_framework, try_insert_section,
};

/// One framework with two sections and one prompt entry linked to it.
fn insert_framework_with_entry(conn: &Connection) {
    insert_framework(conn, "f", false);
    insert_section(conn, "f", 0, "a");
    insert_section(conn, "f", 1, "b");
    insert_entry(conn, "e", Some("f"));
}

#[test]
fn migrated_database_has_the_schema() {
    let conn = migrated();

    for table in ["frameworks", "framework_sections", "prompt_entries"] {
        assert!(schema_object_exists(&conn, "table", table), "{table}");
    }
    for index in [
        "prompt_entries_created_at",
        "prompt_entries_framework_id_created_at",
    ] {
        assert!(schema_object_exists(&conn, "index", index), "{index}");
    }
}

#[test]
fn only_custom_frameworks_have_uuid_ids() {
    let conn = migrated();
    let uuid = "0192d4c8-7b3a-7f00-8a1e-3c5d7e9f0b2a";

    // Proves the statement itself is fine, so the failures below come from the id check.
    try_insert_framework(&conn, uuid, true).unwrap();
    try_insert_framework(&conn, "rtf", false).unwrap();
    assert!(
        try_insert_framework(&conn, "risen", true).is_err(),
        "custom framework with a slug id"
    );
    assert!(
        try_insert_framework(&conn, "0192d4c8-7b3a-7f00-8a1e-3c5d7e9f0b2b", false).is_err(),
        "built-in framework with a UUID id"
    );
    assert!(
        try_insert_framework(&conn, "0192D4C8-7B3A-7F00-8A1E-3C5D7E9F0B2C", true).is_err(),
        "UUID ids are lowercase"
    );
}

#[test]
fn frameworks_reject_an_empty_name() {
    let conn = migrated();

    let empty_name = conn.execute(
        "INSERT INTO frameworks (id, name, description, template, is_custom, created_at, updated_at)
         VALUES ('f', '', '', '', 0, 0, 0)",
        [],
    );

    assert!(empty_name.is_err());
}

#[test]
fn sections_reject_an_empty_key_and_a_negative_position() {
    let conn = migrated();
    insert_framework(&conn, "f", false);

    // Proves the statement itself is fine, so the failures below come from the checks.
    try_insert_section(&conn, "f", 0, "a").unwrap();
    assert!(try_insert_section(&conn, "f", 1, "").is_err(), "empty key");
    assert!(
        try_insert_section(&conn, "f", -1, "b").is_err(),
        "negative position"
    );
}

#[test]
fn listing_one_frameworks_history_newest_first_uses_an_index() {
    let conn = migrated();

    let plan: Vec<String> = conn
        .prepare(
            "EXPLAIN QUERY PLAN
             SELECT * FROM prompt_entries WHERE framework_id = ?1 ORDER BY created_at DESC",
        )
        .unwrap()
        .query_map(["f"], |row| row.get("detail"))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();

    assert!(
        plan.iter()
            .any(|step| step.contains("USING INDEX prompt_entries_framework_id_created_at")),
        "{plan:?}"
    );
    assert!(
        !plan.iter().any(|step| step.contains("TEMP B-TREE")),
        "{plan:?}"
    );
}

#[test]
fn deleting_a_framework_deletes_its_sections() {
    let conn = migrated();
    insert_framework_with_entry(&conn);

    conn.execute("DELETE FROM frameworks WHERE id = 'f'", [])
        .unwrap();

    assert_eq!(count(&conn, "SELECT count(*) FROM framework_sections"), 0);
}

#[test]
fn deleting_a_framework_keeps_its_entries_but_unlinks_them() {
    let conn = migrated();
    insert_framework_with_entry(&conn);

    conn.execute("DELETE FROM frameworks WHERE id = 'f'", [])
        .unwrap();

    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM prompt_entries WHERE id = 'e' AND framework_id IS NULL"
        ),
        1
    );
}

#[test]
fn section_keys_and_positions_are_unique_within_a_framework() {
    let conn = migrated();
    insert_framework_with_entry(&conn);

    assert!(
        try_insert_section(&conn, "f", 2, "a").is_err(),
        "duplicate key should be rejected"
    );
    assert!(
        try_insert_section(&conn, "f", 0, "c").is_err(),
        "duplicate position should be rejected"
    );
}

#[test]
fn prompt_entries_reject_invalid_json() {
    let conn = migrated();

    // Proves the statement itself is fine, so the failures below come from the JSON checks.
    try_insert_entry(&conn, "valid", None, "{}", "{}").unwrap();
    assert!(try_insert_entry(&conn, "bad_snapshot", None, "not json", "{}").is_err());
    assert!(try_insert_entry(&conn, "bad_values", None, "{}", "not json").is_err());
}
