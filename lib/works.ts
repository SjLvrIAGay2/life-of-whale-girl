import { all, memory, one, stmt, type Memory } from "../db";

export type Work = {id:string;scope:string;title:string;kind:string;state:string;made:number;updated:number;next:string};
export type WorkStep = {id:string;made:number;body:string;evidence:string|null;art:string|null;url:string|null;level:string|null};
const short=(v:unknown,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
// A reading attached to a work refers back to the activity, so changing its visibility also retracts that step.
export const visibleWorkSteps = `(SELECT s.rowid AS position,s.* FROM work_steps s
  WHERE s.url IS NULL OR s.url NOT LIKE '/activity/%' OR EXISTS
    (SELECT 1 FROM activities a, resident r WHERE r.id='whale' AND a.id=substr(s.url,11)
      AND a.visibility='detail' AND COALESCE(json_extract(r.state,'$.sharing'),'detail')='detail'))`;
export function attachReading(work: string, activity: string, now: number, next?: string) {
  return [
    stmt(`INSERT OR IGNORE INTO work_steps(id,work,made,body,url,level)
      SELECT ?,id,?,'留下了这次阅读进度。',?,'reading' FROM works WHERE id=? AND scope='public' AND state='active'`,
      "reading-"+activity, now, "/activity/"+activity, work),
    stmt("UPDATE works SET updated=?,next=COALESCE(?,next) WHERE id=? AND scope='public' AND state='active'",
      now, typeof next==="string"?short(next,240):null, work),
  ];
}
export async function workList(scope:string, limit=8, offset=0) {
  const rows=await all<Work>("SELECT * FROM works WHERE scope=? AND state<>'hidden' ORDER BY state='active' DESC,updated DESC,id LIMIT ? OFFSET ?",scope,limit,offset);
  return Promise.all(rows.map(async row=>({
    id:row.id,title:row.title,kind:row.kind,state:row.state,made:row.made,updated:row.updated,next:row.next,
    ...(row.kind==="drawing"?{drawingState:(await one<{state:string}>("SELECT state FROM art_jobs WHERE work=? AND scope=? ORDER BY made DESC,rowid DESC LIMIT 1",row.id,scope))?.state}:{}),
    steps:await all<WorkStep & {position:number}>(`SELECT position,id,made,substr(body,1,280) AS body,evidence,art,url,level FROM ${visibleWorkSteps} WHERE work=? ORDER BY made DESC,position DESC LIMIT 8`,row.id),
  })));
}
export async function workHistory(scope:string,id:string,before=Number.MAX_SAFE_INTEGER,limit=32) {
  return all<WorkStep & {position:number}>(`SELECT s.* FROM ${visibleWorkSteps} s JOIN works w ON w.id=s.work
    WHERE w.scope=? AND w.id=? AND w.state<>'hidden' AND s.position<? ORDER BY s.position DESC LIMIT ?`,scope,id,before,limit);
}

// The archive includes older pictures that predate works. A picture inside a hidden work
// must never reappear as an independent picture.
const ownArchive = `WITH archive AS (
  SELECT w.id,w.scope,w.title,w.kind,w.state,w.updated,w.next,j.id AS job,j.state AS jobState,d.id AS art,d.title AS artTitle,0 AS loose
  FROM works w LEFT JOIN art_jobs j ON j.id=(
    SELECT a.id FROM art_jobs a WHERE a.work=w.id AND a.scope=w.scope AND a.peer IS NULL ORDER BY a.made DESC,a.rowid DESC LIMIT 1)
  LEFT JOIN drawings d ON d.id=j.art AND d.scope=w.scope
  WHERE w.scope IN ('public','self') AND w.state<>'hidden'
  UNION ALL
  SELECT 'picture/'||d.id,d.scope,d.title,'drawing','done',d.made,'',NULL,NULL,d.id,d.title,1
  FROM drawings d WHERE d.scope IN ('public','self')
    AND NOT EXISTS(SELECT 1 FROM work_steps s JOIN works sw ON sw.id=s.work WHERE s.art=d.id AND
      (sw.state='hidden' OR sw.scope=d.scope OR s.level<>'reference'))
    AND NOT EXISTS(SELECT 1 FROM art_jobs j WHERE j.art=d.id)
    AND NOT EXISTS(SELECT 1 FROM memories m WHERE m.source='/picture/'||d.id AND m.scope=d.scope AND m.hidden=1)
)`;
type ArchiveRow = Pick<Work,"id"|"scope"|"title"|"kind"|"state"|"updated"|"next"> &
  {job:string|null;jobState:string|null;art:string|null;artTitle:string|null;loose:number};

export async function deskWorks(since:number, focus?:string) {
  const rows=await all<ArchiveRow & {latest:string|null}>(ownArchive+`
    SELECT a.*,(SELECT substr(s.body,1,180) FROM ${visibleWorkSteps} s WHERE s.work=a.id ORDER BY s.made DESC,s.position DESC LIMIT 1) AS latest
    FROM archive a WHERE id=? OR state='active' OR updated>=?
    ORDER BY id=? DESC,updated>=? DESC,updated DESC,id LIMIT 8`,focus??"",since,focus??"",since);
  return rows.map(({id,scope,title,kind,state,next,job,jobState,art,artTitle,latest})=>({
    id,scope,title,kind,state,next:next||undefined,latest:latest && latest!==artTitle?latest:undefined,
    drawing:job||art?{job,state:jobState,art,title:artTitle}:undefined,
  }));
}

export async function browseOwnWorks(query:string,offset:number) {
  const rows=await all<Pick<ArchiveRow,"id"|"scope"|"kind"|"state"|"title"|"artTitle">>(ownArchive+`
    SELECT id,scope,kind,state,title,artTitle FROM archive WHERE
    instr(lower(title||' '||coalesce(artTitle,'')),lower(?))>0 ORDER BY updated DESC,id LIMIT 9 OFFSET ?`,query,offset);
  return {items:rows.slice(0,8),nextOffset:rows.length>8?offset+8:undefined};
}

export function findOwnWork(id:string) {
  return one<ArchiveRow>(ownArchive+" SELECT * FROM archive WHERE id=?",id);
}
export function artForConversation(scope:string,peers:string[],cue:string,memories:Memory[]) {
  const terms=[...new Set((cue.slice(0,420).toLowerCase().match(/[\p{Script=Han}]{2,}|[a-z\d]{3,}/gu)??[])
    .flatMap(word=>word.length<3?[word]:[word,...Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2))]))].slice(0,100);
  const records=JSON.stringify(memories.map(m=>m.id));
  return all<{id:string;title:string;series:string|null;lastUse:string|null}>(`WITH RECURSIVE sources(id) AS (
    SELECT value FROM json_each(?) UNION SELECT e.value FROM sources s JOIN memories m ON m.id=s.id
      JOIN json_each(m.evidence) e WHERE m.hidden=0 AND m.scope IN ('public',?)),
    candidates AS (SELECT d.id,d.made,d.title,w.title AS series,j.idea,
      (SELECT substr(m.body,1,120) FROM messages m WHERE m.art=d.id AND m.withheld=0
       AND m.peer IN (SELECT value FROM json_each(?)) ORDER BY m.made DESC LIMIT 1) AS lastUse,
      EXISTS(SELECT 1 FROM sources s JOIN memories m ON m.id=s.id WHERE m.hidden=0 AND m.scope IN ('public',?) AND m.source='/picture/'||d.id)
        OR ('chat-in-'||j.origin) IN (SELECT id FROM sources) AS linked
      FROM drawings d LEFT JOIN art_jobs j ON j.art=d.id LEFT JOIN works w ON w.id=j.work AND w.state<>'hidden'
      WHERE d.scope IN ('public',?) AND NOT EXISTS(SELECT 1 FROM memories h WHERE h.source='/picture/'||d.id AND h.hidden=1)
      AND NOT EXISTS(SELECT 1 FROM work_steps s JOIN works w ON w.id=s.work WHERE s.art=d.id AND w.state='hidden'))
    SELECT id,title,series,lastUse FROM candidates ORDER BY COALESCE(linked,0) DESC,
      (SELECT count(*) FROM json_each(?) term WHERE instr(lower(title||ifnull(series,'')||ifnull(idea,'')||ifnull(lastUse,'')),term.value)>0) DESC,
      made DESC,id LIMIT 16`,records,scope,JSON.stringify(peers),scope,scope,JSON.stringify(terms));
}
export function newWork(scope:string, title:string, kind:string, next:string, now:number, id=crypto.randomUUID() as string) {
  return {id,write:stmt("INSERT OR IGNORE INTO works(id,scope,title,kind,state,made,updated,next) VALUES(?,?,?,?,'active',?,?,?)",
    id,scope,short(title,100),kind,now,now,short(next,240))};
}
export function workStep(work:string,scope:string,now:number,body:string,source:Partial<WorkStep>={},id=crypto.randomUUID() as string) {
  return stmt(`INSERT OR IGNORE INTO work_steps(id,work,made,body,evidence,art,url,level)
    SELECT ?,id,?,?,?,?,?,? FROM works WHERE id=? AND scope=? AND state<>'hidden'
    AND (? IS NULL OR EXISTS(SELECT 1 FROM memories m WHERE m.id=? AND m.hidden=0 AND m.scope IN ('public',?)))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM drawings d WHERE d.id=? AND d.scope IN ('public',?)))`,
    id,now,short(body,1800),source.evidence??null,source.art??null,source.url??null,source.level??null,work,scope,
    source.evidence??null,source.evidence??null,scope,source.art??null,source.art??null,scope);
}
function skippedWork(summary:string, ref?:string) {
  return {writes:[], status:"skipped" as const, summary, ref};
}
function manuscriptStep(work:Pick<Work,"id"|"scope"|"title">,draft:string,finished:boolean,now:number,origins:string[]) {
  const version=memory({scope:work.scope,kind:"manuscript",topic:work.title,evidence:JSON.stringify(origins),
    body:"《"+work.title+"》"+(finished?"完稿":"新稿")+"\n"+draft},now);
  return {id:version.row.id,writes:[version.write,workStep(work.id,work.scope,now,draft,{level:"draft",evidence:version.row.id})]};
}

