import { all, stmt } from "../db";
import type { State } from "../content/initial";
import type { Reading } from "../content/activity";
import { eventRelativeTime } from "./friend-memory";

// Called under the resident lease. The version, evidence corrections and archive epoch commit together.
export async function upgradeExperience(state: State) {
  const writes: D1PreparedStatement[] = [];
  const pairs = await all<{plan:string; promise:string; body:string; category:string; resolved:number; due:number|null; quote:string|null; made:number}>(`
    SELECT p.id AS plan,m.id AS promise,p.body,p.category,m.resolved,m.due,m.quote,p.made
    FROM memories p JOIN memories m ON m.made=p.made AND m.body=p.body
    WHERE p.kind='day_plan' AND p.scope IN ('public','self') AND p.hidden=0 AND m.kind='promise'
      AND m.scope='self' AND m.hidden=0 AND json_extract(m.details,'$.planId') IS NULL
      AND (SELECT count(*) FROM memories x WHERE x.made=p.made AND x.body=p.body AND x.kind='day_plan' AND x.scope IN ('public','self'))=1
      AND (SELECT count(*) FROM memories x WHERE x.made=p.made AND x.body=p.body AND x.kind='promise' AND x.scope='self')=1`);
  for (const pair of pairs) {
    const flexible = eventRelativeTime(pair.quote || pair.body);
    const due = flexible && (pair.quote || (pair.due!==null && pair.due<pair.made)) ? null : pair.due;
    writes.push(stmt("UPDATE memories SET details=json_set(coalesce(details,'{}'),'$.planId',?) WHERE id=?",pair.plan,pair.promise));
    const confirmed = pair.resolved && !["done","interrupted"].includes(pair.category);
    writes.push(stmt(`UPDATE memories SET category=?,due=?,quote=?,details=CASE WHEN ? THEN
      json_set(coalesce(details,'{}'),'$.reason','当时自己标记为完成。','$.selfConfirmed',1) ELSE details END WHERE id=?`,
      confirmed?"done":pair.category,due,pair.quote??(flexible?pair.body:null),confirmed?1:0,pair.plan));
  }

  const reads = await all<{id:string; detail:string; failure:string|null}>(`SELECT a.id,a.detail,
    (SELECT m.body FROM memories m WHERE m.made=a.made AND m.scope='self' AND m.kind='access' AND m.hidden=0
      AND instr(m.body,json_extract(a.detail,'$.detail.source')||' 的 '||json_extract(a.detail,'$.detail.action')||' 返回 ')=1
      GROUP BY m.made HAVING count(DISTINCT m.body)=1) AS failure
    FROM activities a WHERE json_extract(a.detail,'$.detail.kind')='reading' AND json_extract(a.detail,'$.detail.status') IS NULL
      AND json_extract(a.detail,'$.detail.action')<>'archive'`);
  for (const row of reads) {
    const read: Reading = JSON.parse(row.detail).detail;
    const last = state.lastResult as {id?:string;status?:string} | undefined;
    let status = row.failure?.match(/ 返回 ([a-z_0-9-]{1,45})。$/)?.[1];
    if (!status && last?.id===row.id && typeof last.status==="string" && /^[a-z_0-9-]{1,45}$/.test(last.status)) status=last.status;
    if (!status && read.source==="bili" && ["subtitles","frames","comments"].includes(read.action) && read.level==="metadata") status="unverified";
    if (!status || status==="ok") continue;
    writes.push(stmt("UPDATE activities SET detail=json_set(detail,'$.detail.status',?),until=min(made,until) WHERE id=?",status,row.id));
    if (state.currentActivity===row.id) {
      state.currentActivity=undefined;
      state.activity=state.mode==="asleep"?"睡着了":state.inBed?"醒着，在床上躺一会儿":"在小屋";
    }
  }
  // In previous versions attention was assigned exclusively by the media adapter.
  state.attention="";
  state.experienceVersion=1;
  state.shareEpoch=crypto.randomUUID();
  return writes;
}
