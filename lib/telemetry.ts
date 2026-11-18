import { all, one, stmt } from "../db";
import { dayOf } from "../content/initial";
import { failureReason } from "./diagnostics";
import type { State } from "../content/initial";

export function workInputTrace(value:unknown) {
  const raw=value && typeof value==="object" ? value as Record<string,unknown> : {};
  const result:Record<string,string|number>={};
  for (const key of ["action","id","title","kind","evidence","query","offset"])
    if (typeof raw[key]==="string") result[key]=raw[key].slice(0,180);
    else if (typeof raw[key]==="number") result[key]=raw[key];
  return result;
}

// Private, bounded diagnostics keep chosen timing and targets next to their actual receipts.
// Arbitrary tool arguments and conversation messages are deliberately excluded.
export function activityTrace(now:number, choice:unknown, state:State) {
  const raw=choice && typeof choice==="object" ? choice as Record<string,unknown> : {};
  const requested:Record<string,unknown>={};
  for (const key of ["action","minutes","posture","evidenceId","idea","thought"])
    if (typeof raw[key]==="string") requested[key]=raw[key].slice(0,600);
    else if (typeof raw[key]==="number" || raw[key]===null) requested[key]=raw[key];
  if (raw.question===null) requested.question=null;
  if (raw.work!==undefined) requested.work=workInputTrace(raw.work);
  const result=state.lastResult as {field?:string;rest?:unknown}|undefined;
  return [stmt("INSERT INTO channel_state(id,value) VALUES(?,?)",
    "activity-decision/"+String(now).padStart(16,"0")+"/"+crypto.randomUUID(),
    JSON.stringify({at:now,requested,outcome:state.lastAction,field:result?.field,rest:result?.rest,
      nextAt:state.nextAt,mode:state.mode,inBed:!!state.inBed})),
    stmt(`DELETE FROM channel_state WHERE id LIKE 'activity-decision/%' AND id NOT IN
      (SELECT id FROM channel_state WHERE id LIKE 'activity-decision/%' ORDER BY id DESC LIMIT 256)`)];
}

export type Meter={prompt_tokens?:number;completion_tokens?:number;total_cost?:number;currency?:string};
export async function measured<T>(task:string,model:string,now:number,fn:(receipt:(usage?:Meter)=>void)=>Promise<T>) {
  const start=Date.now();
  let status="ok",usage:Meter|undefined;
  try { return await fn(value=>{usage=value;}); }
  catch(error) { status=failureReason(error); throw error; }
  finally {
    const tokens=(v:unknown)=>typeof v==="number" && Number.isSafeInteger(v) && v>=0?v:null;
    const cost=typeof usage?.total_cost==="number" && Number.isFinite(usage.total_cost) && /^[A-Z]{3}$/.test(usage.currency??"")
      ? usage!.currency+" "+usage!.total_cost:null;
    await stmt("INSERT INTO model_usage VALUES(?,?,?,?,?,?,?,?,?)",crypto.randomUUID(),now,task,model,status,
      Math.max(0,Date.now()-start),tokens(usage?.prompt_tokens),tokens(usage?.completion_tokens),cost).run().catch(()=>{});
  }
}
export function trace(scope:string,now:number,status:string,details:Record<string,unknown>,id=crypto.randomUUID() as string) {
  return stmt("INSERT OR REPLACE INTO reply_turns VALUES(?,?,?,?,?)",id,scope,now,status,JSON.stringify(details));
}
export async function diagnostics(now=Date.now()) {
  const since=Date.parse(dayOf(now)+"T00:00:00+08:00");
  const [turns,metrics,usage,jobs,health]=await Promise.all([
    all<{id:string;made:number;status:string;details:string;receipts:string;deliveryStats:string}>(`SELECT t.id,t.made,t.status,t.details,
      (SELECT group_concat(COALESCE(d.state,'queued'),',') FROM messages m LEFT JOIN deliveries d ON d.id=m.id
        WHERE m.batch_id=t.id AND m.side='out' AND (m.peer LIKE 'qq-%' OR d.id IS NOT NULL)) AS receipts,
      (SELECT json_group_array(json(c.value)) FROM messages m JOIN channel_state c ON c.id='delivery-time/'||m.id
        WHERE m.batch_id=t.id ORDER BY m.seq) AS deliveryStats FROM reply_turns t ORDER BY t.made DESC,t.rowid DESC LIMIT 40`),
    all("SELECT task,model,count(*) AS calls,sum(status<>'ok') AS failures,round(avg(elapsed)) AS latency,sum(input) AS input,sum(output) AS output,group_concat(cost,', ') AS charges FROM model_usage WHERE made>=? GROUP BY task,model",since),
    one<{calls:number}>("SELECT CASE WHEN budget_day=? THEN calls ELSE 0 END AS calls FROM resident LIMIT 1",dayOf(now)),
    all("SELECT id,state,attempts,made,due,detail FROM art_jobs ORDER BY made DESC LIMIT 16"),
    all<{id:string;value:string}>("SELECT id,value FROM channel_state WHERE id LIKE 'health/%' OR id IN ('qq-ready','clock-health','bridge-health')"),
  ]);
  return {turns:turns.map(t=>({...t,details:JSON.parse(t.details),deliveryStats:JSON.parse(t.deliveryStats)})),metrics,budget:usage?.calls??0,limit:null,jobs,health};
}
