CREATE TABLE IF NOT EXISTS `company_research` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_company_research_symbol` ON `company_research` (`symbol`);