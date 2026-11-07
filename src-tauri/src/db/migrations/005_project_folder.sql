ALTER TABLE projects ADD COLUMN folder TEXT CHECK (folder IS NULL OR folder <> '');
