CREATE TABLE `action_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_action_notes_suggestion` ON `action_notes` (`suggestion_id`);--> statement-breakpoint
CREATE TABLE `commodity_holdings` (
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
--> statement-breakpoint
CREATE TABLE `company_financials` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`period_type` text NOT NULL,
	`report_date` text NOT NULL,
	`sales` real,
	`operating_profit` real,
	`net_profit` real,
	`eps` real,
	`opm_percent` real,
	`equity` real,
	`reserves` real,
	`borrowings` real,
	`receivables` real,
	`inventory` real,
	`operating_cash_flow` real,
	`investing_cash_flow` real,
	`financing_cash_flow` real,
	`price` real,
	`source` text DEFAULT 'screener',
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_company_financials_symbol` ON `company_financials` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_company_financials_period` ON `company_financials` (`symbol`,`report_date`);--> statement-breakpoint
CREATE TABLE `company_links` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`fetched_content` text,
	`fetched_at` text,
	`tags` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_company_links_symbol` ON `company_links` (`symbol`);--> statement-breakpoint
CREATE TABLE `company_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`content` text NOT NULL,
	`tags` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_company_notes_symbol` ON `company_notes` (`symbol`);--> statement-breakpoint
CREATE TABLE `company_research` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_company_research_symbol` ON `company_research` (`symbol`);--> statement-breakpoint
CREATE TABLE `concall_highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`quarter` text NOT NULL,
	`call_date` text,
	`source_url` text,
	`management_guidance` text,
	`key_numbers` text,
	`positives` text,
	`risks_discussed` text,
	`analyst_concerns` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_concall_highlights_symbol` ON `concall_highlights` (`symbol`);--> statement-breakpoint
CREATE TABLE `cycle_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text,
	`completed_at` text,
	`symbols_analyzed` integer DEFAULT 0,
	`suggestions_count` integer DEFAULT 0,
	`status` text DEFAULT 'running',
	`error_message` text
);
--> statement-breakpoint
CREATE TABLE `etf_commodity_mappings` (
	`symbol` text PRIMARY KEY NOT NULL,
	`commodity_type` text NOT NULL,
	`conversion_factor` real DEFAULT 1,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `jobs` (
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
CREATE INDEX `idx_jobs_pending` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `price_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`change_percent` real,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `idx_sessions_token` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`available_funds` real DEFAULT 0,
	`risk_profile` text DEFAULT 'balanced',
	`notification_email` text,
	`screener_urls` text,
	`screener_email` text,
	`screener_password` text,
	`symbol_mappings` text,
	`tool_config` text,
	`ai_enabled` integer DEFAULT true,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `stock_intel` (
	`symbol` text PRIMARY KEY NOT NULL,
	`fundamentals` text,
	`news_sentiment` text,
	`social_sentiment` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
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
	`quantity` integer,
	`allocation_amount` real,
	`superseded_by` text,
	`superseded_reason` text,
	`citations` text,
	`created_at` text,
	`expires_at` text,
	`reviewed_at` text,
	FOREIGN KEY (`cycle_id`) REFERENCES `cycle_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_suggestions_pending` ON `suggestions` (`status`);--> statement-breakpoint
CREATE TABLE `technical_data` (
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
CREATE TABLE `tool_cache` (
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
CREATE UNIQUE INDEX `tool_cache_cache_key_unique` ON `tool_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_tool_cache_key` ON `tool_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_tool_cache_expires` ON `tool_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
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
CREATE INDEX `idx_transactions_isin` ON `transactions` (`isin`);--> statement-breakpoint
CREATE INDEX `idx_transactions_executed_at` ON `transactions` (`executed_at`);--> statement-breakpoint
CREATE TABLE `user_table_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`table_id`) REFERENCES `user_tables`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_table_rows_table_id` ON `user_table_rows` (`table_id`);--> statement-breakpoint
CREATE TABLE `user_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`columns` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_user_tables_symbol` ON `user_tables` (`symbol`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`symbol` text PRIMARY KEY NOT NULL,
	`added_at` text,
	`source` text DEFAULT 'manual',
	`notes` text
);
