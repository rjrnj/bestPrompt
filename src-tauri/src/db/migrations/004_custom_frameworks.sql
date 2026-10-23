-- Custom frameworks can be deleted without losing the history that refers to
-- them: a deleted one keeps its row with the time it was deleted. Built-ins are
-- never deleted.
ALTER TABLE frameworks ADD COLUMN deleted_at INTEGER CHECK (deleted_at IS NULL OR is_custom = 1);

-- Names are unique among live frameworks, ignoring case. A deleted framework
-- doesn't hold on to its name.
CREATE UNIQUE INDEX frameworks_live_name ON frameworks (name COLLATE NOCASE) WHERE deleted_at IS NULL;
