ALTER TABLE `catalyst_signals` ADD `news_source_id` text;--> statement-breakpoint
ALTER TABLE `catalyst_signals` ADD `news_source_priority` integer;--> statement-breakpoint
ALTER TABLE `processed_articles` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `processed_articles` ADD `source_priority` integer;--> statement-breakpoint
CREATE INDEX `idx_processed_articles_source_id` ON `processed_articles` (`source_id`);