import { createHash } from "node:crypto";
import type { ActionReceipt, State } from "../content/initial";
import type { Experience, Reading } from "../content/activity";
import { all, one, stmt } from "../db";
import type { Observation, ReadRequest } from "./media";

export type Outcome = Pick<ActionReceipt, "status" | "summary" | "ref"> & { result?: unknown };

export function finishAction(state: State, action: string, made: number, outcome: Outcome, scope = "self") {
  const { result, status, summary, ref } = outcome;
  state.lastAction = { action, made, status, summary, ref };
  state.lastResult = result;
  state.lastActionScope = scope;
}

export function chatOutcome(status: string, batch?: string, incoming = false): Outcome {
  if (status === "queued") return {status:"queued", summary:"消息已进入发送队列。", ref:batch};
  if (status === "read") return {status:"skipped", summary:incoming ? "看过来信，这次没有发消息。" : "这次没有主动发消息。"};
  return {status:"deferred", summary:"这次联系暂缓。"};
}

// A bookmark belongs to the material or list. An unrelated action can replace the last outcome freely.
export function readingBookmark(q: ReadRequest, observation: Observation, made?: number, work?: string) {
  const {source, action, id, query, root, page, offset, cursor} = q;
  const key = createHash("sha256").update(JSON.stringify([source, action, id, query, root, work])).digest("hex");
  return stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)", "reading-progress/" + key, JSON.stringify({
    source, action, id, query, root, page, offset, cursor, work, made,
    level: observation.level, nextCursor: observation.nextCursor, nextPage: observation.nextPage, nextOffset:observation.nextOffset, atEnd:observation.atEnd, coverage:observation.coverage,
    items: observation.items.slice(0,5).map(item => ({id:item.id, title:item.title.slice(0,100), playback:item.playback})),
  }));
}

function oldReading(read: Reading): ReadRequest {
  return {source:read.source as ReadRequest["source"], action:read.action as ReadRequest["action"], page:read.page, offset:read.offset, root:read.root,
    id:["open","subtitles","comments","image","frames"].includes(read.action) ? read.items[0]?.id : undefined};
}

type OldResult = Partial<Observation> & {id?: string; save?: string};

function isOldObservation(value: OldResult | undefined): value is OldResult & Observation {
  return typeof value?.level === "string" && typeof value.status === "string" &&
    Array.isArray(value.items) && value.items.every(item =>
      typeof item?.id === "string" && typeof item.title === "string" &&
      typeof item.url === "string" && typeof item.body === "string");
}

// Older installations retained the last read or error across later turns. Match effects to the
// original decision time; a work's current state and a background completion can be much newer.
async function historicalOutcome(made: number, legacy: OldResult | undefined): Promise<ActionReceipt> {
  const [activity, plan, job, work, failure, room, post] = await Promise.all([
    one<{id:string;detail:string}>("SELECT id,detail FROM activities WHERE made=? ORDER BY rowid DESC LIMIT 1",made),
    one<{id:string;body:string}>("SELECT id,body FROM memories WHERE made=? AND kind='day_plan' AND scope IN ('public','self') AND hidden=0 LIMIT 1",made),
    one<{id:string;idea:string}>("SELECT id,idea FROM art_jobs WHERE made=? AND peer IS NULL AND scope IN ('public','self') LIMIT 1",made),
    one<{id:string;title:string}>("SELECT id,title FROM works WHERE made=? AND scope IN ('public','self') AND state<>'hidden' LIMIT 1",made),
    one<{id:string;body:string}>("SELECT id,body FROM memories WHERE made=? AND kind='access' AND scope='self' AND hidden=0 AND body LIKE '动作 % 未完成，原因 %' LIMIT 1",made),
    one<{id:string;body:string}>(`SELECT id,body FROM memories WHERE made=? AND kind='event' AND scope IN ('public','self') AND hidden=0
      AND (body LIKE '移动了%' OR body LIKE '添置了%' OR body LIKE '收起了%') LIMIT 1`,made),
    one<{day:string}>("SELECT day FROM daily_posts WHERE made=? LIMIT 1",made),
  ]);
  if (failure) return {action:failure.body.split(" ")[1],made,status:"failed",summary:failure.body,ref:failure.id};
  if (plan) return {action:"plan",made,status:"planned",summary:"记下了打算："+plan.body,ref:plan.id};
  if (activity) {
    const detail: Experience = JSON.parse(activity.detail).detail;
    const ref = activity.id;
    switch (detail.kind) {
      case "game": return {action:"play",made,status:"done",summary:detail.op==="look"?"查看了游戏存档。":detail.game.feedback,ref};
      case "rest": case "sleep": return {action:detail.kind,made,status:"started",summary:detail.description,ref};
      case "room": return {action:"room",made,status:"done",summary:room?.body ?? detail.description,ref};
      case "reading": return {action:"read",made,status:detail.status==="unverified"?"unverified":(detail.status && detail.status!=="ok") || (legacy?.id===ref && legacy.status && legacy.status!=="ok") ? "failed" : "done",
        summary:"当时的读取记录："+detail.level+" · "+(detail.items[0]?.title ?? "无条目"),ref};
      case "draw": if (job) return {action:"draw",made,status:"queued",summary:"画稿已排队："+job.idea,ref:job.id};
    }
  }
  if (work) return {action:"work",made,status:"started",summary:"新建了作品《"+work.title+"》。",ref:work.id};
  if (post) return {action:"journal",made,status:"done",summary:"发布了站内动态。",ref:post.day};
  return {action:"unknown",made,status:"unverified",summary:"这次决定的具体结果没有可核实的记录。"};
}

