-- Fix company_links table schema for legacy databases
-- This drops the old table (if any data exists, it will be lost, but this table is new and should be empty)
DROP TABLE IF EXISTS `company_links`;
--> statement-breakpoint
CREATE TABLE `company_links` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`fetched_content` text,
	`fetched_at` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_company_links_symbol` ON `company_links` (`symbol`);
