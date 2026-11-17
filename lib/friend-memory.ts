import { createHash } from "node:crypto";
import { dayOf } from "../content/initial";
import { all, memory, one, stmt, type ChatLine, type Memory } from "../db";
import { identityFor, relatedPeers } from "./conversation";
import { think } from "./model";

const text = (v: unknown, length: number) => typeof v === "string" ? v.trim().slice(0,length) : "";
export type SourceLine = Pick<ChatLine,"id"|"made"|"body"|"side"> & {peer?:string};
export async function friendCard(scope: string, now=Date.now()) {
  const facts = await all<Memory>(`SELECT * FROM (
    SELECT m.*, ROW_NUMBER() OVER(PARTITION BY topic ORDER BY m.made DESC,original.rowid DESC,m.rowid DESC) AS position
    FROM memories m LEFT JOIN messages original ON original.id=substr(json_extract(m.evidence,'$[0]'),9)
    WHERE m.scope=? AND m.kind='profile' AND m.hidden=0 AND (m.expires IS NULL OR m.expires>?)
  ) WHERE position=1 AND resolved=0 ORDER BY topic='称呼' DESC,made DESC`,scope,now);
  const promises = await all<Memory>(`SELECT * FROM memories WHERE scope=? AND kind='promise' AND resolved=0 AND hidden=0
    ORDER BY due IS NULL,due,made`,scope);
  return {facts,promises};
}
export function cardContext(card: Awaited<ReturnType<typeof friendCard>>) {
  return { facts:card.facts.slice(0,32).map(m=>({topic:m.topic,value:m.body,category:m.category??undefined,until:m.expires?shanghaiDate(m.expires):undefined})),
    promises:card.promises.slice(0,24).map(m=>({id:m.id,what:m.body,when:m.quote || undefined,
      due:m.topic==="schedule" && m.due ? shanghaiDate(m.due) : undefined})) };
}
export async function visibleFriendCard(identity:string,offset=0,limit=64) {
  const scope="chat:"+identity, peers=await relatedPeers(identity);
  const card=await friendCard(scope);
  const facts=card.facts.slice(offset,offset+limit);
  const promises=facts.length<limit?await all<Memory>(`SELECT * FROM memories WHERE scope=? AND hidden=0 AND kind IN ('promise','episode','followup','occasion')
    ORDER BY resolved=0 DESC,made DESC,id LIMIT ? OFFSET ?`,scope,limit-facts.length,Math.max(0,offset-card.facts.length)):[];
  const items=[...facts,...promises];
  const evidence=(m:Memory):string[]=>[...new Set<string>([...JSON.parse(m.evidence),...(m.closed_by?[m.closed_by]:[])])];
  const ids=[...new Set(items.flatMap(evidence))];
  const sources=ids.length?await all<{ref:string;body:string;side:string;made:number}>(`SELECT CASE side WHEN 'in' THEN 'chat-in-' ELSE 'chat-out-' END || id AS ref,body,side,made
    FROM messages WHERE withheld=0 AND peer IN (${peers.map(()=>"?").join(",")}) AND ref IN (SELECT value FROM json_each(?))
    UNION ALL SELECT q.id,q.body,l.side,l.made FROM memories q JOIN messages l ON q.source='chat-'||l.side||'-'||l.id
      WHERE q.scope=? AND q.kind='source_quote' AND q.hidden=0 AND l.withdrawn=0 AND l.peer IN (SELECT value FROM json_each(?))
        AND q.id IN (SELECT value FROM json_each(?))`,...peers,JSON.stringify(ids),scope,JSON.stringify(peers),JSON.stringify(ids)):[];
  const sourceMap=new Map(sources.map(s=>[s.ref,s]));
  const pictures=await all<{id:string;title:string;ref:string}>(`SELECT DISTINCT d.id,d.title,'chat-in-'||j.origin AS ref FROM art_jobs j JOIN drawings d ON d.id=j.art
    WHERE j.scope=? AND d.scope=? AND j.state='done' AND ('chat-in-'||j.origin) IN (SELECT value FROM json_each(?))`,scope,scope,JSON.stringify(ids));
  return items.map(m=>({id:m.id,kind:m.kind,topic:m.topic,body:m.body,when:m.kind==="promise"?m.quote:null,
    due:m.due?shanghaiDate(m.due):null,status:m.resolved || (m.kind==="followup" && m.expires && m.expires<=Date.now()?3:0),category:m.category,expires:m.expires,
    art:pictures.filter(p=>evidence(m).includes(p.ref)).map(({id,title})=>({id,title})),
    sources:evidence(m).flatMap(id=>{ const s=sourceMap.get(id);return s?[{side:s.side,body:s.body,made:s.made}]:[]; })}));
}
export function shanghaiDate(ms:number) {
  return new Date(ms+8*3600000).toISOString().slice(0,16);
}
export const profileInstructions =
  "profile 仅提取有原话依据的事实，每项 {topic,value,source,quote,category:'stated'|'temporary'|'habit'|'joke',when?,remove?}。source 是输入行的整数编号，quote 是逐字原话。玩笑不进卡；临时状态写时间原话 when；观察到的习惯标 habit，必须跨日佐证。明确自述用 stated。称呼统一 topic=称呼，偏好变化沿用原主题，明确撤销且无替代用 remove=true。";

