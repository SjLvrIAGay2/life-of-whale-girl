import { all, one } from "../db";
import type { Observation, ReadRequest } from "./media";

export const readingGoals = ["discover","open","article","subtitles","frames","comments","read"] as const;
export type ReadingGoal = typeof readingGoals[number];
export type ReadingTarget = { goal:ReadingGoal; source?:ReadRequest["source"]; id?:string; page?:number; nextOffset?:number };

export function planReading(idea:string, goal?:ReadingGoal, media?:Partial<ReadRequest>):ReadingTarget {
  if (!goal) {
    if (/字幕/.test(idea)) goal="subtitles";
    else if (/分镜/.test(idea)) goal="frames";
    else if (/评论|讨论/.test(idea)) goal="comments";
    else if (/全文|正文|文章|读完.*帖/.test(idea)) goal="article";
    else if (/简介|打开视频/.test(idea)) goal="open";
    else if (/挑选|挑一|找一|选题|搜一|浏览推荐/.test(idea)) goal="discover";
    else goal="read";
  }
  return {goal,source:media?.source,id:media?.id,page:media?.page};
}

export function readingCompletion(target:ReadingTarget, request:ReadRequest, result:Observation) {
  if (result.status!=="ok" || !result.items.length ||
      (target.source && target.source!==request.source) ||
      (target.id && target.id!==request.id && !result.items.some(item=>item.id===target.id)) ||
      (target.page && target.page!==(request.page??1))) return;
  const level=result.level;
  const fullStage=target.goal==="article" && level==="article" || target.goal==="subtitles" && level==="subtitles" ||
    target.goal==="frames" && level==="storyboard_viewed" || target.goal==="read" && ["article","subtitles","storyboard_viewed"].includes(level);
  if(fullStage) {
    const from=request.offset??0, expected=target.nextOffset??0;
    if(from>expected) return false;
    target.source=request.source;
    target.id??=request.id??result.items[0].id;
    if(request.source==="bili") target.page??=request.page??1;
    target.nextOffset=Math.max(expected,result.nextOffset??from);
    return result.atEnd===true;
  }
  switch(target.goal) {
    case "discover": return ["browse","search","open"].includes(request.action);
    case "open": return request.action==="open";
    case "article": case "subtitles": case "frames": return false;
    case "comments": return !!result.comments?.length;
    case "read": return ["article","subtitles","storyboard_viewed","discussion","filtered_comments"].includes(level) && result.atEnd!==false;
  }
}

const pending = `kind='day_plan' AND scope IN ('self','public') AND hidden=0
  AND category IN ('planned','started') AND due IS NOT NULL
  AND (json_extract(details,'$.presentedDue') IS NULL OR json_extract(details,'$.presentedDue')<>due)`;

export async function nextPersonalPlan() {
  return (await one<{due:number|null}>("SELECT min(due) AS due FROM memories WHERE "+pending))?.due ?? Infinity;
}
export function duePersonalPlans(now:number) {
  return all<{id:string;body:string;due:number;timing:string;activity:string|null}>(
    "SELECT id,body,due,quote AS timing,json_extract(details,'$.action') AS activity FROM memories WHERE "+pending+" AND due<=? ORDER BY due,made LIMIT 8",now);
}
