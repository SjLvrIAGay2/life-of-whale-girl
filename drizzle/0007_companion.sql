CREATE TABLE `art_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`peer` text,
	`origin` text,
	`work` text,
	`idea` text NOT NULL,
	`style` text NOT NULL,
	`reference` text,
	`state` text NOT NULL,
	`made` integer NOT NULL,
	`due` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`art` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `art_jobs_due` ON `art_jobs` (`state`,`due`);--> statement-breakpoint
CREATE TABLE `chat_images` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`part` integer NOT NULL,
	`quoted` integer DEFAULT 0 NOT NULL,
	`mime` text NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`message`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `images_by_message` ON `chat_images` (`message`,`quoted`,`part`);--> statement-breakpoint
CREATE TABLE `memory_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`topic` text NOT NULL,
	`mode` text NOT NULL,
	`made` integer NOT NULL,
	`terms` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_by_scope` ON `memory_rules` (`scope`,`topic`);--> statement-breakpoint
CREATE TABLE `reply_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`made` integer NOT NULL,
	`status` text NOT NULL,
	`details` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turns_by_time` ON `reply_turns` (`made`);--> statement-breakpoint
CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`made` integer NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`elapsed` integer NOT NULL,
	`input` integer,
	`output` integer,
	`cost` text
);
--> statement-breakpoint
CREATE INDEX `usage_by_time` ON `model_usage` (`made`,`task`);--> statement-breakpoint
CREATE TABLE `work_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`work` text NOT NULL,
	`made` integer NOT NULL,
	`body` text NOT NULL,
	`evidence` text,
	`art` text,
	`url` text,
	`level` text,
	FOREIGN KEY (`work`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `steps_by_work` ON `work_steps` (`work`,`made`);--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`made` integer NOT NULL,
	`updated` integer NOT NULL,
	`next` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `works_by_scope` ON `works` (`scope`,`updated`);--> statement-breakpoint
ALTER TABLE `memories` ADD `hidden` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `category` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `expires` integer;--> statement-breakpoint
ALTER TABLE `memories` ADD `details` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `withheld` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `withdrawn` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER memory_visibility AFTER INSERT ON memories WHEN NEW.scope LIKE 'chat:%'
AND (EXISTS (SELECT 1 FROM memory_rules r WHERE r.scope=NEW.scope AND (r.mode='avoid' OR (NEW.made<=r.made AND COALESCE(NEW.category,'')<>'corrected'))
 AND (r.topic=NEW.topic OR EXISTS(SELECT 1 FROM json_each(r.terms) t WHERE instr(NEW.body,t.value)>0)))
 OR EXISTS (SELECT 1 FROM json_each(NEW.evidence) e LEFT JOIN memories m ON m.id=e.value
 LEFT JOIN messages l ON e.value='chat-'||l.side||'-'||l.id WHERE m.hidden=1 OR l.withheld=1))
BEGIN UPDATE memories SET hidden=1 WHERE id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER message_visibility AFTER INSERT ON messages WHEN EXISTS (
 SELECT 1 FROM memory_rules r,json_each(r.terms) t WHERE r.mode='avoid'
 AND r.scope='chat:'||COALESCE((SELECT value FROM channel_state WHERE id='friend/'||NEW.peer AND value LIKE 'web-%'),NEW.peer)
 AND (instr(NEW.body,t.value)>0 OR instr(NEW.quoted_text,t.value)>0))
BEGIN UPDATE messages SET withheld=1,reviewed=1,handled_at=COALESCE(handled_at,NEW.made) WHERE id=NEW.id; END;
