ALTER TABLE `vrs_research` ADD `research_content` text;--> statement-breakpoint
ALTER TABLE `vrs_research` ADD `imported_by` text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE `vrs_research` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `vrs_research` DROP COLUMN `document_path`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `vrs_email`;--> statement-breakpoint
ALTER TABLE `settings` DROP COLUMN `vrs_password`;