export function profileWrites(scope: string, raw: unknown, lines: SourceLine[]) {
  const writes: D1PreparedStatement[] = [];
  if (!Array.isArray(raw)) return writes;
  for (const item of raw.slice(0,16)) {
    if (!item || !Number.isInteger(item.source)) continue;
    const line = lines[item.source-1];
    const quote = text(item.quote,400), value = text(item.value,240);
    const statedTopic=text(item.topic,55).normalize("NFKC").replace(/\s+/g,"");
    let topic = statedTopic.replace(/(?:的偏好|偏好|喜好|喜恶)$/,"") || statedTopic;
    if (/^(?:名字|昵称|称谓|称呼偏好|姓名)$/.test(topic)) topic = "称呼";
    if (line?.side !== "in" || item.category==="joke" || !topic || !quote || !line.body.includes(quote) || (!value && item.remove !== true)) continue;
    // The source line ID also makes a repeated sleep pass idempotent.
    const id = "fact-" + createHash("sha256").update(line.id+"\n"+topic).digest("hex");
    const category = item.category==="temporary" || item.category==="habit" ? item.category : "stated";
    const when = text(item.when,120);
    let expires:number|null=null;
    if(category==="temporary") {
      const endOfDay=Date.parse(dayOf(line.made)+"T00:00:00+08:00")+86400000;
      const explicit=when && line.body.includes(when)?promiseDue(when,line.made,item.dueLocal):null;
      expires=explicit && explicit>line.made ? explicit : /今天|今日|今晚/.test(when)?endOfDay:line.made+86400000;
    }
    if (category==="habit") {
      writes.push(memory({id:id+"-observation",scope,kind:"habit_sample",body:quote,topic,quote,evidence:JSON.stringify(["chat-in-"+line.id])},line.made).write);
      writes.push(stmt(`INSERT OR IGNORE INTO memories(id,made,scope,kind,body,topic,quote,category,evidence,source,resolved)
        SELECT ?,?,?, 'profile',?,?,?,'habit',json_group_array(json_extract(evidence,'$[0]')),'',0 FROM memories
        WHERE scope=? AND kind='habit_sample' AND topic=? AND hidden=0 AND made<=?
        HAVING count(DISTINCT date(made/1000,'unixepoch','+8 hours'))>=2`,id,line.made,scope,"可能有这个习惯："+value,topic,quote,scope,topic,line.made));
      continue;
    }
    writes.push(memory({id,scope,kind:"profile",body:value || quote,category,expires,topic,quote,resolved:item.remove===true?1:0,
      evidence:JSON.stringify(["chat-in-"+line.id])},line.made).write);
  }
  return writes;
}

