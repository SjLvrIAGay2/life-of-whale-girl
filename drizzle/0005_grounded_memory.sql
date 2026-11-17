CREATE TABLE `memory_vectors` (
	`id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`vector` blob NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `memories` ADD `topic` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `quote` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `closed_by` text;--> statement-breakpoint
CREATE INDEX `memory_topic` ON `memories` (`scope`,`kind`,`topic`,`made`);--> statement-breakpoint
ALTER TABLE `messages` ADD `reviewed` integer DEFAULT 0 NOT NULL;