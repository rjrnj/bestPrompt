-- How many title or project edits each entry has had since it was saved.
-- Each adds one, so of two copies of an entry read at different times the
-- one with the higher version is the newer. Clearing the project when it is
-- deleted doesn't count.
ALTER TABLE prompt_entries ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);
