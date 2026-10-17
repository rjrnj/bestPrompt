//! The prompt history: saving and reading prompt entries.

use std::collections::BTreeMap;

use rusqlite::types::ToSql;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params, params_from_iter};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use super::frameworks::{Section, get_framework};
use super::search::fts_query;
use super::{DbError, Entity, now_millis};

/// The framework as it was when the entry was saved, so the entry can be
/// reopened after the framework is edited or deleted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FrameworkSnapshot {
    pub name: String,
    pub template: String,
    /// Absent in entries saved before summary keys existed.
    #[serde(default)]
    pub summary_key: Option<String>,
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PromptEntry {
    pub id: String,
    /// The framework the entry was built with, or `None` once that framework
    /// has been deleted. Only for grouping; reopening uses the snapshot.
    pub framework_id: Option<String>,
    pub framework_snapshot: FrameworkSnapshot,
    /// What the user typed, by section key.
    pub section_values: BTreeMap<String, String>,
    pub rendered_prompt: String,
    pub title: Option<String>,
    /// The project the entry is filed under, or `None` for no project (also
    /// after the project is deleted).
    pub project_id: Option<String>,
    pub created_at: i64,
    /// How many title or project edits the entry has had since it was saved,
    /// so of two copies read at different times the one with the higher
    /// version is the newer. Clearing the project when it is deleted doesn't
    /// count: ties go to the copy read later.
    pub version: i64,
}

/// What the frontend sends to save an entry. The id, timestamp and snapshot
/// are filled in here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NewPromptEntry {
    pub framework_id: String,
    pub section_values: BTreeMap<String, String>,
    pub rendered_prompt: String,
    /// Blank or whitespace-only is stored as no title.
    pub title: Option<String>,
    pub project_id: Option<String>,
}

/// Saves an entry and returns it as stored.
pub fn save_prompt_entry(
    conn: &mut Connection,
    new: &NewPromptEntry,
) -> Result<PromptEntry, DbError> {
    insert(conn, new, Uuid::now_v7().to_string(), now_millis())
}

fn insert(
    conn: &mut Connection,
    new: &NewPromptEntry,
    id: String,
    now: i64,
) -> Result<PromptEntry, DbError> {
    // One transaction for the read and the write, so the snapshot is of the
    // framework the entry is linked to. IMMEDIATE takes the write lock before
    // the read; a deferred transaction would read first and could then find
    // the framework changed or gone when it came to insert.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let framework = get_framework(&tx, &new.framework_id)?;
    if let Some(project_id) = &new.project_id {
        check_project_exists(&tx, project_id)?;
    }
    let entry = PromptEntry {
        id,
        framework_id: Some(framework.id),
        framework_snapshot: FrameworkSnapshot {
            name: framework.name,
            template: framework.template,
            summary_key: framework.summary_key,
            sections: framework.sections,
        },
        section_values: new.section_values.clone(),
        rendered_prompt: new.rendered_prompt.clone(),
        title: stored_title(new.title.as_deref()),
        project_id: new.project_id.clone(),
        created_at: now,
        version: 0,
    };
    tx.execute(
        "INSERT INTO prompt_entries
             (id, framework_id, framework_snapshot, section_values, rendered_prompt,
              title, project_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id,
            entry.framework_id,
            json(&entry.framework_snapshot),
            json(&entry.section_values),
            entry.rendered_prompt,
            entry.title,
            entry.project_id,
            entry.created_at,
        ],
    )?;
    tx.commit()?;
    Ok(entry)
}

const ENTRY_COLUMNS: &str =
    "SELECT id, framework_id, framework_snapshot, section_values, rendered_prompt,
            title, project_id, created_at, version
     FROM prompt_entries";

/// Which project's entries to list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum ProjectFilter {
    /// Entries in any project or none.
    #[default]
    Any,
    /// Entries with no project.
    Unassigned,
    /// Entries in one project.
    Project { id: String },
}

