import type { Game, GameCommand } from "../lib/games";
import type { ReadRequest, Story } from "../lib/media";

export type Visibility = "hidden" | "summary" | "detail";
export type Reading = {
  kind: "reading";
  source: ReadRequest["source"];
  action: string;
  level: string;
  status?: string;
  nextOffset?: number;
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
  | { kind: "rest" | "sleep" | "room"; description: string };
export type PublicActivity = {
  id: string;
  made: number;
  until: number;
  label: string;
  kind: Experience["kind"];
  detail?: Experience;
  remark?: string;
};
export function videoPart(r: Pick<Reading, "source" | "action" | "level" | "page">) {
  if (r.source === "bili" && (["open", "subtitles", "frames"].includes(r.action) ||
      ["subtitles", "storyboard_viewed", "storyboard_available"].includes(r.level))) return r.page;
}
export const sourceNames = {
  bili: "哔哩哔哩",
  heybox: "小黑盒",
  news: "资讯",
  museum: "克利夫兰艺术博物馆",
  nasa: "NASA 影像库",
};
export const levelNames: Record<string, string> = {
  title: "挑选标题",
  feed: "挑选帖子",
  metadata: "查看条目信息",
  subtitles: "读字幕",
  filtered_comments: "翻评论",
  discussion: "翻讨论",
  article: "读正文",
  storyboard_viewed: "看分镜",
  storyboard_available: "查看分镜入口",
  rss_excerpt: "读订阅摘要",
  search_titles: "挑选标题",
  collection_label: "读藏品说明",
  photo_caption: "读照片说明",
  image_viewed: "看作品图",
};
const readActions: Record<string,string> = {
  open:"打开条目", subtitles:"读字幕", frames:"看分镜", comments:"翻评论", image:"看图", browse:"浏览", search:"搜索",
};
export function readingOutcome(r: Pick<Reading,"source"|"action"|"level"|"status">) {
  if ((!r.status || r.status==="ok") && r.source==="bili" && r.action==="open" && r.level==="metadata") return "查看视频简介";
  if (!r.status || r.status === "ok") return levelNames[r.level] ?? "查看条目信息";
  const reasons: Record<string,string> = {
    no_subtitles:"没有可读字幕", end_of_subtitles:"已经到字幕末尾", no_frames:"没有可用分镜",
    end_of_frames:"已经到分镜末尾", no_visible_comments:"没有可见评论", needs_login:"需要登录",
    rate_limited:"来源暂时限流", network_error:"连接未成功", unavailable:"内容暂时不可用",
    unverified:"未留下读取结果", part_not_found:"找不到这个分集",
    frames_unseen:"这次没能看清分镜", image_unseen:"这次没能看清图片",
  };
  return (readActions[r.action] ?? "读取内容") + "时，" + (reasons[r.status] ?? "这次未能取得内容");
}
export function experienceLabel(e: Experience) {
  if (e.kind === "reading") return "在" + sourceNames[e.source] + readingOutcome(e);
  if (e.kind === "game") {
    const g = e.game;
    if (e.op === "look") return g.kind === "gomoku" ? "在翻这盘棋的存档" : "在看上回留下的关卡";
    if (e.op === "restart")
      return g.kind === "gomoku" ? "重新摆了一盘五子棋" : "重新开始了第 " + g.level + " 关";
    if (e.op === "move" && g.kind === "sokoban" && /推不动|是墙/.test(g.feedback))
      return "卡在推箱子的第 " + g.level + " 关";
    if (g.result) return g.kind === "gomoku" ? "下完了一盘五子棋" : "推完了第 " + g.level + " 关的箱子";
    if (g.paused) return g.kind === "gomoku" ? "把这盘五子棋留到下回" : "把箱子留在了第 " + g.level + " 关";
    return g.kind === "gomoku" ? "在摆弄这盘五子棋" : "在推第 " + g.level + " 关的箱子";
  }
  return e.description;
}
export function activityTime(
  a: PublicActivity,
  current: string | undefined,
  synced: number | undefined,
  now: number,
) {
  const atSync = current === a.id && (synced ?? now) < a.until;
  if (atSync && synced && now - synced > 150000) return "上次同步时";
  if (atSync && now < a.until) return "现在";
  return now - a.made < 3600000 ? "刚刚" : "那时";
}