export async function recoverLastAction(state: State) {
  const writes: D1PreparedStatement[] = [];
  const legacy = state.lastResult as OldResult | undefined;
  if (legacy !== undefined) writes.push(stmt("INSERT OR IGNORE INTO channel_state VALUES('legacy/action-result',?)",JSON.stringify(legacy)));

  const positions=await all<{made:number;detail:string;work:string|null}>(`SELECT a.made,a.detail,
    (SELECT s.work FROM work_steps s JOIN works w ON w.id=s.work WHERE s.url='/activity/'||a.id AND w.scope='public' LIMIT 1) AS work
    FROM activities a WHERE json_extract(a.detail,'$.detail.kind')='reading' AND json_extract(a.detail,'$.detail.level')<>'metadata'
    AND json_extract(a.detail,'$.detail.action') IN ('open','subtitles','comments','image','frames')
    ORDER BY a.made DESC,a.rowid DESC LIMIT 12`);
  for (const position of positions.reverse()) {
    const read: Reading = JSON.parse(position.detail).detail;
    if (read.source==="bili" || read.source==="heybox") writes.push(readingBookmark(oldReading(read),{status:"ok",level:read.level,items:read.items},position.made,position.work??undefined));
  }
  if (isOldObservation(legacy) && legacy.status === "ok") {
    if (legacy.level === "history" || legacy.level === "watch_later")
      writes.push(readingBookmark({source:"bili",action:legacy.level},legacy));
    else if (legacy.id) {
      const row = await one<{made:number;detail:string}>("SELECT made,detail FROM activities WHERE id=?",legacy.id);
      const read = row && JSON.parse(row.detail).detail as Reading;
      if (row && read?.kind === "reading" && (read.source==="bili" || read.source==="heybox")) writes.push(readingBookmark(oldReading(read),legacy,row.made));
    }
  }
  const last = await one<{made:number;kind:string;id:string|null;incoming:number|null}>(`SELECT * FROM (
    SELECT made,'decision' AS kind,NULL AS id,NULL AS incoming FROM model_usage WHERE task='activity' AND status='ok'
    UNION ALL SELECT made,'record',id,NULL FROM activities
    UNION ALL SELECT made,'record',id,NULL FROM memories WHERE kind='day_plan' AND scope IN ('self','public') AND hidden=0
    UNION ALL SELECT made,'record',id,NULL FROM works WHERE scope IN ('self','public') AND state<>'hidden'
    UNION ALL SELECT made,status,id,json_extract(details,'$.incoming') FROM reply_turns WHERE status IN ('queued','silent')
    UNION ALL SELECT made,'wake',id,NULL FROM memories WHERE kind='event' AND scope IN ('self','public') AND hidden=0 AND body='睡醒了。'
    ) ORDER BY made DESC, CASE kind WHEN 'queued' THEN 3 WHEN 'silent' THEN 3 WHEN 'decision' THEN 2 WHEN 'wake' THEN 1 ELSE 0 END DESC LIMIT 1`);
  state.lastResult = undefined;
  state.lastAction = null;
  state.lastActionScope = "self";
  if (!last) return writes;
  if (last.kind === "wake") finishAction(state,"wake",last.made,{status:"done",summary:"睡醒了。",ref:last.id!});
  else if (last.kind === "silent" || last.kind === "queued") finishAction(state,"chat",last.made,chatOutcome(last.kind==="silent"?"read":"queued",last.id!,!!last.incoming));
  else {
    state.lastAction = await historicalOutcome(last.made,legacy);
    // A matching activity ID is stronger evidence than the unlabelled legacy slot.
    if (legacy?.id && state.lastAction.ref === legacy.id) {
      const matchingRead = state.lastAction.action === "read" && isOldObservation(legacy);
      const matchingGame = state.lastAction.action === "play" && typeof legacy.save === "string";
      if (matchingRead || matchingGame) state.lastResult = legacy;
    }
  }
  if (state.mode==="awake" && !state.currentActivity && state.lastAction?.action!=="read") state.activity="在小屋";
  return writes;
}

