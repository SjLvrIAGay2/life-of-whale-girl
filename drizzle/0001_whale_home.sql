CREATE TABLE `channel_state` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`attempt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drawings` (
	`id` text PRIMARY KEY NOT NULL,
	`made` integer NOT NULL,
	`scope` text NOT NULL,
	`title` text NOT NULL,
	`svg` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`made` integer NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`source` text NOT NULL,
	`evidence` text NOT NULL,
	`due` integer,
	`resolved` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `memory_by_scope` ON `memories` (`scope`,`made`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`peer` text NOT NULL,
	`made` integer NOT NULL,
	`side` text NOT NULL,
	`body` text NOT NULL,
	`art` text,
	`reply_to` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_reply_to_unique` ON `messages` (`reply_to`);--> statement-breakpoint
CREATE INDEX `peer_messages` ON `messages` (`peer`,`made`);--> statement-breakpoint
CREATE TABLE `daily_posts` (
	`day` text PRIMARY KEY NOT NULL,
	`resident` text NOT NULL,
	`made` integer NOT NULL,
	`body` text NOT NULL,
	`evidence` text NOT NULL,
	`sources` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resident` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`budget_day` text DEFAULT '' NOT NULL,
	`calls` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`made` integer NOT NULL,
	`value` text NOT NULL,
	`parent` text
);
--> statement-breakpoint
CREATE INDEX `version_by_name` ON `agent_versions` (`name`,`made`);--> statement-breakpoint
DROP TABLE `site_sections`;