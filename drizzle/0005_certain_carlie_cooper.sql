CREATE TABLE `vrs_research` (
	`symbol` text PRIMARY KEY NOT NULL,
	`rec_price` real,
	`cur_price` real,
	`stop_loss` real,
	`target_price` real,
	`return_percent` real,
	`status` text,
	`market_cap` text,
	`rationale` text,
	`risks` text,
	`document_path` text,
	`analyst_note` text,
	`fetched_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_vrs_research_status` ON `vrs_research` (`status`);--> statement-breakpoint
ALTER TABLE `settings` ADD `vrs_email` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `vrs_password` text;