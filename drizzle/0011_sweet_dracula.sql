CREATE TABLE `intraday_suggestion_links` (
	`id` text PRIMARY KEY NOT NULL,
	`intraday_transaction_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`created_at` text,
	FOREIGN KEY (`intraday_transaction_id`) REFERENCES `intraday_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_intraday_suggestion_links_suggestion` ON `intraday_suggestion_links` (`suggestion_id`);--> statement-breakpoint
CREATE INDEX `idx_intraday_suggestion_links_tx` ON `intraday_suggestion_links` (`intraday_transaction_id`);--> statement-breakpoint
CREATE TABLE `intraday_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`stock_name` text,
	`type` text NOT NULL,
	`quantity` integer NOT NULL,
	`price_per_share` real NOT NULL,
	`executed_at` text,
	`created_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_intraday_transactions_symbol` ON `intraday_transactions` (`symbol`);