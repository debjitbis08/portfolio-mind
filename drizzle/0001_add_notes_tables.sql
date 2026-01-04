-- Add company_notes table
CREATE TABLE IF NOT EXISTS `company_notes` (
  `id` text PRIMARY KEY NOT NULL,
  `symbol` text NOT NULL,
  `content` text NOT NULL,
  `created_at` text
);

CREATE INDEX IF NOT EXISTS `idx_company_notes_symbol` ON `company_notes` (`symbol`);

-- Add action_notes table
CREATE TABLE IF NOT EXISTS `action_notes` (
  `id` text PRIMARY KEY NOT NULL,
  `suggestion_id` text NOT NULL,
  `content` text NOT NULL,
  `created_at` text,
  FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS `idx_action_notes_suggestion` ON `action_notes` (`suggestion_id`);
