-- Add citations column to suggestions table
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
-- This query will fail silently if column already exists (handled by runtime)
ALTER TABLE `suggestions` ADD `citations` text;