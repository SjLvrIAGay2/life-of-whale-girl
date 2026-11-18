import { services } from "../config/operator/services.ts";
import { texts } from "../config/texts.ts";
import type { Overrides } from "../config/options.ts";
import { numbers } from "../config/numbers.ts";
import { links } from "../config/links.ts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { hkey } from "./heybox-sign.mjs";

export const historyCursor = z.object({
  max: z.number().int().nonnegative(),
  view_at: z.number().int().positive(),
  business: z.string().regex(/^[a-z][a-z_-]{0,24}$/),
});
export const readingSources = ["bili", "heybox"] as const;
export const readActions = ["browse","search","open","comments","subtitles","frames","history","watch_later"] as const;
export type ReadRequest = {
  source: typeof readingSources[number];
  action: typeof readActions[number];
  query?: string;
  id?: string;
  root?: string;
  page?: number;
  offset?:number;
  cursor?: z.infer<typeof historyCursor>;
};
export type Story = {
  id: string; title: string; url: string; body: string; image?: string;
  playback?: {
    page?: number; part?: string; viewedAt?: number; addedAt?: number;
    seconds?: number; duration?: number; finished?: boolean;
  };
};
export type Observation = {
  level: string;
  status: string;
  items: Story[];
  comments?: { id: string; parent: string; text: string }[];
  frames?: string[];
  nextCursor?: ReadRequest["cursor"];
  nextPage?: number;
  filteredCount?: number;
  coverage?: string;
  resolved?: {id:string;page?:number};
  nextOffset?: number;
  atEnd?: boolean;
};
type Network = {
  overrides?: Overrides;
  biliCookie?: string;
  heyCookie?: string;
  request?: typeof fetch;
};
const userAgent = services.mediaUserAgent;
export function plain(value: unknown, max = 450) {
  return String(value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|#39);/g,
      (v) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'",
        })[v] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
