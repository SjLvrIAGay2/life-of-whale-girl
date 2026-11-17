CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`made` integer NOT NULL,
	`until` integer NOT NULL,
	`visibility` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_by_time` ON `activities` (`made`);--> statement-breakpoint
CREATE TABLE `play_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`updated` integer NOT NULL,
	`position` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`parent` text,
	`made` integer NOT NULL,
	`document` text NOT NULL
);
--> statement-breakpoint
-- Earlier public readers wrote the source/level/ID, title, and observed passage on successive lines.
WITH old AS (
  SELECT id,made,source,category,
    CASE WHEN json_valid(details) THEN details ELSE '{}' END AS progress,
    substr(body,1,instr(body,char(10))-1) AS header,substr(body,instr(body,char(10))+1) AS rest
  FROM memories WHERE scope='public' AND kind='observation' AND hidden=0
    AND source LIKE 'https://%' AND instr(body,char(10))>0
), parts AS (
  SELECT *,substr(header,1,instr(header,' / ')-1) AS provider,
    substr(header,instr(header,' · ')+3) AS entry_id,
    coalesce(category,substr(header,instr(header,' / ')+3,instr(header,' · ')-instr(header,' / ')-3)) AS level,
    CASE WHEN instr(rest,char(10))=0 THEN rest ELSE substr(rest,1,instr(rest,char(10))-1) END AS title,
    CASE WHEN instr(rest,char(10))=0 THEN '' ELSE substr(rest,instr(rest,char(10))+1) END AS passage
  FROM old WHERE instr(header,' / ')>0 AND instr(header,' · ')>0
)
INSERT OR IGNORE INTO activities(id,made,until,visibility,detail)
SELECT id,made,made,'detail',json_object('detail',json_patch(
  json_object('kind','reading','source',provider,'action','archive','level',level,
    'items',json_array(json_object('id',entry_id,'title',title,'url',source,'body',passage))),
  json_object('page',json_extract(progress,'$.page'),'offset',json_extract(progress,'$.offset'))
)) FROM parts WHERE provider IN ('bili','heybox','news') AND title<>'';
