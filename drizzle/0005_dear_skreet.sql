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
CREATE INDEX `idx_user_tables_symbol` ON `user_tables` (`symbol`);