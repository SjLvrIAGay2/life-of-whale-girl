import { all } from "../db";
import { readingOutcome, type Reading } from "../content/activity";
import type { ReadRequest } from "./media";

// Visits are the source of truth. A bookmark on an account list describes that account's history.
// Only the resident's own attempts at a particular item contribute to these counts and positions.
const source = "json_extract(detail,'$.detail.source')";
const target = "coalesce(json_extract(detail,'$.readingTarget'),json_extract(detail,'$.detail.items[0].id'))";
const focused = `json_extract(detail,'$.detail.kind')='reading' AND
  json_extract(detail,'$.detail.action') IN ('open','subtitles','frames','comments','image')`;

type Target = { source: Reading["source"]; id: string };
type Stage = {
  action:string; page?:number; root?:string; attempts:number;
  lastAttempt:{at:number; status:string; result:string; offset?:number};
  lastRead?:{at:number; level:string; change:string; timesWithSameContent:number; position?:ReturnType<typeof position>; excerpt?:string};
};

export function unreadTitles(sourceName:string, items:{id:string;title:string}[]) {
  return all<{id:string;title:string}>(`SELECT json_extract(c.value,'$.id') AS id,json_extract(c.value,'$.title') AS title FROM json_each(?) c
    WHERE NOT EXISTS(SELECT 1 FROM activities WHERE ${focused} AND ${source}=? AND ${target}=json_extract(c.value,'$.id')
      AND coalesce(json_extract(detail,'$.detail.status'),'ok')='ok') ORDER BY c.key`,JSON.stringify(items),sourceName);
}
type Visit = {
  made: number; detail: string; attempts: number; identical: number; newest: number; change:string;
};

function position(read: Reading) {
  if (read.level === "subtitles") {
    const times = [...(read.items[0]?.body ?? "").matchAll(/^(\d+)s /gm)];
    // The old reader cut the last line at 3400 characters. Keep that line available on resumption.
    const complete = times.length - Number(read.items[0]?.body.length === 3400);
    return { fromOffset:read.offset ?? 0, nextOffset:read.nextOffset ?? (complete>0 ? (read.offset??0)+complete : undefined),
      lastCueSeconds:times.length ? Number(times.at(-1)![1]) : undefined, atEnd:read.atEnd };
  }
  if (read.level === "storyboard_viewed")
    return { fromOffset:read.offset ?? 0, nextOffset:read.nextOffset ?? (read.offset??0)+1, atEnd:read.atEnd };
  if (read.comments?.length) return { comments:read.comments.length, lastComment:read.comments.at(-1)?.id };
}

function readingPaths(item:Target, stages:Stage[], part:number):ReadRequest[] {
  const actions:ReadRequest[]=[];
  if(item.source==="bili") {
    for(const action of ["frames","subtitles"] as const) {
      const stage=stages.find(s=>s.action===action && (s.page??1)===part);
      const pos=stage?.lastRead?.position;
      if (pos?.atEnd || ["no_frames","no_subtitles","end_of_frames","end_of_subtitles","part_not_found","needs_login"].includes(stage?.lastAttempt.status??"")) continue;
      actions.push({...item,action,page:part,offset:pos?.nextOffset??0});
    }
  }
  if(item.source==="bili" || item.source==="heybox") {
    const last=stages.find(s=>s.action==="comments" && !s.root);
    if(!last || last.lastAttempt.status==="ok" && item.source==="bili" && (last.page??1)<10000)
      actions.push({...item,action:"comments",page:last?(last.page??1)+1:1});
  }
  if(["museum","nasa"].includes(item.source) && !stages.some(s=>s.action==="image")) actions.push({...item,action:"image"});
  return actions;
}

async function materialProgress(item: Target, part?:number) {
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
    WHERE newest=1 OR (status='ok' AND lastResult=1) ORDER BY made DESC,seq DESC LIMIT 12`,item.source,item.id);
  const stages = new Map<string,Stage>();
  let title: string | undefined;
  for (const row of rows) {
    const read:Reading = JSON.parse(row.detail).detail;
    title ||= read.items[0]?.title;
    const key = JSON.stringify([read.action,read.page??1,read.root??""]);
    if (row.newest===1) stages.set(key,{action:read.action,page:read.page,root:read.root,attempts:row.attempts,
      lastAttempt:{at:row.made,status:read.status??"ok",result:readingOutcome(read),offset:read.offset}});
    const stage = stages.get(key);
    if (stage && (!read.status || read.status==="ok")) {
      const body=read.items[0]?.body;
      const excerpt=read.comments?.length ? read.comments[0].text.slice(0,160) :
        read.level==="subtitles" ? body?.split("\n").slice(-3).join("\n").slice(0,300) : body?.slice(0,260);
      stage.lastRead={at:row.made,level:read.level,change:row.change,timesWithSameContent:row.identical,position:position(read),excerpt:excerpt||undefined};
    }
  }
  const seen=[...stages.values()];
  const page=part??seen.find(s=>["open","subtitles","frames"].includes(s.action))?.page??1;
  return {...item,title,stages:seen,paths:seen.length?readingPaths(item,seen,page):[]};
}

export async function personalReading(question?:{source?:Target["source"];id?:string;page?:number}) {
  const targets = await all<Target>(`SELECT ${source} AS source,${target} AS id FROM activities
    WHERE ${focused} AND ${target} IS NOT NULL GROUP BY ${source},${target} ORDER BY max(rowid) DESC LIMIT 4`);
  if (question?.source && question.id) {
    const focus={source:question.source,id:question.id};
    const rest=targets.filter(t=>t.source!==focus.source || t.id!==focus.id);
    return Promise.all([materialProgress(focus,question.page),...rest.slice(0,3).map(t=>materialProgress(t))]);
  }
  return Promise.all(targets.map(t=>materialProgress(t)));
}