export function usableName(raw: unknown, replies?: unknown, threshold=numbers.defaults.biliRepliesThreshold) {
  if (typeof raw !== "string") return false;
  const n = raw
    .normalize("NFKC")
    .replace(/[\p{Cf}\s]/gu, "")
    .replace(/鯨/g, "鲸")
    .replace(/魚/g, "鱼");
  if (!n) return false;
  if (!/[鲸鱼]/.test(n)) return true;
  const count = typeof replies === "string" && /^\d+$/.test(replies) ? Number(replies) : replies;
  return typeof count === "number" && Number.isSafeInteger(count) && count > threshold;
}
function replyPage(data: any, n=numbers.defaults) {
  const filtered = new Set<string>();
  const seen = new Set<string>();
  const out: NonNullable<Observation["comments"]> = [];
  function visit(row: any) {
    if (!row || typeof row !== "object") return;
    const id = String(row.rpid_str ?? row.rpid ?? "");
    if (!id) return;
    // rcount is the count shown in Bilibili's “共…条回复”. Older rows may provide only count.
    if (!usableName(row.member?.uname, row.rcount ?? row.count,n.biliRepliesThreshold)) filtered.add(id);
    else if (!seen.has(id)) {
      const body = plain(row.content?.message, 350).replace(
        /^回复\s*@[^:：]{1,64}[:：]\s*/,
        "",
      );
      if (body) {
        seen.add(id);
        out.push({
          id,
          parent: String(row.parent_str ?? row.parent ?? 0),
          text: body,
        });
      }
    }
    if (Array.isArray(row.replies)) row.replies.forEach(visit);
  }
  [
    data?.root,
    data?.upper?.top,
    ...(data?.top_replies ?? []),
    ...(data?.replies ?? []),
  ].forEach(visit);
  return {comments:out.slice(0,n.biliCommentCount), filteredCount:[...filtered].filter(id=>!seen.has(id)).length};
}
export function cleanReplies(data: any) {
  return replyPage(data).comments;
}
async function read(
  url: URL,
  net: Network,
  headers: Record<string, string> = {},
) {
  const options: RequestInit = {
    headers: { "User-Agent": userAgent, ...headers },
    signal: AbortSignal.timeout(numbers.defaults.mediaTimeoutMs),
    redirect: "manual",
  };
  const r = await (net.request ?? fetch)(url, options);
  if (!r.ok) {
    throw Error(
      r.status === 412 || r.status === 429
        ? "rate_limited"
        : "upstream_" + r.status,
    );
  }
  const reader = r.body?.getReader();
  if (!reader) throw Error("empty_response");
  const decoder = new TextDecoder();
  let n = 0,
    s = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    n += chunk.value.length;
    if (n > numbers.defaults.mediaMaxBytes) {
      await reader.cancel();
      throw Error("too_large");
    }
    s += decoder.decode(chunk.value, { stream: true });
  }
  return s + decoder.decode();
}
const wbiOrder = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];
let keyCache: { until: number; key: string } | undefined;
async function bili(
  path: string,
  args: Record<string, string>,
  net: Network,
  sign = false,
) {
  const base = links.defaults.biliApi;
  const headers: Record<string, string> = {
    Referer: links.defaults.biliSite + "/",
  };
  if (net.biliCookie) headers.Cookie = net.biliCookie;
  if (sign) {
    if (!keyCache || keyCache.until < Date.now()) {
      const v = JSON.parse(
        await read(new URL("/x/web-interface/nav", base), net, headers),
      ).data?.wbi_img;
      if (!v) throw Error("signature_unavailable");
      const keys = [v.img_url, v.sub_url]
        .map((x) => String(x).split("/").pop()!.split(".")[0])
        .join("");
      keyCache = {
        key: wbiOrder
          .map((i) => keys[i])
          .join("")
          .slice(0, 32),
        until: Date.now() + numbers.defaults.wbiCacheMs,
      };
    }
    args = { ...args, wts: String(Math.floor(Date.now() / 1000)) };
    const canonical = Object.keys(args)
      .sort()
      .map(
        (k) =>
          encodeURIComponent(k) +
          "=" +
          encodeURIComponent(args[k].replace(/[!'()*]/g, "")),
      )
      .join("&");
    args.w_rid = createHash("md5")
      .update(canonical + keyCache.key)
      .digest("hex");
  }
  const url = new URL(path, base);
  url.search = new URLSearchParams(args).toString();
  const v = JSON.parse(await read(url, net, headers));
  if (v.code !== 0)
    throw Error(
      v.code === 12002
        ? "comments_closed"
        : v.code === -101
          ? "needs_login"
          : [-412, -352].includes(v.code)
            ? "rate_limited"
            : "bili_" + v.code,
    );
  return v.data ?? v.result;
}
const biliURL = (bv: string) => links.defaults.biliSite + "/video/" + bv;
const biliItem = (x: any): Story => ({
  id: x.bvid,
  title: plain(x.title, 120),
  url: biliURL(x.bvid),
  body: plain(x.desc ?? x.description, 450),
});
export function isBiliAccountRead(q: ReadRequest) {
  return q.source === "bili" && (q.action === "history" || q.action === "watch_later");
}
const episodeURL = (id: string) => links.defaults.biliSite + "/bangumi/play/" + id;
const videoId = /^BV[0-9A-Za-z]{10}$/;
function accountVideo(row: any, history: boolean): Story[] {
  const entry = history ? row?.history : row;
  if (!entry) return [];
  const episode = Number.isSafeInteger(entry.epid) && entry.epid > 0 ? "ep" + entry.epid : undefined;
  const id = videoId.test(entry.bvid) ? entry.bvid : episode;
  if (!id) return [];
  const viewedPart = history ? entry : row.pages?.find((p: any) => p.cid === row.cid);
  const page = viewedPart?.page;
  const link = new URL(id === episode ? episodeURL(id) : biliURL(id));
  if (id !== episode && Number.isInteger(page) && page > 1) link.searchParams.set("p", String(page));
  const playback: NonNullable<Story["playback"]> = {};
  if (Number.isInteger(page) && page > 0) playback.page = page;
  if (viewedPart?.part) playback.part = plain(viewedPart.part, 180);
  if (history && Number.isSafeInteger(row.view_at)) playback.viewedAt = row.view_at;
  if (!history && Number.isSafeInteger(row.add_at)) playback.addedAt = row.add_at;
  if (Number.isSafeInteger(row.progress) && row.progress >= 0) playback.seconds = row.progress;
  if (Number.isSafeInteger(row.duration) && row.duration >= 0) playback.duration = row.duration;
  if (row.progress === -1 || row.is_finish === 1) playback.finished = true;
  return [{ id, title: plain(row.title, 160), url: link.href, body: "", playback }];
}
async function readBiliList(q: ReadRequest, net: Network): Promise<Observation> {
  if (!net.biliCookie?.trim()) throw Error("needs_login");
  const history = q.action === "history", size = numbers.read(net.overrides).biliListCount;
  const page = Math.max(1, Math.min(numbers.defaults.mediaPageMax, Math.trunc(q.page ?? 1)));
  const params: Record<string, string> = { ps: String(size) };
  if (history) {
    params.type = "archive";
    if (q.cursor) {
      const cursor = historyCursor.safeParse(q.cursor);
      if (!cursor.success) throw Error("invalid_cursor");
      for (const [k, v] of Object.entries(cursor.data)) params[k] = String(v);
    } else if (page > 1) throw Error("history_cursor_required");
  } else params.pn = String(page);
  const d = await bili(history ? "/x/web-interface/history/cursor" : "/x/v2/history/toview/web", params, net);
  if (!d || (d.list !== null && !Array.isArray(d.list))) throw Error("invalid_account_list");
  const rows = d.list ?? [];
  const result: Observation = { level: q.action, status: "ok", items: rows.slice(0, size).flatMap((r: unknown) => accountVideo(r, history)) };
  if (history && rows.length >= size) {
    const next = historyCursor.safeParse(d.cursor);
    if (next.success && (next.data.max !== q.cursor?.max || next.data.view_at !== q.cursor?.view_at || next.data.business !== q.cursor?.business))
      result.nextCursor = next.data;
  }
  if (!history && page * size < d.count && rows.length && page < numbers.defaults.mediaPageMax) result.nextPage = page + 1;
  return result;
}
async function readBili(q: ReadRequest, net: Network): Promise<Observation> {
  if (isBiliAccountRead(q)) return readBiliList(q, net);
  const n=numbers.read(net.overrides);
  const selectPart = q.action === "subtitles" || q.action === "frames" || q.action === "open";
  const page = String(q.page ?? 1);
  if (q.action === "search" || q.action === "browse") {
    const search = q.action === "search";
    const data = search
      ? await bili(
          "/x/web-interface/wbi/search/type",
          {
            keyword: (q.query || texts.read(net.overrides).searchTopic).slice(0, 60),
            search_type: "video",
            page,
          },
          net,
          true,
        )
      : await bili(
          "/x/web-interface/index/top/feed/rcmd",
          { ps: String(n.biliListCount), fresh_idx: page, version: "1" },
          net,
        );
    const items:Story[]=(data.result ?? data.item ?? []).filter((x:any)=>videoId.test(x.bvid)).slice(0,n.biliListCount).map(biliItem);
    return {level:"title",status:items.length?"ok":"no_results",items};
  }
  let bvid = q.id ?? "";
  if (/^ep[1-9]\d{0,15}$/.test(bvid)) {
    const season = await bili("/pgc/view/web/season", { ep_id: bvid.slice(2) }, net);
    const episodes = [...(season?.episodes ?? []), ...(season?.section ?? []).flatMap((s: any) => s.episodes ?? [])];
    const episode = episodes.find(e => "ep" + e.id === bvid);
    if (!episode) throw Error("episode_not_found");
    if (q.action === "open") return { level: "metadata", status: "ok", items: [{
      id: bvid, url: episodeURL(bvid), title: plain(episode.share_copy || episode.long_title || season.title, 160), body: plain(season.evaluate),
    }] };
    bvid = episode.bvid ?? "";
  }
  if (!videoId.test(bvid)) throw Error("invalid_video");
  const v = await bili("/x/web-interface/wbi/view", { bvid }, net, true);
  const item = biliItem(v);
  const part = v.pages?.[Number(page) - 1];
  if (selectPart && Number(page) > 1 && !part?.cid) throw Error("part_not_found");
  const cid = String(part?.cid ?? v.cid);
  if (q.action === "comments") {
    const param: Record<string, string> = {
      oid: String(v.aid),
      type: "1",
      pn: page,
      ps: "16",
      sort: "2",
    };
    if (q.root) {
      if (!/^\d{1,20}$/.test(q.root)) throw Error("invalid_root");
      param.root = q.root;
    }
    const data = await bili(
      q.root ? "/x/v2/reply/reply" : "/x/v2/reply",
      param,
      net,
    );
    const {comments,filteredCount} = replyPage(data,n);
    const total = data.page?.count, size = data.page?.size || 16;
    const atEnd = Number.isInteger(total) ? Number(page)*size >= total : !data.replies?.length;
    return {
      level: "filtered_comments", filteredCount, atEnd,
      nextPage: !atEnd && Number(page)<numbers.defaults.mediaPageMax ? Number(page)+1 : undefined,
      status: comments.length
        ? "ok"
        : data.replies == null
          ? "unavailable"
          : "no_visible_comments",
      items: [item],
      comments,
    };
  }
  if (q.action === "subtitles") {
    const d = await bili("/x/player/v2", { bvid, cid }, net);
    const tracks = d.subtitle?.subtitles ?? [];
    const track =
      tracks.find((x: any) => /^zh|^ai-zh/.test(x.lan)) ?? tracks[0];
    if (!track)
      return {
        level: "metadata",
        status: d.need_login_subtitle ? "needs_login" : "no_subtitles",
        items: [item],
      };
    const url = new URL(track.subtitle_url, links.defaults.biliSite);
    if (
      url.protocol !== "https:" ||
      !/(^|\.)(bilibili\.com|hdslb\.com|biliapi\.net)$/.test(url.hostname)
    )
      throw Error("invalid_subtitle_source");
    const b = JSON.parse(await read(url, net)).body;
    if (!Array.isArray(b)) throw Error("invalid_subtitles");
    const start=Math.max(0,Math.min(numbers.defaults.mediaOffsetMax,Math.floor(q.offset??0)));
    if(start>=b.length) return {status:"end_of_subtitles",level:"metadata",items:[item]};
    const lines: string[] = [];
    let length = 0;
    for (const cue of b.slice(start,start+n.subtitleLines)) {
      const line = Math.floor(cue.from) + "s " + plain(cue.content,120);
      if (length + line.length + (lines.length ? 1 : 0) > n.subtitleChars) break;
      length += line.length + (lines.length ? 1 : 0);
      lines.push(line);
    }
    const nextOffset = start + lines.length;
    return {
      status: "ok",
      level: "subtitles",
      items: [{...item,body:lines.join("\n")}],
      nextOffset, atEnd: nextOffset >= b.length,
    };
  }
  if (q.action === "frames") {
    const d = await bili("/x/player/videoshot", { bvid, cid, index: "1" }, net);
    const frames = (d.image ?? [])
        .map((v: string) => new URL(v, links.defaults.biliSite))
        .filter(
          (u: URL) =>
            u.protocol === "https:" && /(^|\.)hdslb\.com$/.test(u.hostname),
        )
        .map(String),
      start = Math.max(0,Math.min(numbers.defaults.mediaOffsetMax,Math.floor(q.offset??0)));
    if (!frames[start]) return {level:"metadata",status:frames.length?"end_of_frames":"no_frames",items:[item]};
    return {level:"storyboard_available",status:"ok",items:[item],frames:frames.slice(start,start+2),atEnd:start+1===frames.length};
  }
  return { level: "metadata", status: "ok", items: [item] };
}
let heyboxDeviceId: string | undefined;

async function hey(path: string, args: Record<string, string>, net: Network) {
  const url = new URL(path, links.defaults.heyboxApi);
  const time = Math.floor(Date.now() / 1000),
    nonce = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  url.search = new URLSearchParams({
    ...services.heybox,
    device_id: heyboxDeviceId ??= crypto.randomUUID().replace(/-/g, ""),
    ...args,
    hkey: hkey(path, time, nonce),
    _time: String(time),
    nonce,
  }).toString();
  const headers: Record<string, string> = {
    Referer: links.defaults.heyboxSite + "/",
    Origin: links.defaults.heyboxSite,
  };
  if (net.heyCookie) headers.Cookie = net.heyCookie;
  const v = JSON.parse(await read(url, net, headers));
  if (v.status !== "ok")
    throw Error(
      v.status === "show_captcha"
        ? "captcha"
        : plain(v.status, 40) || "unavailable",
    );
  return v.result;
}
const heyShare = (id: string) =>
  links.defaults.heyboxApi + "/v3/bbs/app/api/web/share?link_id=" +
  encodeURIComponent(id);
async function readHey(q: ReadRequest, net: Network): Promise<Observation> {
  const n=numbers.read(net.overrides);
  if (q.action === "browse" || q.action === "search") {
    const start=q.page??1, query=q.query?.trim().toLowerCase();
    const last=Math.min(numbers.defaults.mediaPageMax,start+(q.action==="search" && query ? n.heySearchPages-1 : 0));
    let checked=0;
    for(let page=start;page<=last;page++) {
      const data=await hey("/bbs/app/feeds",{offset:String((page-1)*n.heyFeedCount),limit:String(n.heyFeedCount),pull:"0",dw:"604"},net);
      const links=Array.isArray(data.links)?data.links:[];
      const items:Story[]=[];
      for(const link of links) {
        let id;
        try { id=new URL(link.share_url).searchParams.get("link_id"); } catch { continue; }
        if(!id || !/^[\da-f]{1,32}$/i.test(id)) continue;
        checked++;
        const title=plain(link.title,120),body=plain(link.description);
        if(!query || (title+" "+body).toLowerCase().includes(query)) items.push({id,title,body,url:heyShare(id)});
      }
      const atEnd=links.length<n.heyFeedCount || data.has_more===false || page===numbers.defaults.mediaPageMax;
      if(items.length || atEnd || page===last) return {level:"feed",status:items.length?"ok":"no_results",items,atEnd,
        nextPage:atEnd?undefined:page+1,coverage:"推荐流第 "+(page===start?start:start+"–"+page)+" 页，检查了 "+checked+" 条帖子"};
    }
    throw Error("invalid_page");
  }
  if (!/^[\da-f]{1,32}$/i.test(q.id ?? "")) throw Error("invalid_post");
  const d = await hey(
    "/bbs/app/link/tree",
    {
      link_id: q.id!,
      page: String(q.page ?? 1),
      is_first: (q.page ?? 1) === 1 ? "1" : "0",
      index: "1",
      owner_only: "0",
      offset: String(((q.page ?? 1)-1)*n.heyThreadCount),
      limit: String(n.heyThreadCount),
      sort_filter: "hot",
    },
    net,
  );
  const link = d.link;
  if (!link) throw Error("unavailable");
  let body = "";
  try {
    const blocks = JSON.parse(link.text);
    if (Array.isArray(blocks))
      body =
        plain(blocks.map((b: any) => b.text ?? "").join(" "), Number.MAX_SAFE_INTEGER);
  } catch {
    body = plain(link.text, Number.MAX_SAFE_INTEGER) || body;
  }
  const item = {
    id: q.id!,
    title: plain(link.title, 120),
    body: body ? body.slice(q.offset ?? 0,(q.offset ?? 0)+n.heyArticleChars) : plain(link.description, 1000),
    url: heyShare(q.id!),
  };
  const comments = (d.comments ?? [])
    .flatMap((g: any) =>
      (g.comment ?? [])
        .filter((c: any) => c.user?.username)
        .map((c: any) => ({
          id: String(c.commentid),
          parent: String(c.rootid ?? 0),
          text: plain(c.text, 280),
        })),
    )
    .slice(0, n.heyCommentCount);
  return {
    level: q.action === "comments" && comments.length ? "discussion" : q.action === "open" && body ? "article" : "metadata",
    status: q.action==="comments" && !comments.length ? "no_visible_comments" : body && q.action==="open" && (q.offset??0)>=body.length ? "end_of_article" : "ok",
    items: [item],
    ...(q.action === "comments" ? {comments,atEnd:(d.comments?.length??0)<n.heyThreadCount,nextPage:(d.comments?.length??0)>=n.heyThreadCount && (q.page??1)<numbers.defaults.mediaPageMax?(q.page??1)+1:undefined} :
      body ? {nextOffset:(q.offset??0)+item.body.length,atEnd:(q.offset??0)+item.body.length>=body.length} : {}),
  };
}
export function sharedLink(text: string): ReadRequest | undefined {
  const match = text.match(/https:\/\/[^\s<>「」“”，。！？]+/);
  if (!match) return;
  try {
    const url = new URL(match[0]);
    if (url.username || url.password || url.port) return;
    if (url.hostname==="b23.tv" && /^\/[a-zA-Z0-9]+\/?$/.test(url.pathname)) return {source:"bili",action:"open",id:url.origin+url.pathname};
    if (["www.bilibili.com", "m.bilibili.com"].includes(url.hostname)) {
      const id = url.pathname.match(/(?:BV[\da-zA-Z]{10}|ep[1-9]\d{0,15})(?:\/|$)/)?.[0]?.replace(/\/$/,"");
      const page = Number(url.searchParams.get("p"));
      if (id) return {source:"bili",action:"open",id,...(Number.isInteger(page) && page>0 && page<=numbers.defaults.mediaPageMax ? {page}: {})};
    }
    if (
      [
        "api.xiaoheihe.cn",
        "www.xiaoheihe.cn",
        "www.xiaoheihe.com",
        "api.xiaoheihe.com",
      ].includes(url.hostname)
    ) {
      const id =
        url.searchParams.get("link_id") ??
        url.pathname.match(/\/link\/([a-f\d]+)\/?$/i)?.[1];
      if (id && /^[a-f\d]{1,32}$/i.test(id))
        return { source: "heybox", action: "open", id };
    }
  } catch {
    /* Non-media links remain ordinary conversation text. */
  }
}
export async function readMedia(
  q: ReadRequest,
  net: Network = {},
): Promise<Observation> {
  try {
    if (!q || !readingSources.includes(q.source)) throw Error("unsupported_source");
    if (!readActions.includes(q.action) || (q.source==="heybox" && !["browse","search","open","comments"].includes(q.action))) throw Error("unsupported_action");
    if (q.page!==undefined && (!Number.isInteger(q.page) || q.page<1 || q.page>numbers.defaults.mediaPageMax)) throw Error("invalid_page");
    if (q.source==="heybox") return await readHey(q,net);
    if (typeof q.id==="string" && /^https:\/\/b23\.tv\/[a-zA-Z0-9]+\/?$/.test(q.id)) {
      const redirect=await (net.request??fetch)(q.id,{redirect:"manual",signal:AbortSignal.timeout(6000)});
      await redirect.body?.cancel();
      const location=redirect.headers.get("location");
      const resolved=location && sharedLink(new URL(location,q.id).href);
      if (redirect.status<300 || redirect.status>=400 || !resolved || resolved.source!=="bili" || !/^(BV|ep)/.test(resolved.id??"")) throw Error("invalid_video_link");
      q={...q,id:resolved.id,page:q.page??resolved.page};
      const observation=await readBili(q,net);
      return {...observation,resolved:{id:resolved.id!,page:q.page}};
    }
    return await readBili(q,net);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unavailable";
    return {
      level: "unavailable",
      status: /^[a-z_\d-]{1,45}$/.test(message) ? message : "network_error",
      items: [],
    };
  }
}
