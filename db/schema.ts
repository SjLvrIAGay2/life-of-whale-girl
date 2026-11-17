import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const resident = sqliteTable("resident", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  revision: integer("revision").notNull(),
  lease: text("lease"),
  leaseUntil: integer("lease_until").notNull().default(0),
  budgetDay: text("budget_day").notNull().default(""),
  calls: integer("calls").notNull().default(0),
});
export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    made: integer("made").notNull(),
    scope: text("scope").notNull(),
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    source: text("source").notNull(),
    evidence: text("evidence").notNull(),
    due: integer("due"),
    resolved: integer("resolved").notNull().default(0),
    topic: text("topic"),
    quote: text("quote"),
    closedBy: text("closed_by"),
    hidden: integer("hidden").notNull().default(0),
    category: text("category"),
    expires: integer("expires"),
    details: text("details"),
  },
  (t) => [index("memory_by_scope").on(t.scope, t.made), index("memory_topic").on(t.scope,t.kind,t.topic,t.made)],
);
export const memoryVectors = sqliteTable("memory_vectors", {
  id: text("id").primaryKey().references(() => memories.id, {onDelete:"cascade"}),
  model: text("model").notNull(),
  vector: blob("vector", {mode:"buffer"}).notNull(),
});
export const posts = sqliteTable("daily_posts", {
  day: text("day").primaryKey(),
  resident: text("resident").notNull(),
  made: integer("made").notNull(),
  body: text("body").notNull(),
  evidence: text("evidence").notNull(),
  sources: text("sources").notNull(),
});
export const drawings = sqliteTable("drawings", {
  id: text("id").primaryKey(),
  made: integer("made").notNull(),
  scope: text("scope").notNull(),
  title: text("title").notNull(),
  svg: text("svg").notNull(),
  png: blob("png", { mode: "buffer" }),
});
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    peer: text("peer").notNull(),
    made: integer("made").notNull(),
    side: text("side").notNull(),
    body: text("body").notNull(),
    art: text("art"),
    replyTo: text("reply_to"),
    voice: integer("voice").notNull().default(0),
    batchId: text("batch_id"),
    seq: integer("seq").notNull().default(1),
    handledAt: integer("handled_at"),
    reviewed: integer("reviewed").notNull().default(0),
    imageCount: integer("image_count").notNull().default(0),
    qqIndex: text("qq_index"),
    quotedRef: text("quoted_ref"),
    quotedText: text("quoted_text"),
    withheld: integer("withheld").notNull().default(0),
    withdrawn: integer("withdrawn").notNull().default(0),
  },
  (t) => [
    index("peer_messages").on(t.peer, t.made),
    uniqueIndex("messages_reply_part").on(t.replyTo, t.seq),
    index("messages_unread").on(t.side, t.handledAt, t.peer, t.made),
    index("messages_batch").on(t.batchId, t.seq),
    index("messages_qq_index").on(t.peer, t.qqIndex),
  ],
);
export const settings = sqliteTable(
  "agent_versions",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    made: integer("made").notNull(),
    value: text("value").notNull(),
    parent: text("parent"),
  },
  (t) => [index("version_by_name").on(t.name, t.made)],
);
export const channels = sqliteTable("channel_state", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});
export const deliveries = sqliteTable("deliveries", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  attempt: integer("attempt").notNull(),
  nextTry: integer("next_try").notNull().default(0),
});

export const memoryRules = sqliteTable("memory_rules", {
  id: text("id").primaryKey(), scope: text("scope").notNull(), topic: text("topic").notNull(),
  mode: text("mode").notNull(), made: integer("made").notNull(), terms: text("terms").notNull(),
}, t => [index("rules_by_scope").on(t.scope,t.topic)]);
export const attachments = sqliteTable("chat_images", {
  id: text("id").primaryKey(), message: text("message").notNull().references(()=>messages.id,{onDelete:"cascade"}),
  part: integer("part").notNull(), quoted: integer("quoted").notNull().default(0),
  mime: text("mime").notNull(), bytes: blob("bytes",{mode:"buffer"}).notNull(),
}, t=>[uniqueIndex("images_by_message").on(t.message,t.quoted,t.part)]);
export const works = sqliteTable("works", {
  id: text("id").primaryKey(), scope: text("scope").notNull(), title: text("title").notNull(),
  kind: text("kind").notNull(), state: text("state").notNull(), made: integer("made").notNull(),
  updated: integer("updated").notNull(), next: text("next").notNull(),
}, t=>[index("works_by_scope").on(t.scope,t.updated)]);
export const workSteps = sqliteTable("work_steps", {
  id: text("id").primaryKey(), work: text("work").notNull().references(()=>works.id,{onDelete:"cascade"}),
  made: integer("made").notNull(), body: text("body").notNull(), evidence: text("evidence"),
  art: text("art"), url: text("url"), level: text("level"),
}, t=>[index("steps_by_work").on(t.work,t.made)]);
export const artJobs = sqliteTable("art_jobs", {
  id: text("id").primaryKey(), scope: text("scope").notNull(), peer: text("peer"), origin: text("origin"),
  work: text("work"), idea: text("idea").notNull(), style: text("style").notNull(), reference: text("reference"),
  state: text("state").notNull(), made: integer("made").notNull(), due: integer("due").notNull(),
  attempts: integer("attempts").notNull().default(0), lease: text("lease"), art: text("art"), detail: text("detail"),
  promiseId: text("promise_id"),
}, t=>[index("art_jobs_due").on(t.state,t.due)]);
export const replyTurns = sqliteTable("reply_turns", {
  id: text("id").primaryKey(), scope: text("scope").notNull(), made: integer("made").notNull(),
  status: text("status").notNull(), details: text("details").notNull(),
}, t=>[index("turns_by_time").on(t.made)]);
export const usage = sqliteTable("model_usage", {
  id: text("id").primaryKey(), made: integer("made").notNull(), task: text("task").notNull(), model: text("model").notNull(),
  status: text("status").notNull(), elapsed: integer("elapsed").notNull(),
  input: integer("input"), output: integer("output"), cost: text("cost"),
}, t=>[index("usage_by_time").on(t.made,t.task)]);

export const playSaves = sqliteTable("play_saves", {
  id: text("id").primaryKey(), kind: text("kind").notNull(), updated: integer("updated").notNull(), position: text("position").notNull(),
});
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), made: integer("made").notNull(), until: integer("until").notNull(),
  visibility: text("visibility").notNull(), detail: text("detail").notNull(),
}, t => [index("activities_by_time").on(t.made)]);
export const siteEditions = sqliteTable("site_editions", {
  id: text("id").primaryKey(), parent: text("parent"), made: integer("made").notNull(), document: text("document").notNull(),
});

export const cabinTypes = sqliteTable("cabin_types", {
  id: text("id").primaryKey(), definition: text("definition").notNull(),
});
export const cabinItems = sqliteTable("cabin_items", {
  id: text("id").primaryKey(), type: text("type").notNull(), body: text("body").notNull(),
  source: text("source"), sourceId: text("source_id"),
});
export const cabinRequests = sqliteTable("cabin_requests", {
  id: text("id").primaryKey(), fingerprint: text("fingerprint").notNull(), outcome: text("outcome").notNull(),
});
export const cabinPreviews = sqliteTable("cabin_previews", {
  id: text("id").primaryKey(), item: text("item").notNull(), action: text("action").notNull(),
  base: text("base"), behavior: text("behavior").notNull(), args: text("args").notNull(),
});
