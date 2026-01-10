ALTER TABLE `suggestions` ADD `catalyst_id` text REFERENCES potential_catalysts(id);--> statement-breakpoint
ALTER TABLE `suggestions` ADD `stop_loss` real;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `risk_reward_ratio` real;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `trailing_stop` integer;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `entry_trigger` text;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `exit_condition` text;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `volatility_at_entry` real;--> statement-breakpoint
ALTER TABLE `suggestions` ADD `max_hold_days` integer;