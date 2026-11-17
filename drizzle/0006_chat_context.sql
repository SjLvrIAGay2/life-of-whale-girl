ALTER TABLE `messages` ADD `image_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `qq_index` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `quoted_ref` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `quoted_text` text;--> statement-breakpoint
CREATE INDEX `messages_qq_index` ON `messages` (`peer`,`qq_index`);