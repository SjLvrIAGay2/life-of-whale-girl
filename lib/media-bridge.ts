import { all, one, stmt } from "../db";
import { createHash } from "node:crypto";
import { z } from "zod";
import { isBiliAccountRead, readMedia, type Observation, type ReadRequest } from "./media";

const request = z.object({
  source: z.literal("bili"),
  action: z.enum([
    "browse",
    "search",
    "open",
    "comments",
    "subtitles",
    "frames",
  ]),
  query: z.string().max(70).optional(),
  id: z.string().max(80).optional(),
  root: z
    .string()
    .regex(/^\d{1,20}$/)
    .optional(),
  page: z.number().int().min(1).max(10000).optional(),
  offset:z.number().int().min(0).max(50000).optional(),
});
const videoURL = z
  .string()
  .regex(/^https:\/\/www\.bilibili\.com\/(?:video\/BV[\da-zA-Z]{10}|bangumi\/play\/ep[1-9]\d{0,15})$/);
const result = z.object({
  status: z.string().regex(/^[a-z0-9_-]{1,45}$/),
  resolved:z.object({id:z.string().regex(/^(?:BV[\da-zA-Z]{10}|ep[1-9]\d{0,15})$/),page:z.number().int().min(1).max(10000).optional()}).optional(),
  filteredCount:z.number().int().nonnegative().optional(),
  nextPage:z.number().int().positive().optional(),
  nextOffset: z.number().int().nonnegative().optional(),
  atEnd: z.boolean().optional(),
  level: z.enum([
    "title",
    "metadata",
    "subtitles",
    "filtered_comments",
    "storyboard_available",
    "unavailable",
  ]),
  items: z
    .array(
      z.object({
        id: z.string().regex(/^(?:BV[\da-zA-Z]{10}|ep[1-9]\d{0,15})$/),
        title: z.string().max(160),
        url: videoURL,
        body: z.string().max(4000),
      }),
    )
    .max(8),
  comments: z
    .array(
      z.object({
        id: z.string().regex(/^\d{1,25}$/),
        parent: z.string().regex(/^\d{1,25}$/),
        text: z.string().max(350),
      }),
    )
    .max(50)
    .optional(),
  frames: z
    .array(
      z
        .string()
        .url()
        .refine((s) => {
          const u = new URL(s);
          return (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            /(^|\.)hdslb\.com$/.test(u.hostname)
          );
        }),
    )
    .max(2)
    .optional(),
});
type Job = {
  created: number;
  request: ReadRequest;
  observation?: Observation;
  done?: number;
};
const prefix = "desk-read/";
export async function readWithDesk(
  query: ReadRequest,
  network: Parameters<typeof readMedia>[1] = {},
) {
  const direct = await readMedia(query, network);
  if (
    query.source !== "bili" ||
    isBiliAccountRead(query) ||
    !["network_error", "rate_limited", "upstream_403", "upstream_503"].includes(
      direct.status,
    )
  )
    return direct;
  const input = request.parse(query),
    id =
      prefix +
      createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex")
        .slice(0, 32),
    now = Date.now();
  let row = await one<{ value: string }>(
    "SELECT value FROM channel_state WHERE id=?",
    id,
  );
  let old: Job | undefined = row ? JSON.parse(row.value) : undefined;
  if (old?.observation && now - (old.done ?? 0) < 15 * 60000)
    return old.observation;
  const data: Job = { created: now, request: input };
  await stmt(
    "INSERT INTO channel_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE json_extract(channel_state.value,'$.created')<?",
    id,
    JSON.stringify(data),
    now - 120000,
  ).run();
  const bridge = await one<{ value: string }>(
    "SELECT value FROM channel_state WHERE id='desk-health'",
  );
  if (!bridge || now - Number(bridge.value) > 30000) return direct;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 750));
    row = await one<{ value: string }>(
      "SELECT value FROM channel_state WHERE id=?",
      id,
    );
    if (row) {
      const j: Job = JSON.parse(row.value);
      if (j.observation) return j.observation;
    }
  }
  return direct;
}
export async function nextReads() {
  const now = Date.now();
  await stmt(
    "INSERT OR REPLACE INTO channel_state VALUES('desk-health',?)",
    String(now),
  ).run();
  const jobs = await all<{ id: string; value: string }>(
    "SELECT id,value FROM channel_state WHERE id LIKE 'desk-read/%' AND json_extract(value,'$.done') IS NULL AND json_extract(value,'$.created')>? ORDER BY json_extract(value,'$.created') LIMIT 3",
    now - 120000,
  );
  if (!jobs.length && Math.random() < 0.02)
    await stmt(
      "DELETE FROM channel_state WHERE id LIKE 'desk-read/%' AND json_extract(value,'$.created')<?",
      now - 3600000,
    ).run();
  return jobs.map((j) => ({
    id: j.id,
    created: JSON.parse(j.value).created,
    request: JSON.parse(j.value).request,
  }));
}
export async function finishRead(id: unknown, created: unknown, raw: unknown) {
  if (
    typeof id !== "string" ||
    !/^desk-read\/[0-9a-f]{32}$/.test(id) ||
    typeof created !== "number"
  )
    throw Error("读取编号无效");
  const row = await one<{ value: string }>(
    "SELECT value FROM channel_state WHERE id=?",
    id,
  );
  if (!row) return;
  const job: Job = JSON.parse(row.value);
  if (job.created !== created || job.done) return;
  const safe = result.parse(raw);
  if (job.request.action !== "comments") delete safe.comments;
  if (job.request.action !== "frames") delete safe.frames;
  await stmt(
    "UPDATE channel_state SET value=? WHERE id=? AND value=?",
    JSON.stringify({ ...job, observation: safe, done: Date.now() }),
    id,
    row.value,
  ).run();
}