/// What to list from the history. Every part narrows the result.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EntryQuery {
    pub project: ProjectFilter,
    pub framework_id: Option<String>,
    /// Words to find in titles and section text. Every word prefix-matches;
    /// blank text means no search.
    pub search: Option<String>,
}

/// Where the next page starts: just after the listed entry with this time and
/// id, in newest-first order. Unlike an offset it stays put when entries are
/// saved, deleted or moved after the earlier pages were listed, and the entry
/// it names need not still exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EntryCursor {
    pub created_at: i64,
    pub id: String,
}

/// A page of the entries matching `query`, newest first, starting after
/// `after` or at the newest. The filters are bound as parameters; only fixed
/// SQL fragments are joined into the text.
pub fn list_prompt_entries(
    conn: &Connection,
    query: &EntryQuery,
    limit: u32,
    after: Option<&EntryCursor>,
) -> Result<Vec<PromptEntry>, DbError> {
    let mut conditions: Vec<&str> = Vec::new();
    let mut args: Vec<Box<dyn ToSql>> = Vec::new();
    match &query.project {
        ProjectFilter::Any => {}
        ProjectFilter::Unassigned => conditions.push("project_id IS NULL"),
        ProjectFilter::Project { id } => {
            conditions.push("project_id = ?");
            args.push(Box::new(id.clone()));
        }
    }
    if let Some(framework_id) = &query.framework_id {
        conditions.push("framework_id = ?");
        args.push(Box::new(framework_id.clone()));
    }
    if let Some(words) = query.search.as_deref().and_then(fts_query) {
        conditions.push(
            "id IN (SELECT entry_id FROM prompt_entries_fts WHERE prompt_entries_fts MATCH ?)",
        );
        args.push(Box::new(words));
    }
    if let Some(after) = after {
        // The same order as ORDER BY, so the page starts right after it.
        conditions.push("(created_at, id) < (?, ?)");
        args.push(Box::new(after.created_at));
        args.push(Box::new(after.id.clone()));
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };
    args.push(Box::new(limit));

    let entries = conn
        .prepare(&format!(
            "{ENTRY_COLUMNS}{where_clause} ORDER BY created_at DESC, id DESC LIMIT ?"
        ))?
        .query_map(
            params_from_iter(args.iter().map(|arg| arg.as_ref())),
            entry_from_row,
        )?
        .collect::<Result<_, _>>()?;
    Ok(entries)
}

/// One entry by id.
pub fn get_prompt_entry(conn: &Connection, id: &str) -> Result<PromptEntry, DbError> {
    conn.query_row(
        &format!("{ENTRY_COLUMNS} WHERE id = ?1"),
        [id],
        entry_from_row,
    )
    .optional()?
    .ok_or_else(|| entry_not_found(id))
}

fn entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PromptEntry> {
    Ok(PromptEntry {
        id: row.get(0)?,
        framework_id: row.get(1)?,
        framework_snapshot: json_column(row, 2)?,
        section_values: json_column(row, 3)?,
        rendered_prompt: row.get(4)?,
        title: row.get(5)?,
        project_id: row.get(6)?,
        created_at: row.get(7)?,
        version: row.get(8)?,
    })
}

/// A blank title (by Unicode whitespace; the table's CHECK only covers
/// spaces) is stored as no title; anything else is stored as given.
fn stored_title(title: Option<&str>) -> Option<String> {
    title
        .filter(|title| !title.trim().is_empty())
        .map(str::to_owned)
}

fn check_project_exists(conn: &Connection, id: &str) -> Result<(), DbError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM projects WHERE id = ?1)",
        [id],
        |row| row.get(0),
    )?;
    if exists {
        Ok(())
    } else {
        Err(DbError::NotFound {
            entity: Entity::Project,
            id: id.to_owned(),
        })
    }
}

/// Sets or clears an entry's title and returns the entry.
pub fn set_entry_title(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
) -> Result<PromptEntry, DbError> {
    let changed = conn.execute(
        "UPDATE prompt_entries SET title = ?1, version = version + 1 WHERE id = ?2",
        params![stored_title(title), id],
    )?;
    if changed == 0 {
        return Err(entry_not_found(id));
    }
    get_prompt_entry(conn, id)
}

