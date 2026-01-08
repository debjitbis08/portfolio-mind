CREATE TABLE `catalyst_verification_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_id` text,
	`opportunity_log_id` text NOT NULL,
	`keyword` text NOT NULL,
	`headline` text NOT NULL,
	`predicted_sentiment` text NOT NULL,
	`predicted_impact_type` text NOT NULL,
	`confidence` integer NOT NULL,
	`ticker` text NOT NULL,
	`base_price` real,
	`base_price_change_percent` real,
	`base_volume_ratio` real,
	`check_1hr_at` text,
	`check_1hr_price` real,
	`check_1hr_change_percent` real,
	`check_1hr_verdict` text,
	`check_next_session_at` text,
	`check_next_session_price` real,
	`check_next_session_change_percent` real,
	`check_next_session_verdict` text,
	`check_24hr_at` text,
	`check_24hr_price` real,
	`check_24hr_change_percent` real,
	`check_24hr_verdict` text,
	`final_verdict` text DEFAULT 'PENDING',
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`signal_id`) REFERENCES `catalyst_signals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalyst_verification_metrics_opportunity_log_id_unique` ON `catalyst_verification_metrics` (`opportunity_log_id`);--> statement-breakpoint
CREATE INDEX `idx_verification_metrics_verdict` ON `catalyst_verification_metrics` (`final_verdict`);--> statement-breakpoint
CREATE INDEX `idx_verification_metrics_keyword` ON `catalyst_verification_metrics` (`keyword`);--> statement-breakpoint
CREATE INDEX `idx_verification_metrics_created` ON `catalyst_verification_metrics` (`created_at`);