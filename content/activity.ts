import { texts } from "../config/texts.ts";
import { formatText } from "../config/options.ts";
import { sourceNames, levelKeys, verbKeys, readingFailures } from "../config/texts/reading.ts";
import { numbers } from "../config/numbers.ts";
import type { Overrides } from "../config/options.ts";
import type { Game, GameCommand } from "../lib/games";
import type { ReadRequest, Story } from "../lib/media";

export type Visibility = "hidden" | "summary" | "detail";
export type Reading = {
  kind: "reading";
  source: ReadRequest["source"] | "news" | "museum" | "nasa"; // Historical activities retain their original source.
  action: string;
  level: string;
  status?: string;
  nextOffset?: number;
  nextPage?: number;
  filteredCount?: number;
  coverage?: string;
  atEnd?: boolean;
  items: Story[];
  page?: number;
  offset?: number;
  root?: string;
  comments?: { id: string; text: string; parent: string }[];
};
export type Experience =
  | Reading
  | { kind: "game"; save: string; game: Game; op: GameCommand["op"]; input?: string }
  | { kind: "draw"; description:string; title?:string; art?:string }
  | { kind: "rest"; description: string; rest?: {since:number;posture:"in_bed"|"up";minutes:number;timing:"chosen"|"default"} }
  | { kind: "sleep" | "room"; description: string };
export type PublicActivity = {
  id: string;
  made: number;
  until: number;
  label: string;
  kind: Experience["kind"];
  detail?: Experience;
  remark?: string;
  restCount?: number;
};

// Group only the timeline presentation; individual activity URLs and evidence remain intact.
export function groupRestActivities(rows: PublicActivity[]) {
  const grouped: PublicActivity[] = [];
  for (const row of rows) {
    const newer = grouped.at(-1);
    const newRest=newer?.detail?.kind==="rest"?newer.detail.rest:undefined;
    const oldRest=row.detail?.kind==="rest"?row.detail.rest:undefined;
    const sameSession=newRest ? oldRest ? newRest.since===oldRest.since : newRest.since<=row.made : !oldRest;
    if (newer?.kind === "rest" && row.kind === "rest" && newer.label === row.label &&
        !newer.remark && !row.remark && !!newer.detail === !!row.detail && sameSession &&
        row.made <= newer.made && Math.abs(row.until-newer.made)<=1000) {
      newer.made = row.made;
      newer.restCount = (newer.restCount ?? 1) + 1;
    } else grouped.push({...row});
  }
  return grouped;
}
export function videoPart(r: Pick<Reading, "source" | "action" | "level" | "page">) {
  if (r.source === "bili" && (["open", "subtitles", "frames"].includes(r.action) ||
      ["subtitles", "storyboard_viewed", "storyboard_available"].includes(r.level))) return r.page;
}
export { sourceNames };
export function readingLevel(level: string, copy = texts.defaults) {
  return copy[levelKeys[level]];
}
export const levelNames: Record<string,string> = Object.fromEntries(
  Object.keys(levelKeys).map(key => [key,readingLevel(key)]));
export function readingOutcome(r: Pick<Reading,"source"|"action"|"level"|"status">, copy=texts.defaults) {
  if ((!r.status || r.status==="ok") && r.source==="bili" && r.action==="open" && r.level==="metadata") return copy.videoInfo;
  if (!r.status || r.status === "ok") return readingLevel(r.level,copy) ?? copy.readInfo;
  return (copy[verbKeys[r.action]] ?? "读取内容") + "时，" + (readingFailures[r.status] ?? "这次未能取得内容");
}
export function experienceLabel(e: Experience, copy=texts.defaults) {
  if (e.kind === "reading") return "在" + sourceNames[e.source] + readingOutcome(e,copy);
  if (e.kind === "game") {
    const g = e.game;
    if (e.op === "look") return g.kind === "gomoku" ? copy.lookGomoku : copy.lookPuzzle;
    if (e.op === "restart")
      return g.kind === "gomoku" ? copy.restartGomoku : formatText(copy.restartPuzzle, {level:g.level});
    if (e.op === "move" && g.kind === "sokoban" && /推不动|是墙/.test(g.feedback))
      return formatText(copy.stuckPuzzle, {level:g.level});
    if (g.result) return g.kind === "gomoku" ? copy.finishGomoku : formatText(copy.finishPuzzle, {level:g.level});
    if (g.paused) return g.kind === "gomoku" ? copy.pauseGomoku : formatText(copy.pausePuzzle, {level:g.level});
    return g.kind === "gomoku" ? copy.playGomoku : formatText(copy.playPuzzle, {level:g.level});
  }
  return e.description;
}
export function activityTime(
  a: PublicActivity,
  current: string | undefined,
  synced: number | undefined,
  now: number,
  overrides?: Overrides,
) {
  const n=numbers.read(overrides);
  const atSync = current === a.id && (synced ?? now) < a.until;
  if (atSync && synced && now - synced > n.syncStaleMs) return "上次同步时";
  if (atSync && now < a.until) return "现在";
  return now - a.made < n.recentActivityMs ? "刚刚" : "那时";
}