/// Moves an entry to a project, or out of any project, and returns the entry.
pub fn set_entry_project(
    conn: &Connection,
    id: &str,
    project_id: Option<&str>,
) -> Result<PromptEntry, DbError> {
    if let Some(project_id) = project_id {
        check_project_exists(conn, project_id)?;
    }
    let changed = conn.execute(
        "UPDATE prompt_entries SET project_id = ?1, version = version + 1 WHERE id = ?2",
        params![project_id, id],
    )?;
    if changed == 0 {
        return Err(entry_not_found(id));
    }
    get_prompt_entry(conn, id)
}

/// Deletes an entry; its search row goes with it.
pub fn delete_prompt_entry(conn: &Connection, id: &str) -> Result<(), DbError> {
    let deleted = conn.execute("DELETE FROM prompt_entries WHERE id = ?1", [id])?;
    if deleted == 0 {
        return Err(entry_not_found(id));
    }
    Ok(())
}

/// The project of the newest entry. `None` when there are no entries or the
/// newest has no project.
pub fn latest_entry_project(conn: &Connection) -> Result<Option<String>, DbError> {
    let project = conn
        .query_row(
            "SELECT project_id FROM prompt_entries ORDER BY created_at DESC, id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(project.flatten())
}

fn entry_not_found(id: &str) -> DbError {
    DbError::NotFound {
        entity: Entity::PromptEntry,
        id: id.to_owned(),
    }
}

/// Reads a JSON column into its type. The schema only admits valid JSON, so a
/// value that doesn't fit the type is reported like any other bad column.
fn json_column<T: serde::de::DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let text: String = row.get(index)?;
    serde_json::from_str(&text).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

/// Plain structs of strings always serialize.
fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).expect("entry fields serialize to JSON")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Entity;
    use crate::db::test_support::{count, insert_framework, insert_section, migrated};

    fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn saving_snapshots_the_framework_into_the_entry() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_section(&conn, "f", 0, "a");
        insert_section(&conn, "f", 1, "b");

        let entry = save_prompt_entry(
            &mut conn,
            &NewPromptEntry {
                framework_id: "f".to_owned(),
                section_values: values(&[("a", "one"), ("b", "")]),
                rendered_prompt: "# A\none".to_owned(),
                title: None,
                project_id: None,
            },
        )
        .unwrap();

        assert_eq!(entry.framework_id.as_deref(), Some("f"));
        assert_eq!(
            entry.framework_snapshot,
            FrameworkSnapshot {
                name: "Framework".to_owned(),
                template: String::new(),
                summary_key: None,
                sections: vec![
                    Section {
                        key: "a".to_owned(),
                        label: "A".to_owned(),
                        help_text: String::new(),
                    },
                    Section {
                        key: "b".to_owned(),
                        label: "B".to_owned(),
                        help_text: String::new(),
                    },
                ],
            }
        );
        assert_eq!(entry.section_values, values(&[("a", "one"), ("b", "")]));
        assert_eq!(entry.rendered_prompt, "# A\none");
    }

    #[test]
    fn saving_snapshots_the_summary_key() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_section(&conn, "f", 0, "a");
        conn.execute("UPDATE frameworks SET summary_key = 'a' WHERE id = 'f'", [])
            .unwrap();

        let entry = save_prompt_entry(&mut conn, &new_entry("f")).unwrap();

        assert_eq!(entry.framework_snapshot.summary_key.as_deref(), Some("a"));
        let stored = get_prompt_entry(&conn, &entry.id).unwrap();
        assert_eq!(stored.framework_snapshot.summary_key.as_deref(), Some("a"));
    }

    #[test]
    fn a_snapshot_saved_before_summary_keys_reads_as_none() {
        let snapshot: FrameworkSnapshot =
            serde_json::from_str(r#"{"name":"N","template":"T","sections":[]}"#).unwrap();

        assert_eq!(snapshot.summary_key, None);
    }

    fn new_entry(framework_id: &str) -> NewPromptEntry {
        NewPromptEntry {
            framework_id: framework_id.to_owned(),
            section_values: values(&[("a", "one")]),
            rendered_prompt: "rendered".to_owned(),
            title: None,
            project_id: None,
        }
    }

    #[test]
    fn saving_gives_the_entry_a_lowercase_uuid_v7_id_and_the_current_time() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        let before = now_millis();

        let entry = save_prompt_entry(&mut conn, &new_entry("f")).unwrap();

        let id = Uuid::parse_str(&entry.id).expect("a UUID");
        assert_eq!(id.get_version_num(), 7);
        assert_eq!(entry.id, entry.id.to_lowercase());
        assert!(entry.created_at >= before);
        assert!(entry.created_at <= now_millis());
    }

    #[test]
    fn saving_for_an_unknown_framework_is_a_not_found_error_and_stores_nothing() {
        let mut conn = migrated();

        let result = save_prompt_entry(&mut conn, &new_entry("missing"));

        assert!(matches!(
            result,
            Err(DbError::NotFound {
                entity: Entity::Framework,
                ..
            })
        ));
        assert_eq!(count(&conn, "SELECT count(*) FROM prompt_entries"), 0);
    }

    #[test]
    fn a_saved_entry_reads_back_the_same() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_section(&conn, "f", 0, "a");
        let saved = save_prompt_entry(&mut conn, &new_entry("f")).unwrap();

        let read = get_prompt_entry(&conn, &saved.id).unwrap();

        assert_eq!(read, saved);
    }

    /// Saves entries at times 1, 2 and 3, with ids that sort the other way
    /// round so an order by id would be caught.
    fn save_three(conn: &mut Connection) {
        insert_framework(conn, "f", false);
        for (id, time) in [("c", 1), ("b", 2), ("a", 3)] {
            insert(conn, &new_entry("f"), id.to_owned(), time).unwrap();
        }
    }

    fn ids(entries: &[PromptEntry]) -> Vec<&str> {
        entries.iter().map(|entry| entry.id.as_str()).collect()
    }

    fn cursor_after(entry: &PromptEntry) -> EntryCursor {
        EntryCursor {
            created_at: entry.created_at,
            id: entry.id.clone(),
        }
    }

    #[test]
    fn lists_entries_newest_first() {
        let mut conn = migrated();
        save_three(&mut conn);

        let entries = list_prompt_entries(&conn, &EntryQuery::default(), 10, None).unwrap();

        assert_eq!(ids(&entries), ["a", "b", "c"]);
    }

    #[test]
    fn lists_the_page_after_a_cursor() {
        let mut conn = migrated();
        save_three(&mut conn);
        let first = list_prompt_entries(&conn, &EntryQuery::default(), 1, None).unwrap();

        let entries = list_prompt_entries(
            &conn,
            &EntryQuery::default(),
            1,
            Some(&cursor_after(&first[0])),
        )
        .unwrap();

        assert_eq!(ids(&entries), ["b"]);
    }

    #[test]
    fn an_entry_saved_after_the_first_page_does_not_repeat_a_row() {
        let mut conn = migrated();
        save_three(&mut conn);
        let first = list_prompt_entries(&conn, &EntryQuery::default(), 2, None).unwrap();
        insert(&mut conn, &new_entry("f"), "new".to_owned(), 4).unwrap();

        let next = list_prompt_entries(
            &conn,
            &EntryQuery::default(),
            2,
            Some(&cursor_after(&first[1])),
        )
        .unwrap();

        assert_eq!(ids(&next), ["c"]);
    }

    #[test]
    fn deleting_a_listed_entry_does_not_skip_a_row() {
        let mut conn = migrated();
        save_three(&mut conn);
        let first = list_prompt_entries(&conn, &EntryQuery::default(), 2, None).unwrap();
        delete_prompt_entry(&conn, "b").unwrap();

        let next = list_prompt_entries(
            &conn,
            &EntryQuery::default(),
            2,
            Some(&cursor_after(&first[1])),
        )
        .unwrap();

        assert_eq!(ids(&next), ["c"]);
    }

    /// Saves an entry at a given time with the given title, project, framework
    /// and section values.
    fn save_at(
        conn: &mut Connection,
        id: &str,
        time: i64,
        framework: &str,
        title: Option<&str>,
        project: Option<&str>,
        sections: &[(&str, &str)],
    ) {
        let new = NewPromptEntry {
            framework_id: framework.to_owned(),
            section_values: values(sections),
            rendered_prompt: "rendered".to_owned(),
            title: title.map(str::to_owned),
            project_id: project.map(str::to_owned),
        };
        insert(conn, &new, id.to_owned(), time).unwrap();
    }

    fn searching(text: &str) -> EntryQuery {
        EntryQuery {
            search: Some(text.to_owned()),
            ..EntryQuery::default()
        }
    }

    fn found(conn: &Connection, query: &EntryQuery) -> Vec<String> {
        list_prompt_entries(conn, query, 50, None)
            .unwrap()
            .into_iter()
            .map(|entry| entry.id)
            .collect()
    }

    #[test]
    fn filters_by_project_unassigned_and_framework() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_framework(&conn, "g", false);
        insert_project(&conn, "p");
        insert_project(&conn, "q");
        save_at(&mut conn, "1", 1, "f", None, Some("p"), &[]);
        save_at(&mut conn, "2", 2, "g", None, Some("q"), &[]);
        save_at(&mut conn, "3", 3, "f", None, None, &[]);
        save_at(&mut conn, "4", 4, "g", None, Some("p"), &[]);

        let project = |id: &str| EntryQuery {
            project: ProjectFilter::Project { id: id.to_owned() },
            ..EntryQuery::default()
        };
        assert_eq!(found(&conn, &EntryQuery::default()), ["4", "3", "2", "1"]);
        assert_eq!(found(&conn, &project("p")), ["4", "1"]);
        assert_eq!(found(&conn, &project("missing")), Vec::<String>::new());
        assert_eq!(
            found(
                &conn,
                &EntryQuery {
                    project: ProjectFilter::Unassigned,
                    ..EntryQuery::default()
                }
            ),
            ["3"]
        );
        assert_eq!(
            found(
                &conn,
                &EntryQuery {
                    framework_id: Some("g".to_owned()),
                    ..EntryQuery::default()
                }
            ),
            ["4", "2"]
        );
        assert_eq!(
            found(
                &conn,
                &EntryQuery {
                    framework_id: Some("f".to_owned()),
                    ..project("p")
                }
            ),
            ["1"]
        );
    }

    #[test]
    fn search_matches_title_and_section_text_by_word_prefix() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        save_at(
            &mut conn,
            "1",
            1,
            "f",
            Some("Parse CSV"),
            None,
            &[("a", "x")],
        );
        let second = [("a", "first"), ("b", "convert the csvfile")];
        save_at(&mut conn, "2", 2, "f", None, None, &second);
        save_at(&mut conn, "3", 3, "f", None, None, &[("a", "unrelated")]);

        assert_eq!(found(&conn, &searching("pars")), ["1"]);
        assert_eq!(found(&conn, &searching("csv")), ["2", "1"]);
        assert_eq!(found(&conn, &searching("pars csv")), ["1"]);
        assert_eq!(found(&conn, &searching("first convert")), ["2"]);
        assert_eq!(found(&conn, &searching("sv")), Vec::<String>::new());
    }

    #[test]
    fn search_ignores_case_and_diacritics() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        save_at(&mut conn, "1", 1, "f", Some("Café Résumé"), None, &[]);
        save_at(&mut conn, "2", 2, "f", None, None, &[("a", "naive")]);

        assert_eq!(found(&conn, &searching("CAFE")), ["1"]);
        assert_eq!(found(&conn, &searching("résumé")), ["1"]);
        assert_eq!(found(&conn, &searching("naïve")), ["2"]);
    }

    #[test]
    fn search_combines_with_filters() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_framework(&conn, "g", false);
        insert_project(&conn, "p");
        save_at(&mut conn, "1", 1, "f", Some("report"), Some("p"), &[]);
        save_at(&mut conn, "2", 2, "g", Some("report"), Some("p"), &[]);
        save_at(&mut conn, "3", 3, "f", Some("report"), None, &[]);
        save_at(&mut conn, "4", 4, "f", Some("other"), Some("p"), &[]);

        let query = EntryQuery {
            project: ProjectFilter::Project { id: "p".to_owned() },
            framework_id: Some("f".to_owned()),
            search: Some("report".to_owned()),
        };

        assert_eq!(found(&conn, &query), ["1"]);
    }

    #[test]
    fn a_search_with_no_words_lists_everything() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        save_at(&mut conn, "1", 1, "f", None, None, &[]);

        assert_eq!(found(&conn, &searching("  ")), ["1"]);
        assert_eq!(found(&conn, &searching("\"")), ["1"]);
    }

    #[test]
    fn search_treats_fts_syntax_as_plain_words() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        save_at(
            &mut conn,
            "1",
            1,
            "f",
            Some("and near x"),
            None,
            &[("a", "a b")],
        );

        for text in [
            "\"",
            "a\"b",
            "*",
            "-x",
            "(",
            "AND",
            "NEAR(a b)",
            "a OR",
            "col:x",
            "^a",
            "\" *",
        ] {
            let result = list_prompt_entries(&conn, &searching(text), 50, None);
            assert!(result.is_ok(), "{text:?}: {result:?}");
        }
        // Operators are words: "AND" matches the title instead of combining terms.
        assert_eq!(found(&conn, &searching("AND")), ["1"]);
        assert_eq!(found(&conn, &searching("zzz AND")), Vec::<String>::new());
        // A word with no letters in it is dropped, not a reason to find nothing.
        assert_eq!(found(&conn, &searching("x -")), ["1"]);
    }

    #[test]
    fn paging_is_newest_first_without_gaps_or_repeats() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        // Two entries share a time and fall on either side of a page break
        // (e d | c b | a), so the cursor's id tie-break decides where the
        // next page starts.
        for (id, time) in [("a", 1), ("b", 2), ("c", 3), ("d", 3), ("e", 4)] {
            save_at(&mut conn, id, time, "f", Some("page"), None, &[]);
        }
        let all = found(&conn, &searching("page"));
        assert_eq!(all, ["e", "d", "c", "b", "a"]);

        let mut paged = Vec::new();
        let mut after = None;
        loop {
            let page = list_prompt_entries(&conn, &searching("page"), 2, after.as_ref()).unwrap();
            let Some(last) = page.last() else { break };
            after = Some(cursor_after(last));
            paged.extend(page.into_iter().map(|entry| entry.id));
        }

        assert_eq!(paged, all);
    }

    #[test]
    fn deleting_the_framework_keeps_the_entry_readable_from_its_snapshot() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_section(&conn, "f", 0, "a");
        let saved = save_prompt_entry(&mut conn, &new_entry("f")).unwrap();

        conn.execute("DELETE FROM frameworks WHERE id = 'f'", [])
            .unwrap();

        let read = get_prompt_entry(&conn, &saved.id).unwrap();
        assert_eq!(read.framework_id, None);
        assert_eq!(read.framework_snapshot, saved.framework_snapshot);
        assert_eq!(
            ids(&list_prompt_entries(&conn, &EntryQuery::default(), 10, None).unwrap()),
            [saved.id.as_str()]
        );
    }

    /// The framework is read and the entry written in one transaction, so a
    /// framework deleted meanwhile (by another instance's built-in sync, or
    /// later by the user) is reported as not found. Reading it first and
    /// then inserting would instead snapshot a framework that no longer
    /// exists and fail on the foreign key.
    #[test]
    fn saving_while_another_connection_deletes_the_framework_is_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let mut other = crate::db::open(&path).unwrap();
        crate::db::migrate::migrate(&mut other).unwrap();
        insert_framework(&other, "f", false);

        // The other connection holds the write lock while it deletes the framework.
        let tx = other
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        let saver = std::thread::spawn({
            let path = path.clone();
            move || {
                let mut conn = crate::db::open(&path).unwrap();
                save_prompt_entry(&mut conn, &new_entry("f"))
            }
        });
        // Give the save time to reach the lock. If it hasn't yet, the test
        // still passes, it just doesn't exercise the wait.
        std::thread::sleep(std::time::Duration::from_millis(200));
        tx.execute("DELETE FROM frameworks WHERE id = 'f'", [])
            .unwrap();
        tx.commit().unwrap();

        let result = saver.join().unwrap();

        assert!(
            matches!(
                result,
                Err(DbError::NotFound {
                    entity: Entity::Framework,
                    ..
                })
            ),
            "{result:?}"
        );
    }

    fn insert_project(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?1, 0, 0)",
            [id],
        )
        .unwrap();
    }

    fn saved_with(
        conn: &mut Connection,
        title: Option<&str>,
        project_id: Option<&str>,
    ) -> PromptEntry {
        save_prompt_entry(
            conn,
            &NewPromptEntry {
                title: title.map(str::to_owned),
                project_id: project_id.map(str::to_owned),
                ..new_entry("f")
            },
        )
        .unwrap()
    }

    fn assert_not_found(result: Result<impl std::fmt::Debug, DbError>, expected: Entity) {
        match result {
            Err(DbError::NotFound { entity, .. }) => assert_eq!(entity, expected),
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn save_stores_title_and_project() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_project(&conn, "p");

        let saved = saved_with(&mut conn, Some("  My title "), Some("p"));

        assert_eq!(saved.title.as_deref(), Some("  My title "));
        assert_eq!(saved.project_id.as_deref(), Some("p"));
        assert_eq!(get_prompt_entry(&conn, &saved.id).unwrap(), saved);
    }

    #[test]
    fn save_stores_a_blank_title_as_none() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);

        for title in [None, Some(""), Some("  "), Some("\t\n ")] {
            let saved = saved_with(&mut conn, title, None);
            assert_eq!(saved.title, None, "{title:?}");
            assert_eq!(get_prompt_entry(&conn, &saved.id).unwrap().title, None);
        }
    }

    #[test]
    fn save_with_an_unknown_project_is_not_found() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);

        let result = save_prompt_entry(
            &mut conn,
            &NewPromptEntry {
                project_id: Some("missing".to_owned()),
                ..new_entry("f")
            },
        );

        assert_not_found(result, Entity::Project);
        assert_eq!(count(&conn, "SELECT count(*) FROM prompt_entries"), 0);
    }

    #[test]
    fn set_title_changes_only_the_title() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_project(&conn, "p");
        let saved = saved_with(&mut conn, Some("old"), Some("p"));

        let changed = set_entry_title(&conn, &saved.id, Some("new")).unwrap();

        assert_eq!(
            changed,
            PromptEntry {
                title: Some("new".to_owned()),
                version: 1,
                ..saved
            }
        );
        assert_eq!(get_prompt_entry(&conn, &changed.id).unwrap(), changed);
    }

    #[test]
    fn each_edit_counts_one_version_from_zero() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_project(&conn, "p");
        let saved = saved_with(&mut conn, None, None);
        assert_eq!(saved.version, 0);
        assert_eq!(get_prompt_entry(&conn, &saved.id).unwrap().version, 0);

        let retitled = set_entry_title(&conn, &saved.id, Some("t")).unwrap();
        let moved = set_entry_project(&conn, &saved.id, Some("p")).unwrap();

        assert_eq!((retitled.version, moved.version), (1, 2));
        let listed = list_prompt_entries(&conn, &EntryQuery::default(), 10, None).unwrap();
        assert_eq!(listed[0].version, 2);
    }

    #[test]
    fn set_title_to_blank_clears_it() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        let saved = saved_with(&mut conn, Some("old"), None);

        for blank in [None, Some(""), Some(" \t\n")] {
            set_entry_title(&conn, &saved.id, Some("again")).unwrap();
            let cleared = set_entry_title(&conn, &saved.id, blank).unwrap();
            assert_eq!(cleared.title, None, "{blank:?}");
        }
    }

    #[test]
    fn set_project_moves_and_clears() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_project(&conn, "p");
        let saved = saved_with(&mut conn, Some("t"), None);

        let moved = set_entry_project(&conn, &saved.id, Some("p")).unwrap();
        assert_eq!(
            moved,
            PromptEntry {
                project_id: Some("p".to_owned()),
                version: 1,
                ..saved.clone()
            }
        );

        let cleared = set_entry_project(&conn, &saved.id, None).unwrap();
        let expected = PromptEntry {
            version: 2,
            ..saved.clone()
        };
        assert_eq!(cleared, expected);
        assert_eq!(get_prompt_entry(&conn, &saved.id).unwrap(), expected);
    }

    #[test]
    fn set_project_to_an_unknown_project_is_not_found() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_project(&conn, "p");
        let saved = saved_with(&mut conn, None, Some("p"));

        let result = set_entry_project(&conn, &saved.id, Some("missing"));

        assert_not_found(result, Entity::Project);
        assert_eq!(get_prompt_entry(&conn, &saved.id).unwrap(), saved);
    }

    #[test]
    fn edits_and_delete_report_an_unknown_entry_as_not_found() {
        let conn = migrated();
        insert_project(&conn, "p");

        assert_not_found(
            set_entry_title(&conn, "missing", Some("t")),
            Entity::PromptEntry,
        );
        assert_not_found(
            set_entry_project(&conn, "missing", Some("p")),
            Entity::PromptEntry,
        );
        assert_not_found(
            set_entry_project(&conn, "missing", None),
            Entity::PromptEntry,
        );
        assert_not_found(delete_prompt_entry(&conn, "missing"), Entity::PromptEntry);
    }

    #[test]
    fn delete_removes_the_entry_and_its_search_row() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        let kept = saved_with(&mut conn, Some("keep"), None);
        let gone = saved_with(&mut conn, Some("drop"), None);
        let search_rows = "SELECT count(*) FROM prompt_entries_fts";
        assert_eq!(count(&conn, search_rows), 2);

        delete_prompt_entry(&conn, &gone.id).unwrap();

        assert_not_found(get_prompt_entry(&conn, &gone.id), Entity::PromptEntry);
        assert_eq!(get_prompt_entry(&conn, &kept.id).unwrap(), kept);
        assert_eq!(count(&conn, search_rows), 1);
        let gone_rows: i64 = conn
            .query_row(
                "SELECT count(*) FROM prompt_entries_fts WHERE entry_id = ?1",
                [&gone.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(gone_rows, 0);
    }

    #[test]
    fn latest_entry_project_is_the_newest_entrys() {
        let mut conn = migrated();
        insert_framework(&conn, "f", false);
        insert_project(&conn, "p");
        insert_project(&conn, "q");
        assert_eq!(latest_entry_project(&conn).unwrap(), None);

        // Ids sort the other way round from times, so ordering by id would be caught.
        let save_at = |conn: &mut Connection, id: &str, time: i64, project: Option<&str>| {
            let new = NewPromptEntry {
                project_id: project.map(str::to_owned),
                ..new_entry("f")
            };
            insert(conn, &new, id.to_owned(), time).unwrap();
        };
        save_at(&mut conn, "z", 1, Some("p"));
        save_at(&mut conn, "a", 2, Some("q"));
        assert_eq!(latest_entry_project(&conn).unwrap().as_deref(), Some("q"));

        save_at(&mut conn, "m", 3, None);
        assert_eq!(latest_entry_project(&conn).unwrap(), None);
    }

    #[test]
    fn getting_an_unknown_entry_is_a_not_found_error() {
        let conn = migrated();

        let result = get_prompt_entry(&conn, "missing");

        assert!(matches!(
            result,
            Err(DbError::NotFound {
                entity: Entity::PromptEntry,
                ..
            })
        ));
    }
}
