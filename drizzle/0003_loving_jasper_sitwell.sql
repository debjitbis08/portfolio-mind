CREATE TABLE `suggestion_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`match_type` text NOT NULL,
	`confidence` integer DEFAULT 100,
	`notes` text,
	`created_at` text,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_suggestion_transactions_suggestion` ON `suggestion_transactions` (`suggestion_id`);--> statement-breakpoint
CREATE INDEX `idx_suggestion_transactions_transaction` ON `suggestion_transactions` (`transaction_id`);