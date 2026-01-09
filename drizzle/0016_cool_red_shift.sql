CREATE TABLE `bse_nse_mapping` (
	`bse_scrip_code` text PRIMARY KEY NOT NULL,
	`nse_symbol` text NOT NULL,
	`company_name` text NOT NULL,
	`isin` text,
	`last_verified_at` text,
	`source` text DEFAULT 'manual'
);
--> statement-breakpoint
CREATE INDEX `idx_bse_nse_mapping_nse` ON `bse_nse_mapping` (`nse_symbol`);--> statement-breakpoint
CREATE INDEX `idx_bse_nse_mapping_isin` ON `bse_nse_mapping` (`isin`);