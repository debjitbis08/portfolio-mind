CREATE TABLE IF NOT EXISTS `company_links` (
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