import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { z } from "zod";
import { collections } from "./collections";
import { hkey } from "./heybox-sign.mjs";

export const historyCursor = z.object({
  max: z.number().int().nonnegative(),
  view_at: z.number().int().positive(),
  business: z.string().regex(/^[a-z][a-z_-]{0,24}$/),
});
export type ReadRequest = {
  source: "news" | "bili" | "heybox" | keyof typeof collections;
  action: "browse" | "search" | "open" | "comments" | "subtitles" | "frames" | "image" | "history" | "watch_later";
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
  nextOffset?: number;
  atEnd?: boolean;
};
type Network = {
  annTransport?: { fetch(request: Request): Promise<Response> };
  newsSearchKey?: string;
  biliCookie?: string;
  heyCookie?: string;
  request?: typeof fetch;
};
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const feeds: Record<string, string> = {
  gcores: "https://www.gcores.com/rss",
  ann: "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us",
};
const annArticle = /^\/(news|interest|review|feature|column|daily-briefs|preview-guide)\//;
function newsArticle(link: string) {
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return;
    if (url.hostname === "gcores.com" || url.hostname === "animenewsnetwork.com") url.hostname = "www." + url.hostname;
    if ((url.hostname === "www.gcores.com" && /^\/(?:articles|radios|videos)\/\d+\/?$/.test(url.pathname)) ||
        (url.hostname === "www.animenewsnetwork.com" && annArticle.test(url.pathname))) {
      url.search = "";
      url.hash = "";
      return url;
    }
  } catch { /* Ignore malformed or unsupported search results. */ }
}
async function searchNews(q: ReadRequest, net: Network): Promise<Story[]> {
  const domains = q.id === "ann" ? ["animenewsnetwork.com"] : q.id === "gcores" ? ["gcores.com"] : ["gcores.com", "animenewsnetwork.com"];
  const query = q.query!.trim().slice(0, 70) + " " + domains.map(d => "site:" + d).join(" OR ");
  const response = await (net.request ?? fetch)("https://api.deepseek.com/v1/tools/search", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + net.newsSearchKey },
    body: JSON.stringify({ query, count: 8, need_content: false }),
    redirect: "error", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return [];
  const { results } = await response.json<{ results?: { title?: string; url?: string }[] }>();
  const items = new Map<string, Story>();
  for (const row of results ?? []) {
    const url = row.url && newsArticle(row.url);
    const title = plain(row.title ?? "", 140);
    if (url && title && domains.includes(url.hostname.slice(4))) {
      items.set(url.href, { id: url.href, title, url: url.href, body: "" });
    }
  }
  return [...items.values()].slice(0, 8);
}
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
export function usableName(raw: unknown, replies?: unknown) {
  if (typeof raw !== "string") return false;
  const n = raw
    .normalize("NFKC")
    .replace(/[\p{Cf}\s]/gu, "")
    .replace(/鯨/g, "鲸")
    .replace(/魚/g, "鱼");
  if (!n) return false;
  if (!/[鲸鱼]/.test(n)) return true;
  const count = typeof replies === "string" && /^\d+$/.test(replies) ? Number(replies) : replies;
  return typeof count === "number" && Number.isSafeInteger(count) && count > 150;
}
export function cleanReplies(data: any) {
  const seen = new Set<string>();
  const out: NonNullable<Observation["comments"]> = [];
  function visit(row: any) {
    if (!row || typeof row !== "object") return;
    const id = String(row.rpid_str ?? row.rpid ?? "");
    if (!id) return;
    // rcount is the count shown in Bilibili's “共…条回复”. Older rows may provide only count.
    if (!seen.has(id) && usableName(row.member?.uname, row.rcount ?? row.count)) {
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
  return out.slice(0, 50);
}
async function read(
  url: URL,
  net: Network,
  headers: Record<string, string> = {},
) {
  const options: RequestInit = {
    headers: { "User-Agent": userAgent, ...headers },
    signal: AbortSignal.timeout(12500),
    redirect: "manual",
  };
  let r: Response;
  if (url.origin === "https://www.animenewsnetwork.com") {
    const original = url.origin;
    // ANN redirects article links to the visitor's edition. Only follow ANN itself.
    for (let i = 0; ; i++) {
      r = net.annTransport
        ? await net.annTransport.fetch(new Request(url, options))
        : await (net.request ?? fetch)(url, options);
      const location = r.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(r.status) || !location) break;
      await r.body?.cancel();
      url = new URL(location, url);
      if (i >= 3 || url.origin !== original || url.username || url.password)
        throw Error("invalid_ann_redirect");
    }
  } else {
    r = await (net.request ?? fetch)(url, options);
  }
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
    if (n > 2500000) {
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
  const base = "https://api.bilibili.com";
  const headers: Record<string, string> = {
    Referer: "https://www.bilibili.com/",
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
        until: Date.now() + 1800000,
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
const biliURL = (bv: string) => "https://www.bilibili.com/video/" + bv;
const biliItem = (x: any): Story => ({
  id: x.bvid,
  title: plain(x.title, 120),
  url: biliURL(x.bvid),
  body: plain(x.desc ?? x.description, 450),
});
export function isBiliAccountRead(q: ReadRequest) {
  return q.source === "bili" && (q.action === "history" || q.action === "watch_later");
}
const episodeURL = (id: string) => "https://www.bilibili.com/bangumi/play/" + id;
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
  const history = q.action === "history", size = 8;
  const page = Math.max(1, Math.min(10000, Math.trunc(q.page ?? 1)));
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
  if (!history && page * size < d.count && rows.length && page < 10000) result.nextPage = page + 1;
  return result;
}
async function readBili(q: ReadRequest, net: Network): Promise<Observation> {
  if (isBiliAccountRead(q)) return readBiliList(q, net);
  const selectPart = q.action === "subtitles" || q.action === "frames" || q.action === "open";
  const page = String(Math.max(1, Math.min(selectPart ? 10000 : 10, q.page ?? 1)));
  if (q.action === "search" || q.action === "browse") {
    const search = q.action === "search";
    const data = search
      ? await bili(
          "/x/web-interface/wbi/search/type",
          {
            keyword: (q.query || "动画").slice(0, 60),
            search_type: "video",
            page,
          },
          net,
          true,
        )
      : await bili(
          "/x/web-interface/index/top/feed/rcmd",
          { ps: "8", fresh_idx: page, version: "1" },
          net,
        );
    return {
      level: "title",
      status: "ok",
      items: (data.result ?? data.item ?? [])
        .filter((x: any) => /^BV\w{10}$/.test(x.bvid))
        .slice(0, 8)
        .map(biliItem),
    };
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
    const comments = cleanReplies(data);
    return {
      level: "filtered_comments",
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
    const url = new URL(track.subtitle_url, "https://www.bilibili.com");
    if (
      url.protocol !== "https:" ||
      !/(^|\.)(bilibili\.com|hdslb\.com|biliapi\.net)$/.test(url.hostname)
    )
      throw Error("invalid_subtitle_source");
    const b = JSON.parse(await read(url, net)).body;
    if (!Array.isArray(b)) throw Error("invalid_subtitles");
    const start=Math.max(0,Math.min(50000,Math.floor(q.offset??0)));
    if(start>=b.length) return {status:"end_of_subtitles",level:"metadata",items:[item]};
    const lines: string[] = [];
    let length = 0;
    for (const cue of b.slice(start,start+50)) {
      const line = Math.floor(cue.from) + "s " + plain(cue.content,120);
      if (length + line.length + (lines.length ? 1 : 0) > 3200) break;
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
        .map((v: string) => new URL(v, "https://www.bilibili.com"))
        .filter(
          (u: URL) =>
            u.protocol === "https:" && /(^|\.)hdslb\.com$/.test(u.hostname),
        )
        .map(String),
      start = Math.max(0,Math.min(50000,Math.floor(q.offset??0)));
    if (!frames[start]) return {level:"metadata",status:frames.length?"end_of_frames":"no_frames",items:[item]};
    return {level:"storyboard_available",status:"ok",items:[item],frames:frames.slice(start,start+2),atEnd:start+1===frames.length};
  }
  return { level: "metadata", status: "ok", items: [item] };
}
let heyboxDeviceId: string | undefined;

async function hey(path: string, args: Record<string, string>, net: Network) {
  const url = new URL(path, "https://api.xiaoheihe.cn");
  const time = Math.floor(Date.now() / 1000),
    nonce = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  url.search = new URLSearchParams({
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: "3.0",
    x_client_type: "web",
    x_app: "heybox_website",
    x_os_type: "Windows",
    device_info: "Chrome",
    device_id: heyboxDeviceId ??= crypto.randomUUID().replace(/-/g, ""),
    ...args,
    hkey: hkey(path, time, nonce),
    _time: String(time),
    nonce,
  }).toString();
  const headers: Record<string, string> = {
    Referer: "https://www.xiaoheihe.cn/",
    Origin: "https://www.xiaoheihe.cn",
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
  "https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?link_id=" +
  encodeURIComponent(id);
async function readHey(q: ReadRequest, net: Network): Promise<Observation> {
  if (q.action === "browse" || q.action === "search") {
    const data = await hey(
      "/bbs/app/feeds",
      {
        offset: String(((q.page ?? 1) - 1) * 10),
        limit: "10",
        pull: "0",
        dw: "604",
      },
      net,
    );
    let items: Story[] = (data.links ?? []).flatMap((v: any) => {
      try {
        const id = new URL(v.share_url).searchParams.get("link_id");
        return /^[\da-f]{1,32}$/i.test(id ?? "")
          ? [
              {
                id,
                title: plain(v.title, 120),
                body: plain(v.description),
                url: heyShare(id!),
              },
            ]
          : [];
      } catch {
        return [];
      }
    });
    if (q.query)
      items = items.filter((x) => (x.title + x.body).includes(q.query!));
    return { level: "feed", status: "ok", items };
  }
  if (!/^[\da-f]{1,32}$/i.test(q.id ?? "")) throw Error("invalid_post");
  const d = await hey(
    "/bbs/app/link/tree",
    {
      link_id: q.id!,
      page: "1",
      is_first: "1",
      index: "1",
      owner_only: "0",
      offset: "0",
      limit: "8",
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
        plain(blocks.map((b: any) => b.text ?? "").join(" "), 2800);
  } catch {
    body = plain(link.text, 2800) || body;
  }
  const item = {
    id: q.id!,
    title: plain(link.title, 120),
    body: body || plain(link.description, 1000),
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
    .slice(0, 24);
  return {
    level: q.action === "comments" && comments.length ? "discussion" : q.action === "open" && body ? "article" : "metadata",
    status: "ok",
    items: [item],
    ...(q.action === "comments" ? { comments } : {}),
  };
}
export function sharedLink(text: string): ReadRequest | undefined {
  const match = text.match(/https:\/\/[^\s<>「」“”，。！？]+/);
  if (!match) return;
  try {
    const url = new URL(match[0]);
    if (url.username || url.password || url.port) return;
    if (["www.bilibili.com", "m.bilibili.com"].includes(url.hostname)) {
      const id = url.pathname.match(/BV[\da-zA-Z]{10}/)?.[0];
      if (id) return { source: "bili", action: "open", id };
    }
    if (["www.gcores.com", "www.animenewsnetwork.com"].includes(url.hostname))
      return { source: "news", action: "open", id: url.href };
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
    if (q.source === "museum" || q.source === "nasa") {
      if (!["open","search","browse","image"].includes(q.action)) throw Error("unsupported_action");
      return await collections[q.source]({...q,action:q.action==="image"?"open":q.action}, url=>read(url,net));
    }
    if (q.action==="image") throw Error("unsupported_action");
    if (q.source !== "bili" && !["browse","open","search",...(q.source === "heybox"?["comments"]:[])].includes(q.action)) throw Error("unsupported_action");
    if (q.source === "bili") return await readBili(q, net);
    if (q.source === "heybox") return await readHey(q, net);
    if (q.action === "open" && q.id && /^https:\/\//.test(q.id)) {
      const url = new URL(q.id);
      if (
        url.username ||
        url.password ||
        url.port ||
        !["www.gcores.com", "www.animenewsnetwork.com"].includes(url.hostname)
      )
        throw Error("unsupported_article");
      if (url.hostname === "www.gcores.com") {
        const id = url.pathname.match(
          /^\/(?:articles|radios|videos)\/(\d+)\/?$/,
        )?.[1];
        if (!id) throw Error("unsupported_article");
        const full = JSON.parse(
          await read(
            new URL(
              "/gapi/v1" + url.pathname.replace(/\/$/, ""),
              "https://www.gcores.com",
            ),
            net,
          ),
        ).data?.attributes;
        if (!full) throw Error("unavailable");
        let blocks = "";
        try {
          blocks = JSON.parse(full.content)
            .blocks.map((b: any) => plain(b.text, 600))
            .join("\n");
        } catch {
          blocks = plain(full.content, 4200);
        }
        return {
          level: blocks ? "article" : "metadata",
          status: "ok",
          items: [
            {
              id: url.href,
              title: plain(full.title, 140),
              url: url.href,
              body: (blocks || plain(full.desc, 600)).slice(0, 4200),
            },
          ],
        };
      }
      if (!annArticle.test(url.pathname))
        throw Error("unsupported_article");
      const html = await read(url, net),
        title = plain(
          html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "",
          140,
        );
      const article =
        html.match(
          /<div\b[^>]*class=["'][^"']*meat[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*(?:discuss|forum|comments|social|footer)|<\/article>)/i,
        )?.[1] ??
        html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
        "";
      const body = plain(article, 4100);
      return {
        level: body ? "article" : "title",
        status: "ok",
        items: [{ id: url.href, url: url.href, title, body }],
      };
    }
    if (q.action === "search" && q.query?.trim() && net.newsSearchKey) {
      // Only pass article headlines and validated source links to the resident.
      // An actual 'open' continues through each publisher's normal reader.
      const items = await searchNews(q, net).catch(() => []);
      if (items.length) return { level: "search_titles", status: "ok", items };
    }
    const feed = q.id === "ann" ? "ann" : "gcores";
    const xml = await read(new URL(feeds[feed]), net);
    const dom = new DOMParser({ errorHandler: () => {} }).parseFromString(
      xml,
      "application/xml",
    );
    const nodes = Array.from(dom.getElementsByTagName("item")).slice(0, 12);
    let items: Story[] = nodes.flatMap((n) => {
      const field = (tag: string) =>
        n.getElementsByTagName(tag)[0]?.textContent ?? "";
      const url = field("link").trim();
      if (
        !/^https:\/\/(www\.)?(gcores\.com|animenewsnetwork\.com)\//i.test(url)
      )
        return [];
      return [
        {
          id: url,
          title: plain(field("title"), 140),
          url,
          body: plain(field("description"), 1000),
        },
      ];
    });
    if (!items.length) throw Error("empty_feed");
    if (q.action === "search" && q.query)
      items = items.filter((item) =>
        (item.title + item.body).toLowerCase().includes(q.query!.toLowerCase()),
      );
    return { level: "rss_excerpt", status: "ok", items: items.slice(0, 8) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unavailable";
    return {
      level: "unavailable",
      status: /^[a-z_\d-]{1,45}$/.test(message) ? message : "network_error",
      items: [],
    };
  }
}
