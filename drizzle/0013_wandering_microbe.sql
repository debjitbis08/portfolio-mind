CREATE TABLE `potential_catalysts` (
	`id` text PRIMARY KEY NOT NULL,
	`predicted_impact` text NOT NULL,
	`affected_symbols` text NOT NULL,
	`watch_criteria` text NOT NULL,
	`related_article_ids` text,
	`status` text DEFAULT 'monitoring',
	`validation_log` text,
	`created_at` text,
	`updated_at` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_potential_catalysts_status` ON `potential_catalysts` (`status`);--> statement-breakpoint
ALTER TABLE `catalyst_signals` ADD `validation_details` text;--> statement-breakpoint
ALTER TABLE `catalyst_signals` ADD `outcome_result` text;