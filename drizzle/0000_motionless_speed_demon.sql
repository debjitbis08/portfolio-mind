CREATE TABLE IF NOT EXISTS `cycle_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text,
	`completed_at` text,
	`symbols_analyzed` integer DEFAULT 0,
	`suggestions_count` integer DEFAULT 0,
	`status` text DEFAULT 'running',
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending',
	`progress` integer DEFAULT 0,
	`progress_message` text,
	`result` text,
	`error_message` text,
	`created_at` text,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_jobs_pending` ON `jobs` (`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `price_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`change_percent` real,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `sessions_token_unique` ON `sessions` (`token`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sessions_token` ON `sessions` (`token`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`available_funds` real DEFAULT 0,
	`risk_profile` text DEFAULT 'balanced',
	`notification_email` text,
	`screener_urls` text,
	`symbol_mappings` text,
	`tool_config` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stock_intel` (
	`symbol` text PRIMARY KEY NOT NULL,
	`fundamentals` text,
	`news_sentiment` text,
	`social_sentiment` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text,
	`symbol` text NOT NULL,
	`stock_name` text,
	`action` text NOT NULL,
	`rationale` text NOT NULL,
	`technical_score` real,
	`current_price` real,
	`target_price` real,
	`status` text DEFAULT 'pending',
	`confidence` integer,
	`superseded_by` text,
	`superseded_reason` text,
	`created_at` text,
	`expires_at` text,
	`reviewed_at` text,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_suggestions_pending` ON `suggestions` (`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `technical_data` (
	`symbol` text PRIMARY KEY NOT NULL,
	`current_price` real,
	`rsi_14` real,
	`sma_50` real,
	`sma_200` real,
	`price_vs_sma50` real,
	`price_vs_sma200` real,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tool_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`source` text NOT NULL,
	`query_args` text NOT NULL,
	`response` text NOT NULL,
	`created_at` text,
	`expires_at` text NOT NULL,
	`hit_count` integer DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tool_cache_cache_key_unique` ON `tool_cache` (`cache_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_cache_key` ON `tool_cache` (`cache_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tool_cache_expires` ON `tool_cache` (`expires_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text NOT NULL,
	`symbol` text NOT NULL,
	`stock_name` text NOT NULL,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`value` real NOT NULL,
	`exchange` text,
	`exchange_order_id` text,
	`executed_at` text NOT NULL,
	`status` text DEFAULT 'Executed',
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_isin` ON `transactions` (`isin`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transactions_executed_at` ON `transactions` (`executed_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `watchlist` (
	`symbol` text PRIMARY KEY NOT NULL,
	`added_at` text,
	`source` text DEFAULT 'manual',
	`notes` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `etf_commodity_mappings` (
	`symbol` text PRIMARY KEY NOT NULL,
	`commodity_type` text NOT NULL,
	`conversion_factor` real DEFAULT 1,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commodity_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`commodity_type` text NOT NULL,
	`name` text NOT NULL,
	`holding_type` text DEFAULT 'PHYSICAL',
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'GRAM',
	`purchase_price` real NOT NULL,
	`purchase_date` text NOT NULL,
	`notes` text,
	`created_at` text,
	`updated_at` text
);
