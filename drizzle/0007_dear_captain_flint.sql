PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_vrs_research` (
	`symbol` text PRIMARY KEY NOT NULL,
	`rec_price` real,
	`rec_date` text,
	`exit_price` real,
	`exit_date` text,
	`status` text DEFAULT 'Buy',
	`rationale` text,
	`risks` text,
	`analyst_note` text,
	`research_content` text,
	`fetched_at` text,
	`updated_at` text
);
--> statement-breakpoint
INSERT INTO `__new_vrs_research`("symbol", "rec_price", "status", "rationale", "risks", "analyst_note", "research_content", "fetched_at", "updated_at") SELECT "symbol", "rec_price", "status", "rationale", "risks", "analyst_note", "research_content", "fetched_at", "updated_at" FROM `vrs_research`;--> statement-breakpoint
DROP TABLE `vrs_research`;--> statement-breakpoint
ALTER TABLE `__new_vrs_research` RENAME TO `vrs_research`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_vrs_research_status` ON `vrs_research` (`status`);