import { all, one, stmt, type Memory } from "../db";
import type { State } from "../content/initial";
import { experienceLabel, videoPart, type Experience, type PublicActivity, type Reading, type Visibility } from "../content/activity";
import { gameCatalog, legalMoves, playGame, type Game, type GameCommand } from "./games";
import { isBiliAccountRead, type Observation, type ReadRequest } from "./media";
type Row = { id: string; made: number; until: number; visibility: Visibility; detail: string };
type Turn = { state: State; now: number; writes: D1PreparedStatement[] };
export function endActivity(t: Turn) {
  if (t.state.currentActivity)
    t.writes.push(
      stmt("UPDATE activities SET until=MIN(until,?) WHERE id=?", t.now, t.state.currentActivity),
    );
  t.state.currentActivity = undefined;
}
export function record(
  t: Turn,
  detail: Experience,
  visibility?: Visibility,
  id: string = crypto.randomUUID(),
  readingTarget?: string,
) {
  endActivity(t);
  t.state.currentActivity = id;
  t.state.activity = experienceLabel(detail);
  t.writes.push(
    stmt(
      "INSERT INTO activities(id,made,until,visibility,detail) VALUES(?,?,?,?,?)",
      id,
      t.now,
      detail.kind==="reading" && detail.status && detail.status!=="ok" ? t.now : t.state.nextAt,
      visibility ?? t.state.sharing ?? "detail",
      JSON.stringify({ detail, readingTarget }),
    ),
  );
  return id;
}
function partLink(url: string, part?: number) {
  if (!part || part < 2) return url;
  try {
    const link = new URL(url);
    link.searchParams.set("p", String(part));
    return link.href;
  } catch { return url; }
}
export function readExperience(q: ReadRequest, result: Observation): Reading | undefined {
  if (isBiliAccountRead(q) || (!result.items.length && result.status==="ok")) return;
  const level = result.level;
  return {
    kind: "reading",
    source: q.source,
    action: q.action,
    level,
    status: result.status,
    ...(result.nextOffset !== undefined ? {nextOffset:result.nextOffset,atEnd:result.atEnd} : {}),
    items: result.items
      .slice(0, 8)
      .map(({ id, title, url, body, image }) => ({
        id,
        title,
        url: partLink(url, videoPart({ ...q, level })),
        body: result.status!=="ok" || [
          "title",
          "feed",
          "search_titles",
          "storyboard_available",
          "discussion",
          "filtered_comments",
        ].includes(level)
          ? ""
          : body.slice(0, 3400),
        ...(image ? { image } : {}),
      })),
    ...(q.page || ["subtitles", "frames", "comments"].includes(q.action) ? { page: q.page ?? 1 } : {}),
    ...(["subtitles", "frames"].includes(q.action) ? { offset: q.offset ?? 0 } : {}),
    ...(q.root ? { root: q.root } : {}),
    ...(result.comments?.length ? { comments: result.comments.slice(0, 24) } : {}),
  };
}
export async function play(t: Turn, command: GameCommand, eventId: string) {
  const saved =
    command.op === "start"
      ? null
      : await one<{ id: string; position: string }>(
          "SELECT id,position FROM play_saves WHERE kind=? AND (? IS NULL OR id=?) ORDER BY updated DESC,rowid DESC LIMIT 1",
          command.game,
          command.id ?? null,
          command.id ?? null,
        );
  const prior: Game | undefined = saved ? JSON.parse(saved.position) : undefined;
  const game = playGame(prior, command);
  const placed = command.op === "move" ? game.moves[prior?.moves.length ?? 0] : undefined;
  if (placed?.note) placed.origin = eventId;
  const id = saved?.id ?? crypto.randomUUID();
  t.writes.push(
    stmt(
      "INSERT INTO play_saves(id,kind,updated,position) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,position=excluded.position",
      id,
      game.kind,
      t.now,
      JSON.stringify(game),
    ),
  );
  return {
    kind: "game",
    game,
    save: id,
    op: command.op,
    ...(command.op === "move" ? { input: command.move, moved: game.steps !== prior?.steps } : {}),
  } as const;
}
function accountContext(value: unknown) {
  const saved=value as Partial<Observation> | null;
  if (!saved || !["history","watch_later"].includes(saved.level??"") || !Array.isArray(saved.items)) return value;
  return {...saved,progressSource:"B站账号历史记录",items:saved.items.map(({playback,...item})=>({...item,accountPlayback:playback}))};
}
export async function leisureContext(state: State) {
  const saves = await all<{ id: string; kind: Game["kind"]; updated: number; position: string }>(
    "SELECT * FROM play_saves ORDER BY updated DESC,rowid DESC LIMIT 12",
  );
  const recent = await all<{ id: string; made: number; visibility: Visibility; kind: string }>(
    "SELECT id,made,visibility,json_extract(detail,'$.detail.kind') AS kind FROM activities ORDER BY made DESC,rowid DESC LIMIT 10",
  );
  const bookmarks = await all<{value:string}>("SELECT value FROM channel_state WHERE id GLOB 'reading-progress/*' ORDER BY rowid DESC LIMIT 6");
  return {
    latest: state.lastAction ? accountContext(state.lastResult) : undefined,
    reading: bookmarks.map(row => accountContext(JSON.parse(row.value))),
    recent,
    games: gameCatalog,
    saves: saves.map(({ id, updated, position }) => {
      const g: Game = JSON.parse(position);
      return {
        id,
        kind: g.kind,
        updated,
        level: g.level,
        board: g.board,
        feedback: g.feedback,
        result: g.result,
        paused: g.paused,
        last: g.moves.at(-1),
        legal: legalMoves(g),
      };
    }),
    sharing: state.sharing ?? "detail",
  };
}
async function project(rows: Row[], preference: Visibility): Promise<PublicActivity[]> {
  if (preference === "hidden") return [];
  const notes = new Set<string>();
  const result = rows
    .filter((r) => r.visibility !== "hidden")
    .map((row) => {
      const { detail, remark } = JSON.parse(row.detail) as { detail: Experience; remark?: string };
      const full = preference === "detail" && row.visibility === "detail";
      if (detail.kind==="reading" && detail.status && detail.status!=="ok") {
        detail.items=detail.items.map(({id,title,url})=>({id,title,url,body:""}));
        delete detail.comments;
      }
      if (full && detail.kind === "reading" && detail.action === "archive")
        for (const item of detail.items) item.url = partLink(item.url, videoPart(detail));
      if (full && detail.kind === "game")
        for (const move of detail.game.moves) if (move.origin) notes.add(move.origin);
      return {
        id: row.id,
        made: row.made,
        until: row.until,
        kind: detail.kind,
        label: experienceLabel(detail),
        ...(full ? { detail, ...(remark ? { remark } : {}) } : {}),
      };
    });
  const visible = new Set(
    notes.size
      ? (
          await all<{ id: string }>(
            "SELECT id FROM activities WHERE visibility='detail' AND id IN (SELECT value FROM json_each(?))",
            JSON.stringify([...notes]),
          )
        ).map((r) => r.id)
      : [],
  );
  for (const a of result)
    if (a.detail?.kind === "game") {
      for (const move of a.detail.game.moves) {
        if (move.origin && !visible.has(move.origin)) delete move.note;
        delete move.origin;
      }
    }
  const drawingIds=result.filter(a=>a.detail?.kind==="draw").map(a=>a.id);
  if (drawingIds.length) {
    const paintings=await all<{id:string;art:string;title:string}>(`SELECT a.id,d.id AS art,d.title
      FROM activities a JOIN art_jobs j ON j.made=a.made AND j.peer IS NULL AND j.scope='public' AND j.state='done'
      JOIN drawings d ON d.id=j.art AND d.scope='public' JOIN works w ON w.id=j.work AND w.scope='public' AND w.state<>'hidden'
      WHERE a.id IN (SELECT value FROM json_each(?)) AND (j.id=a.id OR
        (SELECT count(*) FROM activities same WHERE same.made=a.made AND json_extract(same.detail,'$.detail.kind')='draw')=1)
      GROUP BY a.id HAVING count(*)=1`,JSON.stringify(drawingIds));
    const byId=new Map(paintings.map(p=>[p.id,p]));
    for (const a of result) {
      const p=byId.get(a.id);
      if (p && a.detail?.kind==="draw") { a.detail.title=p.title; a.detail.art=p.art; }
    }
  }
  return result;
}
export async function activityPage(state: State, offset: number, limit: number) {
  if (state.sharing === "hidden") return [];
  const rows = await all<Row>(
    "SELECT * FROM activities WHERE visibility<>'hidden' ORDER BY made DESC,rowid DESC LIMIT ? OFFSET ?",
    limit,
    offset,
  );
  return project(rows, state.sharing ?? "detail");
}
export async function publicActivity(state: State, id: string) {
  const row = await one<Row>("SELECT * FROM activities WHERE id=? AND visibility<>'hidden'", id);
  return row ? (await project([row], state.sharing ?? "detail"))[0] : undefined;
}
export async function activityArchive(state: State, cursor: number, limit: number) {
  const rows =
    state.sharing === "hidden"
      ? []
      : await all<Row & { position: number }>(
          "SELECT rowid AS position,* FROM activities WHERE visibility<>'hidden' AND rowid>? ORDER BY rowid LIMIT ?",
          cursor,
          limit + 1,
        );
  const more = rows.length > limit;
  if (more) rows.pop();
  return {
    items: await project(rows, state.sharing ?? "detail"),
    cursor: rows.at(-1)?.position ?? cursor,
    more,
  };
}
export async function publicActivities(state: State, pins: string[] = []) {
  if (state.sharing === "hidden") return [];
  const rows = await all<Row>(
    `SELECT * FROM activities WHERE id IN
    (SELECT id FROM activities WHERE visibility<>'hidden' ORDER BY made DESC,rowid DESC LIMIT 48)
    OR id IN (SELECT value FROM json_each(?)) ORDER BY made DESC,rowid DESC`,
    JSON.stringify(pins),
  );
  return project(rows, state.sharing ?? "detail");
}
// Old observation memories have a structured first line followed by title and observed text.
export function legacyReading(
  m: Pick<Memory, "body" | "category" | "source" | "details">,
): Experience | undefined {
  const [head, title, ...lines] = m.body.split("\n");
  const match = /^(news|bili|heybox) \/ ([a-z_]+) · (.+)$/.exec(head);
  if (!match || !title || !/^https:\/\//.test(m.source)) return;
  let p: { page?: number; offset?: number } = {};
  try {
    p = JSON.parse(m.details || "{}") ?? {};
  } catch {
    /* An early memory can lack structured progress. */
  }
  const level = m.category || match[2];
  const comments = lines.flatMap((line) => {
    const c = /^评论 #(\S+) · (.+)$/.exec(line);
    return c ? [{ id: c[1], text: c[2], parent: "" }] : [];
  });
  return {
    kind: "reading",
    source: match[1] as ReadRequest["source"],
    action: "archive",
    level,
    items: [
      { id: match[3], title, url: m.source, body: lines.filter((l) => !l.startsWith("评论 #")).join("\n") },
    ],
    ...(Number.isInteger(p.page) ? { page: p.page } : {}),
    ...(Number.isInteger(p.offset) ? { offset: p.offset } : {}),
    ...(comments.length ? { comments } : {}),
  };
}
