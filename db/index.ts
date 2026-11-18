import { env } from "cloudflare:workers";
import {
  dayOf,
  firstState,
  residentId,
  type Art,
  type PublicHome,
  type PublicPost,
  type State,
} from "../content/initial";
export function db() {
  if (!env.DB) throw new Error("缺少 D1 连接");
  return env.DB;
}
export async function all<T>(sql: string, ...args: unknown[]) {
  return (
    await db()
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}
export function one<T>(sql: string, ...args: unknown[]) {
  return db()
    .prepare(sql)
    .bind(...args)
    .first<T>();
}
export function stmt(sql: string, ...args: unknown[]) {
  return db()
    .prepare(sql)
    .bind(...args);
}
export async function house(now = Date.now()) {
  await stmt(
    "INSERT OR IGNORE INTO resident(id,state,revision) VALUES (?,?,0)",
    residentId,
    JSON.stringify(firstState(now)),
  ).run();
  const row = await one<{ state: string; revision: number }>(
    "SELECT state,revision FROM resident WHERE id=?",
    residentId,
  );
  return { state: JSON.parse(row!.state) as State, revision: row!.revision };
}
export type Memory = {
  id: string;
  made: number;
  scope: string;
  kind: string;
  body: string;
  source: string;
  evidence: string;
  due: number | null;
  resolved: number;
  topic?: string | null;
  quote?: string | null;
  closed_by?: string | null;
  hidden?: number;
  category?: string | null;
  expires?: number | null;
  details?: string | null;
};
export type ChatLine = {
  id: string;
  peer: string;
  made: number;
  side: "in" | "out";
  body: string;
  art: string | null;
  reply_to: string | null;
  voice?: number;
  seq: number;
  batch_id: string | null;
  handled_at: number | null;
  image_count: number;
  qq_index: string | null;
  quoted_ref: string | null;
  quoted_text: string | null;
  withheld?: number;
  withdrawn?: number;
};
export type Setting = {
  id: string;
  name: string;
  value: string;
  made: number;
  parent: string | null;
};
export async function publicHome(previewSite?:import("../content/site").Site): Promise<PublicHome> {
  const {publishedSite}=await import("../lib/studio");
  const {publicActivities}=await import("../lib/activities");
  const {siteBindings}=await import("../content/site");
  const {publicRoom}=await import("../lib/works");
  const [{ state, revision }, posts, art,objects,site] = await Promise.all([
    house(),
    all<{ day: string; made: number; body: string; sources: string }>(
      "SELECT day,made,body,sources FROM daily_posts ORDER BY day DESC LIMIT 4",
    ),
    all<Art>(
      "SELECT id,title,made FROM drawings WHERE scope='public' ORDER BY made DESC LIMIT 6",
    ),
    publicRoom(),previewSite??publishedSite(),
  ]);
  const {loadCabin}=await import("../lib/cabin-store");
  const cabin=await loadCabin(state);
  const visible=cabin.publicItems();
  const pins=siteBindings(site);
  const [activities,boundArt,boundPosts]=await Promise.all([
    publicActivities(state,pins.activities),
    pins.art.length?all<Art>("SELECT id,title,made FROM drawings WHERE scope='public' AND id IN (SELECT value FROM json_each(?))",JSON.stringify(pins.art)):[],
    pins.posts.length?all<{day:string;body:string;made:number;sources:string}>("SELECT day,body,made,sources FROM daily_posts WHERE day IN (SELECT value FROM json_each(?))",JSON.stringify(pins.posts)):[],
  ]);
  const current=activities.find(a=>a.id===state.currentActivity);
  const inBed=!!state.inBed && state.bedVisibility!=="hidden" && state.sharing!=="hidden";
  const asleep=state.mode==="asleep" && (current?.kind==="sleep" || inBed);
  return {
    name: state.name,site,activities,boundArt,boundPosts:boundPosts.map(p=>({...p,sources:JSON.parse(p.sources)})),currentActivity:current?.id,
    mode: asleep?"asleep":"awake",
    inBed,
    activity: current?.label??(asleep?"在床上睡觉":inBed?"醒着，在床上躺一会儿":"在小屋"),
    room: cabin.scene(visible),cabin:visible,
    revision,
    posts: posts.map((p) => ({
      ...p,
      sources: JSON.parse(p.sources) as PublicPost["sources"],
    })),
    art,objects,
  };
}
export async function archive(day: string) {
  const row = await one<{
    day: string;
    body: string;
    made: number;
    sources: string;
  }>("SELECT day,body,made,sources FROM daily_posts WHERE day=?", day);
  return row ? { ...row, sources: JSON.parse(row.sources) } : null;
}
export async function publicPage(params:URLSearchParams) {
  const home=await publicHome(),type=params.get("archive");
  const target=params.get("activity");
  if(type==="activities" || target) {
    const {activityPage,publicActivity}=await import("../lib/activities");
    const {state}=await house();
    if(type==="activities") {
      const rows=await activityPage(state,Math.max(0,parseInt(params.get("offset")||"0",10)||0),25);
      home.activities=rows.slice(0,24);home.more=rows.length>24;
    }
    if(target && !home.activities?.some(a=>a.id===target)) {
      const item=await publicActivity(state,target);
      if(item) home.activities=[...(home.activities??[]),item];
    }
    return home;
  }
  if(type!=="journal" && type!=="gallery") return home;
  const query=(params.get("q")??"").trim().slice(0,90), month=params.get("month")??"",series=params.get("series")??"",day=params.get("day")??"";
  const offset=Math.max(0,parseInt(params.get("offset")??"0",10)||0);
  const allSeries=await all<{id:string;title:string}>("SELECT id,title FROM works WHERE scope='public' AND state<>'hidden' ORDER BY updated DESC");
  home.series=allSeries;
  if(type==="gallery") {
    home.art=await all<Art>(`SELECT id,title,made FROM drawings d WHERE scope='public' AND instr(title,?)>0 AND strftime('%Y-%m',made/1000,'unixepoch','+8 hours') LIKE ?
      AND (?='' OR EXISTS(SELECT 1 FROM work_steps s JOIN works w ON w.id=s.work WHERE w.id=? AND w.scope='public' AND w.state<>'hidden' AND s.art=d.id)) ORDER BY made DESC,id DESC LIMIT 25 OFFSET ?`,query,month+"%",series,series,offset);
    home.more=home.art.length>24;home.art=home.art.slice(0,24);
  } else {
    const rows=await all<Omit<PublicPost,"sources"> & {sources:string}>(`SELECT day,made,body,sources FROM daily_posts p WHERE day LIKE ? AND (?='' OR day=?) AND (instr(body,?)>0 OR instr(sources,?)>0)
      AND (?='' OR EXISTS(SELECT 1 FROM work_steps s JOIN works w ON w.id=s.work JOIN json_each(p.evidence) e ON e.value=s.evidence WHERE w.id=? AND w.scope='public' AND w.state<>'hidden'))
      ORDER BY day DESC LIMIT 25 OFFSET ?`,month+"%",day,day,query,query,series,series,offset);
    home.posts=rows.slice(0,24).map(p=>({...p,sources:JSON.parse(p.sources)}));home.more=rows.length>24;
  }
  return home;
}
export async function tickLock(now: number) {
  await house(now);
  const token = crypto.randomUUID();
  const result = await stmt(
    "UPDATE resident SET lease=?,lease_until=? WHERE id=? AND lease_until<=?",
    token,
    now + 180000,
    residentId,
    now,
  ).run();
  return result.meta.changes ? token : null;
}
export async function unlock(token: string) {
  await stmt(
    "UPDATE resident SET lease=NULL,lease_until=0 WHERE id=? AND lease=?",
    residentId,
    token,
  ).run();
}
// Keep daily usage for diagnostics; it never controls whether an activity can run.
export async function recordModelCall(now: number) {
  const d = dayOf(now);
  await stmt(
    "UPDATE resident SET calls=CASE WHEN budget_day=? THEN calls+1 ELSE 1 END,budget_day=? WHERE id=?",
    d,
    d,
    residentId,
  ).run();
}
export async function discardModelCall(now: number) {
  await stmt("UPDATE resident SET calls=MAX(calls-1,0) WHERE id=? AND budget_day=?", residentId, dayOf(now)).run();
}
// All mutations in a turn, including memories and public posts, are fenced by the lease.
export async function commit(
  token: string,
  state: State,
  changes: D1PreparedStatement[],
  keepLease = false,
) {
  const guard = stmt(
    "UPDATE resident SET revision=CASE WHEN lease=? THEN revision+1 ELSE NULL END,state=?" +
      (keepLease ? "" : ",lease=NULL,lease_until=0") + " WHERE id=?",
    token,
    JSON.stringify(state),
    residentId,
  );
  await db().batch([guard, ...changes]);
}
export function memory(
  m: Partial<Memory> & Pick<Memory, "scope" | "kind" | "body">,
  now: number,
) {
  const row: Memory = {
    id: crypto.randomUUID(),
    made: now,
    source: "",
    evidence: "[]",
    due: null,
    resolved: 0,
    ...m,
  };
  return {
    row,
    write: stmt(
      "INSERT OR IGNORE INTO memories(id,made,scope,kind,body,source,evidence,due,resolved,topic,quote,closed_by,category,expires,details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      row.id,
      row.made,
      row.scope,
      row.kind,
      row.body,
      row.source,
      row.evidence,
      row.due,
      row.resolved,
      row.topic ?? null, row.quote ?? null, row.closed_by ?? null,
      row.category ?? null, row.expires ?? null, row.details ?? null,
    ),
  };
}
export async function currentSetting(name: string) {
  return one<Setting>(
    "SELECT * FROM agent_versions WHERE name=? ORDER BY made DESC,rowid DESC LIMIT 1",
    name,
  );
}
export function saveVersion(
  name: string,
  value: string,
  parent: string | null,
  now: number,
  id: string = crypto.randomUUID(),
) {
  return stmt(
    "INSERT INTO agent_versions(id,name,value,parent,made) VALUES (?,?,?,?,?)",
    id,
    name,
    value,
    parent,
    now,
  );
}