export async function prepareWorkEdit(scope:string, raw:any, now:number, newEvidence:Memory[]=[], origins:string[]=[]) {
  if(!raw || typeof raw.action!=="string") return skippedWork("没有收到要做的作品操作（work.action）。");
  const title=short(raw.title,100), next=short(raw.next,240);
  const draft=short(raw.draft,1800);
  if(raw.action==="start") {
    if(!title) return skippedWork("新作品缺少标题（work.title）。");
    const request=typeof raw.request==="string" && /^[a-f0-9-]{36}$/i.test(raw.request)?raw.request:"";
    const work=newWork(scope,title,["reading","drawing","writing"].includes(raw.kind)?raw.kind:"writing",next,now,
      request?scope+"/work/"+request:undefined);
    if(request && !origins.length && await one("SELECT 1 FROM works WHERE id=?",work.id))
      return skippedWork("这件作品已经建过了。",work.id);
    const writes=[work.write];
    if(origins.length) {
      const intent=memory({id:"intent-"+work.id,scope,kind:"work_intent",body:next||title,evidence:JSON.stringify(origins)},now);
      writes.push(intent.write,workStep(work.id,scope,now,next||title,{level:"intention",evidence:intent.row.id},"start-"+work.id));
    }
    const firstDraft=draft && (!raw.kind || raw.kind==="writing") ? manuscriptStep({id:work.id,scope,title},draft,false,now,origins) : undefined;
    if(firstDraft) writes.push(...firstDraft.writes);
    return {writes,status:"started" as const,ref:work.id,manuscript:firstDraft?.id,summary:"新建了作品《"+title+"》"+(firstDraft?"并保存了第一稿。":"。")};
  }
  if(!["advance","finish","shelve","resume"].includes(raw.action)) return skippedWork("无法识别这个作品操作（work.action）。");
  const id=short(raw.id,100);
  if(!id) return skippedWork("没有给出要修改的作品编号（work.id）。");
  const work=await one<Work>("SELECT * FROM works WHERE scope=? AND id=? AND state<>'hidden'",scope,id);
  if(!work) return skippedWork("在这里找不到与这个编号对应的作品（work.id）。");
  if((raw.action==="advance" || raw.action==="finish") && work.state!=="active")
    return skippedWork("《"+work.title+"》"+(work.state==="shelved"?"已搁置":"已结束")+"，本次没有添加进度。",id);
  const writes=[];
  let state=work.state;
  let manuscript:string|undefined;
  if(raw.action==="shelve") state="shelved";
  else if(raw.action==="resume") state="active";
  else {
    const evidenceId=short(raw.evidence,180);
    let evidence=newEvidence.find(m=>m.id===evidenceId) ?? await one<Memory>("SELECT * FROM memories WHERE id=? AND scope IN ('public',?) AND hidden=0",evidenceId,scope);
    if(work.kind==="drawing" && raw.action==="finish") {
      evidence=await one<Memory>(`SELECT m.* FROM memories m JOIN drawings d ON m.source='/picture/'||d.id AND m.scope=d.scope
        WHERE m.kind='drawing' AND m.hidden=0 AND m.scope IN ('public',?) AND (?='' OR m.id=?)
        AND (EXISTS(SELECT 1 FROM work_steps s WHERE s.work=? AND s.art=d.id)
          OR EXISTS(SELECT 1 FROM art_jobs j WHERE j.work=? AND j.art=d.id))
        ORDER BY m.made DESC LIMIT 1`,scope,evidenceId,evidenceId,work.id,work.id);
      if(!evidence) return skippedWork(evidenceId?"这条记录无法核实《"+work.title+"》已成图。":"《"+work.title+"》还没有已保存的成图。",id);
    }
    if(draft && work.kind==="writing") {
      const version=manuscriptStep(work,draft,raw.action==="finish",now,origins);
      writes.push(...version.writes);
      manuscript=version.id;
    }
    else if(work.kind==="writing" && raw.action==="finish" && evidence?.kind==="manuscript" &&
      await one("SELECT 1 FROM work_steps WHERE work=? AND level='draft' AND evidence=?",work.id,evidence.id))
      manuscript=evidence.id;
    else if(evidence && ["observation","drawing","episode","event"].includes(evidence.kind))
      writes.push(workStep(work.id,scope,now,evidence.body,{evidence:evidence.id,
        url:evidence.source.startsWith("https://")?evidence.source:null,
        art:evidence.kind==="drawing"?evidence.source.split("/").pop():null,level:evidence.category??evidence.kind}));
    else {
      if(evidenceId && !evidence) return skippedWork("找不到所引用的进度记录（work.evidence）。",id);
      if(evidence?.kind==="day_plan" || evidence?.kind==="promise")
        return skippedWork("这条记录写的是打算，《"+work.title+"》还没有增加实际进度。",id);
      if(evidence) return skippedWork("所引用的记录没有可归入《"+work.title+"》的作品进展。",id);
      if(work.kind==="drawing" && draft)
        return skippedWork("这次收到的是文字草稿。《"+work.title+"》没有新增画面，也没有画稿入队。",id);
      return skippedWork(work.kind==="writing"?"这次没有收到新稿（work.draft）或进度记录（work.evidence）。":
        "这次没有附上可登记进展的记录（work.evidence）。",id);
    }
    state=raw.action==="finish"?"done":"active";
  }
  if(state==="shelved") writes.push(stmt("UPDATE art_jobs SET state='paused',lease=NULL WHERE work=? AND scope=? AND state IN ('pending','running')",work.id,scope));
  if(raw.action==="resume") writes.push(stmt("UPDATE art_jobs SET state='pending',due=? WHERE work=? AND scope=? AND state='paused'",now,work.id,scope));
  writes.push(stmt("UPDATE works SET updated=?,state=?,next=? WHERE id=? AND scope=? AND state<>'hidden'",now,state,
    raw.action==="finish"?"":typeof raw.next==="string"?next:work.next,work.id,scope));
  const change=raw.action==="finish"?"已完成":raw.action==="advance"?"已记下新进展":raw.action==="shelve"?"已搁置":"已恢复进行";
  return {writes,status:"done" as const,ref:work.id,manuscript,summary:"《"+work.title+"》"+change+"。"};
}