export async function reviewFriendBatch(now: number) {
  const first = await one<{peer:string}>("SELECT peer FROM messages WHERE withheld=0 AND reviewed=0 AND handled_at IS NOT NULL AND side='in' ORDER BY made,rowid LIMIT 1");
  if (!first) return [];
  const identity = await identityFor(first.peer), scope = "chat:"+identity;
  const peers = await relatedPeers(identity);
  const rows = await all<SourceLine>("SELECT id,made,side,body FROM messages WHERE withheld=0 AND reviewed=0 AND side='in' AND handled_at IS NOT NULL AND peer IN ("+
    peers.map(()=>"?").join(",")+") ORDER BY made,rowid LIMIT 18",...peers);
  let size=0;
  const lines: SourceLine[]=[];
  for (const row of rows) { if (lines.length && size+row.body.length>11500) break; lines.push(row); size+=row.body.length; }
  const answer = await think("你在睡中为一位好友整理新增来信。每一行都是这同一个人的原话，按顺序整理。已有卡片可能包含比这些原话更新的观点，事实以原话发生时间为准。返回 {profile:[]}。"+profileInstructions,
    {lines:lines.map((l,i)=>({source:i+1,date:shanghaiDate(l.made),text:l.body})),card:cardContext(await friendCard(scope,now)).facts},now,"activity",undefined,"friend_review");
  if (!Array.isArray(answer?.profile)) throw Error("好友记忆整理格式错误");
  return [...profileWrites(scope,answer.profile,lines),
    stmt("UPDATE messages SET reviewed=1 WHERE id IN ("+lines.map(()=>"?").join(",")+")",...lines.map(l=>l.id))];
}

// Old versions assigned every commitment a 24-hour deadline. Only the
// original friend's exchange can supply a replacement for that guessed date.
export async function reviewLegacyPromise(now:number) {
  const p=await one<Memory>("SELECT * FROM memories WHERE hidden=0 AND scope LIKE 'chat:%' AND kind='promise' AND topic IS NULL AND resolved=0 ORDER BY made,rowid LIMIT 1");
  if(!p) return [];
  const peers=await relatedPeers(p.scope.slice(5));
  const lines=await all<SourceLine>("SELECT id,side,body,made FROM messages WHERE withheld=0 AND peer IN ("+peers.map(()=>"?").join(",")+
    ") AND (('chat-out-'||id) IN (SELECT value FROM json_each(?)) OR (made<=? AND made>=?)) ORDER BY ABS(made-?),rowid LIMIT 12",
    ...peers,p.evidence,p.made,p.made-6*3600000,p.made);
  const original=new Set<string>(JSON.parse(p.evidence));
  let when:string|null=null, due:number|null=null;
  if(lines.some(l=>l.side==="out" && original.has("chat-out-"+l.id))) {
    const answer=await think("核对旧约定的时间。仅用所附同一位好友的原话识别这个约定何时履行。如有明确时间，返回 {source:行号,when:逐字时间短语,dueLocal?:上海时间YYYY-MM-DDTHH:mm}，无从确定返回 {when:null}。不要推测。",{
      promise:p.body,lines:lines.map((l,i)=>({source:i+1,side:l.side,date:shanghaiDate(l.made),text:l.body.slice(0,900)})),
    },now);
    const line=lines[Number(answer.source)-1], phrase=text(answer.when,120);
    if(line && phrase && line.body.includes(phrase)){when=phrase;due=promiseDue(phrase,line.made,answer.dueLocal);}
    if(when && line) original.add((line.side==="in"?"chat-in-":"chat-out-")+line.id);
  }
  return [stmt("UPDATE memories SET topic='schedule',due=?,quote=?,evidence=? WHERE id=? AND scope=? AND topic IS NULL",
    due,when,JSON.stringify([...original]),p.id,p.scope)];
}

