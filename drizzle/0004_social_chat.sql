DROP INDEX `messages_reply_to_unique`;--> statement-breakpoint
ALTER TABLE `messages` ADD `batch_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `seq` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `handled_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_reply_part` ON `messages` (`reply_to`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_unread` ON `messages` (`side`,`handled_at`,`peer`,`made`);--> statement-breakpoint
CREATE INDEX `messages_batch` ON `messages` (`batch_id`,`seq`);--> statement-breakpoint
ALTER TABLE `deliveries` ADD `next_try` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE messages SET handled_at=made WHERE side='in' AND (EXISTS
  (SELECT 1 FROM memories WHERE id='chat-in-'||messages.id) OR EXISTS
  (SELECT 1 FROM messages reply WHERE reply.reply_to=messages.id));
