CREATE TABLE `cabin_items` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`source` text,
	`source_id` text
);
--> statement-breakpoint
CREATE TABLE `cabin_previews` (
	`id` text PRIMARY KEY NOT NULL,
	`item` text NOT NULL,
	`action` text NOT NULL,
	`base` text,
	`behavior` text NOT NULL,
	`args` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cabin_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`outcome` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cabin_types` (
	`id` text PRIMARY KEY NOT NULL,
	`definition` text NOT NULL
);

--> statement-breakpoint
INSERT INTO cabin_items(id,type,body,source,source_id)
SELECT 'work/'||id,'work','{}','work',id FROM works;
--> statement-breakpoint
CREATE TRIGGER cabin_add_work AFTER INSERT ON works BEGIN
  INSERT OR IGNORE INTO cabin_items(id,type,body,source,source_id)
  VALUES('work/'||NEW.id,'work',
    coalesce((SELECT json_object('initial',json(definition)) FROM cabin_types WHERE id='work'),'{}'),'work',NEW.id);
END;

--> statement-breakpoint
INSERT INTO cabin_items(id,type,body,source,source_id)
SELECT 'picture/'||id,'picture','{}','picture',id FROM drawings;
--> statement-breakpoint
CREATE TRIGGER cabin_add_picture AFTER INSERT ON drawings BEGIN
  INSERT OR IGNORE INTO cabin_items(id,type,body,source,source_id)
  VALUES('picture/'||NEW.id,'picture',
    coalesce((SELECT json_object('initial',json(definition)) FROM cabin_types WHERE id='picture'),'{}'),'picture',NEW.id);
END;

--> statement-breakpoint
INSERT INTO cabin_items(id,type,body,source,source_id)
SELECT 'game/'||id,CASE kind WHEN 'gomoku' THEN 'board' ELSE 'puzzle' END,'{}','game',id FROM play_saves;
--> statement-breakpoint
CREATE TRIGGER cabin_add_game AFTER INSERT ON play_saves BEGIN
  INSERT OR IGNORE INTO cabin_items(id,type,body,source,source_id)
  VALUES('game/'||NEW.id,CASE NEW.kind WHEN 'gomoku' THEN 'board' ELSE 'puzzle' END,
    coalesce((SELECT json_object('initial',json(definition)) FROM cabin_types WHERE id=CASE NEW.kind WHEN 'gomoku' THEN 'board' ELSE 'puzzle' END),'{}'),'game',NEW.id);
END;