function numberCN(s:string) {
  if (/^\d+$/.test(s)) return Number(s);
  const digit=(x:string)=>"零一二三四五六七八九".indexOf(x.replace("两","二"));
  if (s.includes("十")) { const [a,b]=s.split("十"); return (a?digit(a):1)*10+(b?digit(b):0); }
  return digit(s);
}
export function eventRelativeTime(phrase: string) {
  const n="[零一二两三四五六七八九十\\d]+";
  const event="(?:临睡|睡前|睡觉[之以]?前|入睡[之以]?前|醒来|睡醒|起床|下班|放学|饭[前后]|吃完饭|回家后|忙完|有空时)";
  const clock=n+"(?:[:：]\\d{1,2}|[点时](?!点)(?:半|"+n+"分?)?)";
  return new RegExp(event).test(phrase) &&
    !new RegExp(clock+"(?:钟|左右)?[，、 ]*"+event+"|"+event+"[，、 ]*(?:今晚|晚上|早上|下午)?"+clock).test(phrase);
}
export function planTiming(idea:string, when:string|undefined, base:number, proposed?:string) {
  const precise = when && /[零一二两三四五六七八九十\d]+(?:[:：点时]|分(?:钟)?后|个?半?小时后)/.test(when);
  const quote = when && (!eventRelativeTime(idea) || eventRelativeTime(when) || precise) ? when : idea;
  return {quote,due:promiseDue(quote,base,proposed)};
}
// A mention of "today" in an intention does not give bedtime a clock time.
export function promiseDue(phrase: string, base: number, proposed?: unknown): number | null {
  if(!phrase.trim() || eventRelativeTime(phrase)) return null;
  const n="[零一二两三四五六七八九十\\d]+";
  const relative = phrase.match(new RegExp("("+n+"|半)(个半|个)?\\s*(分钟|小时|天)(半)?(?:以|之)?后"));
  const amount = relative ? (relative[1] === "半" ? 0.5 : numberCN(relative[1])) +
    (relative[2] === "个半" || relative[4] ? 0.5 : 0) : 0;
  const dayWithHour = relative?.[3] === "天" && /早|晚|下午|中午|[:：点时]/.test(phrase);
  if (relative && !dayWithHour)
    return base + amount * ({分钟:60000, 小时:3600000, 天:86400000}[relative[3]] ?? 0);
  const midnight=Date.parse(dayOf(base)+"T00:00:00+08:00");
  const date=new Date(midnight+8*3600000);
  const weekday=(date.getUTCDay()+6)%7;
  const week=phrase.match(/(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/);
  const iso=phrase.match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})(?:日|号)?/);
  let day: number | undefined = dayWithHour ? midnight + amount * 86400000 : undefined;
  if (iso) {
    const target=Date.UTC(+iso[1],+iso[2]-1,+iso[3]);
    const check=new Date(target);
    if(check.getUTCFullYear()!==+iso[1] || check.getUTCMonth()!==+iso[2]-1 || check.getUTCDate()!==+iso[3]) return null;
    day=target-8*3600000;
  } else if (week) {
    const dow="一二三四五六日".indexOf(week[2].replace("天","日"));
    const offset = week[1]==="下下"?14:week[1]==="下"?7:!week[1]&&dow<weekday?7:0;
    day=midnight+(offset+dow-weekday)*86400000;
  } else if (/大后天|后天|明天|明早|明晚|明日|今天|今晚|今早/.test(phrase)) {
    day=midnight+(/大后天/.test(phrase)?3:/后天/.test(phrase)?2:/明[天早晚日]/.test(phrase)?1:0)*86400000;
  }
  const time=phrase.match(new RegExp("("+n+")(?:[:：时]|点(?!点|儿))(?:(半)|("+n+")(?:分)?)?"));
  const monthDay=phrase.match(/(?<![\d年])(\d{1,2})月(\d{1,2})(?:日|号)/);
  if(day===undefined && monthDay) {
    const month=+monthDay[1]-1,d=+monthDay[2];
    const year=date.getUTCFullYear()+(month<date.getUTCMonth() || (month===date.getUTCMonth() && d<date.getUTCDate())?1:0);
    const target=new Date(Date.UTC(year,month,d));
    if(target.getUTCMonth()!==month || target.getUTCDate()!==d) return null;
    day=target.getTime()-8*3600000;
  }
  if(day===undefined && /周末/.test(phrase)) day=midnight+(/下周末/.test(phrase)?12-weekday:Math.max(0,5-weekday))*86400000;
  if(day===undefined && /月|节|假期|工作日/.test(phrase) && typeof proposed==="string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(proposed)) {
    const value=Date.parse(proposed+":00+08:00");
    if(Number.isFinite(value) && shanghaiDate(value)===proposed && value>=base-86400000) return value;
  }
  if (day!==undefined || time) {
    let hour=time?numberCN(time[1]):/晚|夜/.test(phrase)?20:/下午/.test(phrase)?15:/中午/.test(phrase)?12:9;
    if(time && hour<12 && /下午|晚上|晚间|傍晚|明晚|今晚/.test(phrase)) hour+=12;
    if(time && hour>=1 && hour<=2 && /中午|正午/.test(phrase)) hour+=12;
    if(time && hour>2 && hour<11 && /中午|正午/.test(phrase)) return null;
    if(time && hour===12 && /凌晨|午夜/.test(phrase)) hour=0;
    const minute=time?.[2]?30:time?.[3]?numberCN(time[3]):0;
    if(hour>23||minute>59||hour<0||minute<0) return null;
    if(day===undefined && /月|节|假期|工作日/.test(phrase)) return null;
    const result=(day??midnight)+hour*3600000+minute*60000;
    return day===undefined && result<base ? result+86400000 : result;
  }
  return null;
}

