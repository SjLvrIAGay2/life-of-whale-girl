import { numbers } from "../config/numbers.ts";
import type { Overrides } from "../config/options.ts";
import { all } from "../db";
import { readingOutcome, type Reading } from "../content/activity";
import type { ReadRequest } from "./media";

// Visits are the source of truth. A bookmark on an account list describes that account's history.
// Only the resident's own attempts at a particular item contribute to these counts and positions.
const source = "json_extract(detail,'$.detail.source')";
const target = "coalesce(json_extract(detail,'$.readingTarget'),json_extract(detail,'$.detail.items[0].id'))";
const focused = `json_extract(detail,'$.detail.kind')='reading' AND
  json_extract(detail,'$.detail.action') IN ('open','subtitles','frames','comments','image')`;

type Target = { source: ReadRequest["source"]; id: string };
type Stage = {
  action:string; page?:number; root?:string; attempts:number;
  lastAttempt:{at:number; status:string; result:string; offset?:number; nextPage?:number; atEnd?:boolean};
  lastRead?:{at:number; level:string; change:string; timesWithSameContent:number; position?:ReturnType<typeof position>; excerpt?:string};
};

export function unreadTitles(sourceName:string, items:{id:string;title:string}[]) {
  return all<{id:string;title:string}>(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.title') AS title FROM json_each(?) c
    WHERE NOT EXISTS(SELECT 1 FROM activities WHERE ${focused} AND ${source}=? AND ${target}=json_extract(c.value,'$.id')
      AND coalesce(json_extract(detail,'$.detail.status'),'ok')='ok')
    AND json_extract(c.value,'$.id') NOT IN (SELECT json_extract(b.value,'$.id') FROM channel_state b
      WHERE b.id GLOB 'reading-progress/*' AND json_extract(b.value,'$.source')=? AND json_type(b.value,'$.id')='text'
      AND (json_extract(b.value,'$.status')='ok' OR (json_type(b.value,'$.status') IS NULL AND
        (json_extract(b.value,'$.action')='open' OR json_extract(b.value,'$.level') IN ('subtitles','storyboard_viewed'))))
      AND json_extract(b.value,'$.action') IN ('open','subtitles','frames','comments','image'))
    ORDER BY c.key`,JSON.stringify(items),sourceName,sourceName);
}
type Visit = {
  made: number; detail: string; attempts: number; identical: number; newest: number; change:string;
};

function position(read: Reading) {
  if (read.level==="article") return {fromOffset:read.offset??0,nextOffset:read.nextOffset,atEnd:read.atEnd};
  if (read.level === "subtitles") {
    const body=read.items[0]?.body??"";
    const times = [...body.matchAll(/^(\d+)s /gm)];
    // The old reader cut the last line at 3400 characters. Keep that line available on resumption.
    const complete = times.length - Number(body.length === 3400);
    return { fromOffset:read.offset ?? 0, nextOffset:read.nextOffset ?? (complete>0 ? (read.offset??0)+complete : undefined),
      lastCueSeconds:times.length ? Number(times.at(-1)![1]) : undefined, atEnd:read.atEnd };
  }
  if (read.level === "storyboard_viewed")
    return { fromOffset:read.offset ?? 0, nextOffset:read.nextOffset ?? (read.offset??0)+1, atEnd:read.atEnd };
  if (read.comments?.length) return { comments:read.comments.length, lastComment:read.comments.at(-1)?.id };
}

// Displayed excerpts follow the latest visit. Continuations follow the furthest successful
// position, even after a deliberate reread or after the excerpt has fallen out of the recent stages.
async function readingPaths(item:Target, requestedPart?:number, retry=false) {
  const rows=await all<{reading:string; part:number; latest:number; furthest:number; endOffset:number|null}>(`WITH visits AS (
    SELECT rowid AS seq,made,json_extract(detail,'$.detail') AS reading,json_extract(detail,'$.detail.action') AS op,
      coalesce(json_extract(detail,'$.detail.page'),1) AS page,coalesce(json_extract(detail,'$.detail.offset'),0) AS offset,
      coalesce(json_extract(detail,'$.detail.status'),'ok') AS status
    FROM activities WHERE ${focused} AND ${source}=? AND ${target}=? AND json_extract(detail,'$.detail.root') IS NULL
  ), selected AS (
    SELECT coalesce(?,(SELECT page FROM visits WHERE op IN ('open','frames','subtitles') ORDER BY made DESC,seq DESC LIMIT 1),1) AS part
  ), ranked AS (
    SELECT reading,part,status,
      min(CASE WHEN status IN ('end_of_article','end_of_frames','end_of_subtitles') THEN offset END) OVER(PARTITION BY op) AS endOffset,
      row_number() OVER(PARTITION BY op ORDER BY made DESC,seq DESC) AS latest,
      row_number() OVER(PARTITION BY op ORDER BY (status='ok') DESC,
        CASE WHEN op='comments' THEN page ELSE coalesce(json_extract(reading,'$.nextOffset'),offset) END DESC,
        coalesce(json_extract(reading,'$.atEnd'),0) DESC,made DESC,seq DESC) AS furthest
    FROM visits,selected WHERE op='comments' OR page=part OR (?='heybox' AND op='open')
  ) SELECT * FROM ranked WHERE latest=1 OR (furthest=1 AND status='ok')`,item.source,item.id,requestedPart??null,item.source);
  const attempts=new Map<string,Reading>(), progress=new Map<string,Reading>();
  const ends=new Map<string,number>();
  for (const row of rows) {
    const read:Reading=JSON.parse(row.reading);
    if (row.latest===1) attempts.set(read.action,read);
    if (row.furthest===1 && (!read.status || read.status==="ok")) progress.set(read.action,read);
    if (row.endOffset!==null) ends.set(read.action,row.endOffset);
  }
  const part=rows[0]?.part??requestedPart??1;
  const paths:ReadRequest[]=[];
  const operations:ReadRequest["action"][]=item.source==="bili" ? ["frames","subtitles","comments"] : ["open","comments"];
  for (const action of operations) {
    const best=progress.get(action), last=attempts.get(action);
    if (best?.atEnd) continue;
    const path:ReadRequest={...item,action};
    if (action==="comments") {
      path.page=best ? best.nextPage??(best.page??1)+1 : 1;
      if (last?.nextPage && last.page===path.page) path.page=last.nextPage;
      if (path.page>numbers.defaults.mediaPageMax) continue;
    } else {
      if (item.source==="bili") path.page=part;
      const next=best ? position(best)?.nextOffset : 0;
      if (next==null || (best && next<=(best.offset??0))) continue;
      const end=ends.get(action);
      if (end!==undefined && next>=end && (!best || (best.offset??0)<end)) continue;
      path.offset=next;
    }
    // Keep a failed position available for an intentional retry, without offering it again on every turn.
    if (!retry && last?.status && last.status!=="ok" && (["no_frames","no_subtitles","part_not_found","needs_login"].includes(last.status) ||
      ((path.page??1)===(last.page??1) && (path.offset??0)===(last.offset??0)))) continue;
    paths.push(path);
  }
  const hasContent=[...progress.values()].some(read=>["article","subtitles","storyboard_viewed","filtered_comments","discussion"].includes(read.level));
  return {paths,hasContent};
}

export async function resumeRead(request:ReadRequest):Promise<ReadRequest|undefined> {
  const paged=request.action==="comments";
  const segmented=request.source==="bili" ? request.action==="frames" || request.action==="subtitles" : request.action==="open";
  if (!request.id || request.root || (!paged && !segmented) || (paged ? request.page!==undefined : request.offset!==undefined)) return request;
  const {paths}=await readingPaths({source:request.source,id:request.id},request.page,true);
  const next=paths.find(path=>path.action===request.action);
  return next && {...request,...next};
}

async function materialProgress(item: Target, n:typeof numbers.defaults, offerPaths:boolean, part?:number) {
  const rows = await all<Visit>(`WITH visits AS (
    SELECT rowid AS seq,made,detail,json_extract(detail,'$.detail.action') AS op,
      coalesce(json_extract(detail,'$.detail.page'),1) AS page,coalesce(json_extract(detail,'$.detail.root'),'') AS thread,
      coalesce(json_extract(detail,'$.detail.status'),'ok') AS status,
      json_array(json_extract(detail,'$.detail.level'),coalesce(json_extract(detail,'$.detail.offset'),0),
        json_extract(detail,'$.detail.items'),json_extract(detail,'$.detail.comments')) AS content
    FROM activities WHERE ${focused} AND ${source}=? AND ${target}=?
  ), ranked AS (
    SELECT *, count(*) OVER stage AS attempts, count(*) OVER (PARTITION BY op,page,thread,status,content) AS identical,
      row_number() OVER (stage ORDER BY made DESC,seq DESC) AS newest,
      lag(content) OVER (PARTITION BY op,page,thread,(status='ok') ORDER BY made,seq) AS previousContent,
      row_number() OVER (PARTITION BY op,page,thread,(status='ok') ORDER BY made DESC,seq DESC) AS lastResult
    FROM visits WINDOW stage AS (PARTITION BY op,page,thread)
  ) SELECT made,detail,attempts,identical,newest,CASE WHEN previousContent IS NULL THEN '首次读到'
      WHEN previousContent=content THEN '和上次相同' WHEN identical>1 THEN '重读以前的内容' ELSE '读到新内容' END AS change FROM ranked
    WHERE newest=1 OR (status='ok' AND lastResult=1) ORDER BY made DESC,seq DESC LIMIT ?`,item.source,item.id,n.readingStageRows);
  const stages = new Map<string,Stage>();
  let title: string | undefined;
  for (const row of rows) {
    const read:Reading = JSON.parse(row.detail).detail;
    title ||= read.items[0]?.title;
    const key = JSON.stringify([read.action,read.page??1,read.root??""]);
    if (row.newest===1) stages.set(key,{action:read.action,page:read.page,root:read.root,attempts:row.attempts,
      lastAttempt:{at:row.made,status:read.status??"ok",result:readingOutcome(read),offset:read.offset,nextPage:read.nextPage,atEnd:read.atEnd}});
    const stage = stages.get(key);
    if (stage && (!read.status || read.status==="ok")) {
      const body=read.items[0]?.body;
      const excerpt=read.comments?.length ? read.comments[0].text.slice(0,n.commentExcerptChars) :
        read.level==="subtitles" ? body?.split("\n").slice(-n.subtitleExcerptLines).join("\n").slice(0,n.subtitleExcerptChars) : body?.slice(0,n.readingExcerptChars);
      stage.lastRead={at:row.made,level:read.level,change:row.change,timesWithSameContent:row.identical,position:position(read),excerpt:excerpt||undefined};
    }
  }
  const seen=[...stages.values()];
  const continuation=offerPaths && seen.length ? await readingPaths(item,part) : {paths:[],hasContent:undefined};
  return {...item,title,stages:seen,...continuation};
}

export async function personalReading(question?:{source?:Target["source"];id?:string;page?:number}, overrides?:Overrides) {
  const n=numbers.read(overrides);
  const targets = await all<Target>(`SELECT ${source} AS source,${target} AS id FROM activities
    WHERE ${focused} AND ${source} IN ('bili','heybox') AND ${target} IS NOT NULL GROUP BY ${source},${target} ORDER BY max(rowid) DESC LIMIT ?`,n.readingMaterials);
  const focus=(question?.source==="bili" || question?.source==="heybox") && question.id ? {source:question.source,id:question.id} : undefined;
  const isFocus=(item:Target)=>focus?.source===item.source && focus.id===item.id;
  const materials=focus ? [focus,...targets.filter(item=>!isFocus(item))].slice(0,n.readingMaterials) : targets;
  return Promise.all(materials.map(item=>{
    const pinned=isFocus(item);
    return materialProgress(item,n,pinned || item===targets[0],pinned?question?.page:undefined);
  }));
}
