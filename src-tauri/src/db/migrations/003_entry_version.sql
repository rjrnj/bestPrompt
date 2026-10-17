-- How many times each entry has been edited since it was saved. Every update
-- adds one, so of two copies of an entry read at different times the one
-- with the higher version is the newer.
ALTER TABLE prompt_entries ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);