type Reschedule = {id:string; due:number|null; when:string; evidence:string};
type QQPromiseChanges = {create?:Memory; reschedule?:Reschedule[]};

function applyReschedule(scope:string, change:Reschedule) {
  return [
    stmt("UPDATE memories SET due=?,quote=?,evidence=json_insert(evidence,'$[#]',?) WHERE id=? AND scope=? AND kind='promise' AND resolved=0",
      change.due,change.when,change.evidence,change.id,scope),
    stmt("DELETE FROM channel_state WHERE id=?", "promise-check/" + change.id),
    stmt("UPDATE art_jobs SET due=COALESCE(?,due) WHERE scope=? AND promise_id=? AND state IN ('pending','ready')",change.due,scope,change.id),
  ];
}

export async function qqPromiseChanges(messageId:string, confirmed:boolean, scope:string) {
  const key = "qq-promises/" + messageId;
  const saved = await one<{value:string}>("SELECT value FROM channel_state WHERE id=?",key);
  if (!saved) return [];
  const writes = [stmt("DELETE FROM channel_state WHERE id=?",key)];
  if (confirmed) {
    const changes:QQPromiseChanges = JSON.parse(saved.value);
    if (changes.create) {
      writes.push(memory({...changes.create,scope},changes.create.made).write);
      // Painting can finish while QQ is still confirming the original promise.
      const completed=`SELECT j.art,m.id,m.peer,d.state FROM art_jobs j JOIN messages m ON m.id='art-'||j.id
        LEFT JOIN deliveries d ON d.id=m.id WHERE j.scope=? AND j.promise_id=? AND j.state='done' AND m.withheld=0`;
      writes.push(stmt(`WITH finished AS (${completed}) UPDATE memories SET
        closed_by=(SELECT 'chat-out-'||id FROM finished),
        resolved=(SELECT CASE WHEN peer LIKE 'qq-%' AND COALESCE(state,'')<>'sent' THEN 0 ELSE 1 END FROM finished),
        evidence=json_insert(evidence,'$[#]',(SELECT proof.id FROM finished f JOIN memories proof ON proof.source='/picture/'||f.art WHERE proof.scope=? AND proof.hidden=0 LIMIT 1))
        WHERE id=? AND scope=? AND hidden=0 AND resolved=0 AND EXISTS(SELECT 1 FROM finished WHERE peer NOT LIKE 'qq-%' OR state IS NULL OR state IN ('sending','retry','sent'))`,
        scope,changes.create.id,scope,changes.create.id,scope));
    }
    for (const change of changes.reschedule ?? []) writes.push(...applyReschedule(scope,change));
  }
  return writes;
}

