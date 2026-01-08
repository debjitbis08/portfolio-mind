CREATE TABLE `catalyst_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`ticker` text NOT NULL,
	`action` text NOT NULL,
	`news_title` text NOT NULL,
	`news_url` text NOT NULL,
	`news_source` text,
	`news_pub_date` text,
	`impact_type` text NOT NULL,
	`sentiment` text NOT NULL,
	`confidence` integer NOT NULL,
	`reasoning` text NOT NULL,
	`validation_ticker` text,
	`current_price` real,
	`price_change_percent` real,
	`volume_ratio` real,
	`volume_spike` integer,
	`status` text DEFAULT 'active',
	`acted_at` text,
	`notes` text,
	`created_at` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_catalyst_signals_status` ON `catalyst_signals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_catalyst_signals_ticker` ON `catalyst_signals` (`ticker`);--> statement-breakpoint
CREATE INDEX `idx_catalyst_signals_keyword` ON `catalyst_signals` (`keyword`);--> statement-breakpoint
CREATE TABLE `catalyst_watchlist` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword` text NOT NULL,
	`ticker` text,
	`asset_type` text NOT NULL,
	`global_validation_ticker` text,
	`related_tickers` text,
	`enabled` integer DEFAULT true,
	`notes` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_catalyst_watchlist_keyword` ON `catalyst_watchlist` (`keyword`);--> statement-breakpoint
CREATE TABLE `processed_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`article_url` text NOT NULL,
	`article_title` text NOT NULL,
	`keyword` text NOT NULL,
	`is_catalyst` integer DEFAULT false,
	`analysis_json` text,
	`processed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processed_articles_article_url_unique` ON `processed_articles` (`article_url`);--> statement-breakpoint
CREATE INDEX `idx_processed_articles_url` ON `processed_articles` (`article_url`);--> statement-breakpoint
CREATE INDEX `idx_processed_articles_keyword` ON `processed_articles` (`keyword`);