export async function editWork(scope:string, raw:unknown, now:number, newEvidence:Memory[]=[], origins:string[]=[]) {
  return (await prepareWorkEdit(scope,raw,now,newEvidence,origins)).writes;
}

export async function publicRoom() {
  const [works, dream, plans]=await Promise.all([
    Promise.all([workList("public",8),one<Work>("SELECT * FROM works WHERE scope='public' AND state='done' ORDER BY updated DESC LIMIT 1")]).then(async ([works,done])=>{
      if(done && !works.some(w=>w.id===done.id)) works.push({...done,steps:await workHistory("public",done.id).then(s=>s.slice(0,8))});
      return works;
    }),
    one<{body:string;made:number}>("SELECT body,made FROM memories WHERE scope='public' AND kind='shared_dream' ORDER BY made DESC LIMIT 1"),
    all<{body:string;category:string;made:number;reason:string|null}>("SELECT body,category,made,json_extract(details,'$.reason') AS reason FROM memories WHERE scope='public' AND kind='day_plan' AND topic=? ORDER BY made LIMIT 5",
      new Date(Date.now()+8*3600000).toISOString().slice(0,10)),
  ]);
  return {works,dream,plans};
}
export async function artProcess(scope:string,id:string) {
  const work=await one<{id:string;title:string}>(`SELECT w.id,w.title FROM work_steps s JOIN works w ON w.id=s.work
    JOIN drawings d ON d.id=s.art WHERE s.art=? AND w.scope=? AND d.scope=? AND w.state<>'hidden' LIMIT 1`,id,scope,scope);
  if(!work) return null;
  const steps=await workHistory(scope,work.id);
  const posts=scope==="public"?await all<{day:string}>(`SELECT day FROM daily_posts p WHERE EXISTS(SELECT 1 FROM json_each(p.evidence) e JOIN work_steps s ON s.evidence=e.value WHERE s.work=?) ORDER BY day DESC LIMIT 8`,work.id):[];
  return {...work,steps,days:posts.map(p=>p.day)};
}