export function commitmentWrites(scope:string, response:any, active:Memory[], incoming:SourceLine[], outgoing:SourceLine[], now:number, actionEvidence:Memory[],drawingJob?:string) {
  const writes:D1PreparedStatement[]=[];
  const staged = new Map<string,QQPromiseChanges>();
  function forReceipt(line:SourceLine) {
    if (line.side !== "out" || !line.peer?.startsWith("qq-")) return;
    const changes = staged.get(line.id) ?? {};
    staged.set(line.id,changes);
    return changes;
  }
  for (const update of Array.isArray(response.promiseUpdates)?response.promiseUpdates.slice(0,6):[]) {
    if (!active.some(p=>p.id===update?.id) || !["complete","cancel","reschedule"].includes(update.status)) continue;
    const quote=text(update.quote,400);
    if(!quote) continue;
    const source = [...incoming,...outgoing].find(l=>l.body.includes(quote));
    const action = actionEvidence.find(m=>m.id===update.actionId && m.kind==="drawing" && m.scope===scope);
    if (!source && !action) continue;
    const evidence=source ? (source.side==="in"?"chat-in-":"chat-out-")+source.id : action!.id;
    if(update.status==="reschedule") {
      const when=text(update.when,120);
      if(!source || !when || !source.body.includes(when)) continue;
      const change = {id:update.id,due:promiseDue(when,source.made,update.dueLocal),when,evidence};
      const pending = forReceipt(source);
      if (pending) (pending.reschedule ??= []).push(change);
      else writes.push(...applyReschedule(scope,change));
    } else {
      if(update.status==="cancel" && source?.side!=="in") continue;
      if(update.status==="complete" && source?.side==="out" && !action &&
          /(?:我会|我打算|我准备|我之后|等我|稍后再|待会儿再)/.test(quote)) continue;
      const promise=active.find(p=>p.id===update.id)!;
      if(update.status==="complete" && source?.side==="out" && /画[一张幅个]|绘制|画.*(?:头像|表情|插画)/.test(promise.body) &&
          !actionEvidence.some(m=>m.kind==="drawing" && m.scope===scope)) continue;
      const pendingQQ=source?.side==="out" && source.peer?.startsWith("qq-");
      writes.push(stmt("UPDATE memories SET resolved=?,closed_by=? WHERE id=? AND scope=? AND kind='promise' AND resolved=0",
        update.status==="complete"?(pendingQQ?0:1):2,evidence,update.id,scope));
      if(update.status==="cancel") writes.push(
        stmt("UPDATE art_jobs SET state='cancelled',lease=NULL WHERE promise_id=? AND scope=? AND state IN ('pending','running','paused','ready')",update.id,scope),
        stmt(`UPDATE messages SET withheld=1 WHERE id IN (SELECT 'art-'||j.id FROM art_jobs j WHERE j.promise_id=? AND j.scope=?)
          AND peer LIKE 'qq-%' AND NOT EXISTS(SELECT 1 FROM deliveries d WHERE d.id=messages.id AND d.state='sent')`,update.id,scope));
    }
  }
  const p = response.promise;
  const body = text(p?.what,400), quote = text(p?.quote,400), when = text(p?.when,120);
  const sent = outgoing.find(l => quote && l.body.includes(quote));
  if (body && sent && !active.some(m=>m.body===body)) {
    const timeLine = when && [...incoming,...outgoing].find(l=>l.body.includes(when));
    const ids = ["chat-out-"+sent.id];
    if (timeLine) ids.push((timeLine.side==="in"?"chat-in-":"chat-out-")+timeLine.id);
    const promise = memory({scope,kind:"promise",body,topic:"schedule",quote:timeLine?when:null,
      due:timeLine?promiseDue(when,timeLine.made,p.dueLocal):null,evidence:JSON.stringify([...new Set(ids)])},now);
    if(drawingJob && /画|绘|头像|插图/.test(body))
      writes.push(stmt("UPDATE art_jobs SET promise_id=? WHERE id=? AND scope=? AND promise_id IS NULL",promise.row.id,drawingJob,scope));
    const pending = forReceipt(sent);
    if (pending) pending.create = promise.row;
    else writes.push(promise.write);
  }
  for (const [id,changes] of staged)
    writes.push(stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)","qq-promises/"+id,JSON.stringify(changes)));
  return writes;
}
