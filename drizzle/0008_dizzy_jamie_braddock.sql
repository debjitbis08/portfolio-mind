CREATE TABLE `stock_analysis_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`opportunity_score` integer,
	`thesis_summary` text,
	`risks_summary` text,
	`timing_signal` text,
	`news_alert` integer DEFAULT false,
	`news_alert_reason` text,
	`analysis_json` text,
	`vrs_data_at` text,
	`financials_at` text,
	`valuepickr_at` text,
	`news_at` text,
	`analyzed_at` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_cache_score` ON `stock_analysis_cache` (`opportunity_score`);--> statement-breakpoint
CREATE INDEX `idx_analysis_cache_alert` ON `stock_analysis_cache` (`news_alert`);