ALTER TABLE `intraday_transactions` ADD `brokerage` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `stt` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `stamp_duty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `exchange_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `sebi_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `ipft_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `dp_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `gst` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `intraday_transactions` ADD `total_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `brokerage` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `stt` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `stamp_duty` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `exchange_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `sebi_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `ipft_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `dp_charges` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `gst` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `total_charges` real DEFAULT 0 NOT NULL;