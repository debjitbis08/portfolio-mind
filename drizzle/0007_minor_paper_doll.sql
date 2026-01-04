ALTER TABLE `company_links` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `company_notes` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `company_research` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `ai_enabled` integer DEFAULT true;--> statement-breakpoint

-- ============================================================================
-- FTS5 Virtual Tables
-- ============================================================================

-- FTS for research documents (searchable: title + content)
CREATE VIRTUAL TABLE IF NOT EXISTS research_fts USING fts5(
  id UNINDEXED,
  symbol UNINDEXED,
  title,
  content,
  tokenize = 'porter unicode61'
);
--> statement-breakpoint

-- FTS for company notes (searchable: content)
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  id UNINDEXED,
  symbol UNINDEXED,
  content,
  tokenize = 'porter unicode61'
);
--> statement-breakpoint

-- FTS for company links (searchable: title + fetched_content)
CREATE VIRTUAL TABLE IF NOT EXISTS links_fts USING fts5(
  id UNINDEXED,
  symbol UNINDEXED,
  title,
  fetched_content,
  tokenize = 'porter unicode61'
);
--> statement-breakpoint

-- ============================================================================
-- FTS Triggers: Keep indexes synchronized with content tables
-- ============================================================================

-- Research: INSERT trigger
CREATE TRIGGER IF NOT EXISTS research_fts_insert AFTER INSERT ON company_research BEGIN
  INSERT INTO research_fts(id, symbol, title, content)
  VALUES (NEW.id, NEW.symbol, NEW.title, NEW.content);
END;
--> statement-breakpoint

-- Research: UPDATE trigger
CREATE TRIGGER IF NOT EXISTS research_fts_update AFTER UPDATE ON company_research BEGIN
  UPDATE research_fts SET title = NEW.title, content = NEW.content
  WHERE id = OLD.id;
END;
--> statement-breakpoint

-- Research: DELETE trigger
CREATE TRIGGER IF NOT EXISTS research_fts_delete AFTER DELETE ON company_research BEGIN
  DELETE FROM research_fts WHERE id = OLD.id;
END;
--> statement-breakpoint

-- Notes: INSERT trigger
CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON company_notes BEGIN
  INSERT INTO notes_fts(id, symbol, content)
  VALUES (NEW.id, NEW.symbol, NEW.content);
END;
--> statement-breakpoint

-- Notes: UPDATE trigger
CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON company_notes BEGIN
  UPDATE notes_fts SET content = NEW.content
  WHERE id = OLD.id;
END;
--> statement-breakpoint

-- Notes: DELETE trigger
CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON company_notes BEGIN
  DELETE FROM notes_fts WHERE id = OLD.id;
END;
--> statement-breakpoint

-- Links: INSERT trigger
CREATE TRIGGER IF NOT EXISTS links_fts_insert AFTER INSERT ON company_links BEGIN
  INSERT INTO links_fts(id, symbol, title, fetched_content)
  VALUES (NEW.id, NEW.symbol, NEW.title, NEW.fetched_content);
END;
--> statement-breakpoint

-- Links: UPDATE trigger
CREATE TRIGGER IF NOT EXISTS links_fts_update AFTER UPDATE ON company_links BEGIN
  UPDATE links_fts SET title = NEW.title, fetched_content = NEW.fetched_content
  WHERE id = OLD.id;
END;
--> statement-breakpoint

-- Links: DELETE trigger
CREATE TRIGGER IF NOT EXISTS links_fts_delete AFTER DELETE ON company_links BEGIN
  DELETE FROM links_fts WHERE id = OLD.id;
END;