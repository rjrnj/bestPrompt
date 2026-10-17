-- Projects, entry titles and full-text search over history.

-- A project groups prompt entries. Names are stored trimmed and are unique
-- ignoring ASCII case, so "api" and "API" cannot both exist.
CREATE TABLE projects (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (name = trim(name) AND name <> ''),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

-- An entry may have a title and belong to one project. A blank title is
-- stored as NULL, never as an empty string. Deleting a project keeps its
-- entries and unlinks them.
ALTER TABLE prompt_entries ADD COLUMN title TEXT CHECK (title IS NULL OR trim(title) <> '');
ALTER TABLE prompt_entries ADD COLUMN project_id TEXT REFERENCES projects (id) ON DELETE SET NULL;

-- One project's history, newest first. It also saves deleting a project from
-- scanning every entry to apply ON DELETE SET NULL.
CREATE INDEX prompt_entries_project_id_created_at
    ON prompt_entries (project_id, created_at DESC);

-- The section that best summarises a framework's prompt, used to label
-- entries that have no title. NULL when the framework has none.
ALTER TABLE frameworks ADD COLUMN summary_key TEXT;

-- Full-text index of each entry's title and section values. entry_id is
-- stored but not searchable. The triggers below keep it in step with
-- prompt_entries, so no code path can forget to update it. Only the title
-- changes after an entry is saved, so only title updates are handled.
CREATE VIRTUAL TABLE prompt_entries_fts USING fts5(
    entry_id UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER prompt_entries_fts_insert AFTER INSERT ON prompt_entries
BEGIN
    INSERT INTO prompt_entries_fts (entry_id, title, body)
    VALUES (
        new.id,
        new.title,
        (SELECT group_concat(value, char(10)) FROM json_each(new.section_values))
    );
END;

CREATE TRIGGER prompt_entries_fts_title_update AFTER UPDATE OF title ON prompt_entries
BEGIN
    DELETE FROM prompt_entries_fts WHERE entry_id = old.id;
    INSERT INTO prompt_entries_fts (entry_id, title, body)
    VALUES (
        new.id,
        new.title,
        (SELECT group_concat(value, char(10)) FROM json_each(new.section_values))
    );
END;

CREATE TRIGGER prompt_entries_fts_delete AFTER DELETE ON prompt_entries
BEGIN
    DELETE FROM prompt_entries_fts WHERE entry_id = old.id;
END;

-- Index the entries saved before this migration.
INSERT INTO prompt_entries_fts (entry_id, title, body)
SELECT id, title, (SELECT group_concat(value, char(10)) FROM json_each(section_values))
FROM prompt_entries;
