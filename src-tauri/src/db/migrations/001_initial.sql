-- Frameworks with their sections, and the prompt history.
--
-- STRICT makes SQLite enforce each column's declared type. IDs are TEXT: a
-- UUIDv7, or a fixed slug for built-in frameworks. Timestamps are UTC Unix
-- milliseconds.

CREATE TABLE frameworks (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL CHECK (name <> ''),
    description TEXT NOT NULL,
    template    TEXT NOT NULL,
    is_custom   INTEGER NOT NULL CHECK (is_custom IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    -- Custom frameworks have UUID ids and only they do, so a custom framework
    -- can never take a built-in's id. Seeding the built-ins relies on this.
    CHECK ((is_custom = 1) = (id GLOB (
        '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
        || '[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
        || '[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
        || '[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-'
        || '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
    )))
) STRICT;

-- Templates refer to a section by its key, so a label can be reworded without
-- touching the template. An empty key could never be matched by a template
-- tag, so it is rejected here rather than silently dropped from every prompt.
CREATE TABLE framework_sections (
    framework_id TEXT NOT NULL REFERENCES frameworks (id) ON DELETE CASCADE,
    position     INTEGER NOT NULL CHECK (position >= 0),
    key          TEXT NOT NULL CHECK (key <> ''),
    label        TEXT NOT NULL,
    help_text    TEXT NOT NULL,
    PRIMARY KEY (framework_id, key),
    UNIQUE (framework_id, position)
) STRICT;

-- Each entry keeps a JSON snapshot of its framework (name, sections, template)
-- as it was when the entry was saved, so history still opens after the
-- framework is edited or deleted. framework_id is only for grouping and
-- filtering, and becomes NULL when the framework is deleted.
CREATE TABLE prompt_entries (
    id                 TEXT NOT NULL PRIMARY KEY,
    framework_id       TEXT REFERENCES frameworks (id) ON DELETE SET NULL,
    framework_snapshot TEXT NOT NULL CHECK (json_valid(framework_snapshot)),
    section_values     TEXT NOT NULL CHECK (json_valid(section_values)),
    rendered_prompt    TEXT NOT NULL,
    created_at         INTEGER NOT NULL
) STRICT;

-- History is listed newest first.
CREATE INDEX prompt_entries_created_at ON prompt_entries (created_at DESC);

-- One framework's history, newest first. It also saves deleting a framework
-- from scanning every entry to apply ON DELETE SET NULL.
CREATE INDEX prompt_entries_framework_id_created_at
    ON prompt_entries (framework_id, created_at DESC);
