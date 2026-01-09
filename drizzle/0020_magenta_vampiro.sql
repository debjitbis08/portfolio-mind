ALTER TABLE `intraday_transactions` ADD `portfolio_type` text DEFAULT 'LONGTERM' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_intraday_transactions_portfolio` ON `intraday_transactions` (`portfolio_type`);--> statement-breakpoint
ALTER TABLE `settings` ADD `catalyst_funds` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `portfolio_type` text DEFAULT 'LONGTERM' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_suggestions_portfolio` ON `suggestions` (`portfolio_type`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `portfolio_type` text DEFAULT 'LONGTERM' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_transactions_portfolio` ON `transactions` (`portfolio_type`);