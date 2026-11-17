import { createServer, request as proxyRequest } from "node:http";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  createReadStream,
  statSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, extname, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verify } from "node:crypto";
import { archivePage,publicSummary,rss } from "./public-archive.mjs";
import { firstState } from "../content/initial.ts";
import { defaultSite } from "../content/site.ts";
const root = join(dirname(fileURLToPath(import.meta.url)), "static"),
  storage = process.env.WHALE_PUBLIC_STATE;
mkdirSync(storage, { recursive: true, mode: 0o700 });
const snapshot = join(storage, "home.json"),
  staging=join(storage,"archive-in-progress.json"),
  heartbeat=join(storage,"last-sync.json"),
  images = join(storage, "drawings");
mkdirSync(images, { recursive: true, mode: 0o700 });
const escape = (s) =>
  String(s).replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c],
  );
const ct = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
let cached;
const listeners=new Set();
const revisionEvent=revision=>"data: "+revision+"\n\n";
function getHome(){
  if(!cached) {
    if (!existsSync(snapshot)) {
      const { name, mode, activity, room } = firstState(0);
      return { name, mode, activity, room, revision: 0, site: defaultSite, activities: [], posts: [], art: [] };
    }
    cached=JSON.parse(readFileSync(snapshot,"utf8"));
    if(existsSync(heartbeat)) {
      const beat=JSON.parse(readFileSync(heartbeat,"utf8"));
      if(beat.revision===cached.revision && beat.time>Number(cached.syncedAt??0)) cached.syncedAt=beat.time;
    }
  }
  return cached;
}
function reply(res, status, type, data) {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(data);
}
function assetUrl(name) {
  const stamp = statSync(join(root, name), { bigint: true }).mtimeNs.toString(36);
  return "/" + name + "?v=" + stamp;
}
function streamFile(res, f, type) {
  try {
    if (!statSync(f).isFile()) return false;
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...(type === "image/svg+xml"
        ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
        : {}),
    });
    createReadStream(f).pipe(res);
    return true;
  } catch {
    return false;
  }
}
const publicPort = Number(process.env.PORT || 19531);
const siteOrigin = process.env.WHALE_ORIGIN || `http://127.0.0.1:${publicPort}`;
const mirrorPublic = process.env.WHALE_MIRROR_PUBLIC ? readFileSync(process.env.WHALE_MIRROR_PUBLIC) : null;
const forwardPort = process.env.WHALE_FORWARD_PORT || (mirrorPublic ? "19532" : "");
const pictureId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function savePicture(drawing) {
  if (!pictureId.test(drawing?.id)) return false;
  let file, data;
  if (typeof drawing.png === "string") {
    data = Buffer.from(drawing.png, "base64");
    if (data.toString("hex", 0, 8) !== "89504e470d0a1a0a") return false;
    file = join(images, drawing.id + ".png");
  } else {
    data = drawing.svg;
    if (typeof data !== "string" || !data.startsWith("<svg")) return false;
    file = join(images, drawing.id + ".svg");
  }
  writeFileSync(file + ".tmp", data, { mode: 0o600 });
  renameSync(file + ".tmp", file);
  return true;
}
createServer(async (req, res) => {
  try {
    const u = new URL(req.url, siteOrigin);
    if(req.method==="GET" && u.pathname==="/api/v1/life/revisions") {
      const revision=getHome().revision;
      res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store","X-Accel-Buffering":"no"});
      res.write(revisionEvent(revision));
      listeners.add(res);
      const heartbeat=setInterval(()=>res.write(": heartbeat\n\n"),30000);
      res.on("close",()=>{clearInterval(heartbeat);listeners.delete(res);});
      return;
    }
    if (u.pathname === "/internal/mirror" && req.method === "POST") {
      if (!mirrorPublic) return reply(res, 403, "text/plain", "Forbidden");
      const ts = req.headers["x-whale-timestamp"] ?? "",
        sig = req.headers["x-whale-signature"] ?? "";
      if (
        !/^\d{13}$/.test(ts) ||
        Math.abs(Date.now() - Number(ts)) > 120000 ||
        !/^([a-f\d]{2}){64}$/i.test(sig)
      )
        return reply(res, 403, "text/plain", "Forbidden");
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 24 * 1024 * 1024)
          return reply(res, 413, "text/plain", "Too large");
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks);
      if (
        !verify(
          null,
          Buffer.concat([Buffer.from(ts + "\n"), raw]),
          mirrorPublic,
          Buffer.from(sig, "hex"),
        )
      )
        return reply(res, 403, "text/plain", "Forbidden");
      const data = JSON.parse(raw);
      if(data.heartbeat) {
        const old=existsSync(snapshot)?getHome():null;
        if(!old || data.heartbeat.revision!==old.revision || ["posts","art","history","activities"].some(k=>old.cursors?.[k]!==data.heartbeat.cursors?.[k]))
          return reply(res,200,"application/json",'{"reset":true}');
        old.syncedAt=Math.max(old.syncedAt??0,Number(ts));
        writeFileSync(heartbeat+".tmp",JSON.stringify({revision:old.revision,time:old.syncedAt}),{mode:0o600});renameSync(heartbeat+".tmp",heartbeat);
        return reply(res,200,"application/json",'{"ok":true}');
      }
      if (data.drawing) {
        if (!savePicture(data.drawing))
          return reply(res, 400, "text/plain", "Invalid drawing");
        return reply(res, 200, "application/json", '{"ok":true}');
      }
      if (
        !data.home?.name ||
        !Number.isSafeInteger(data.home.revision) || data.home.revision < 0 ||
        !Array.isArray(data.home.room) ||
        !Array.isArray(data.home.posts) ||
        !Array.isArray(data.home.art) ||
        !data.home.art.every((a) => pictureId.test(a.id))
      )
        return reply(res, 400, "text/plain", "Invalid");
      if (existsSync(snapshot) && data.home.revision < getHome().revision)
        return reply(res, 409, "text/plain", "Older public revision");
      if(data.transfer && !/^[a-f0-9]{32}$/.test(data.transfer)) return reply(res,400,"text/plain","Invalid transfer");
      const staged=data.transfer && existsSync(staging)?JSON.parse(readFileSync(staging,"utf8")):null;
      if(data.base) {
        const old=staged && staged.transfer===data.transfer?staged.home:existsSync(snapshot)?getHome():null;
        if(!old || old.revision!==data.base.revision || ["posts","art","history","activities"].some(k=>old.cursors?.[k]!==data.base.cursors?.[k]))
          return reply(res,200,"application/json",'{"reset":true}');
        for(const [field,key] of [["posts","day"],["art","id"],["history","id"],["activityArchive","id"]]) {
          const rows=new Map((old[field]??[]).map(x=>[x[key],x]));
          for(const x of data.home[field]??[]) rows.set(x[key],x);
          data.home[field]=[...rows.values()];
        }
      }
      if(data.home.activityArchive) {
        const rows=new Map(data.home.activityArchive.map(a=>[a.id,a]));
        for(const a of data.home.activities??[]) rows.set(a.id,a);
        data.home.activityArchive=[...rows.values()].sort((a,b)=>b.made-a.made);
      }
      data.home.posts.sort((a,b)=>b.day.localeCompare(a.day));
      data.home.art.sort((a,b)=>b.made-a.made || b.id.localeCompare(a.id));
      data.home.syncedAt=Number(ts);
      for (const picture of data.drawings ?? []) {
        if (
          !data.home.art.some((a) => a.id === picture.id) ||
          !savePicture(picture)
        )
          return reply(res, 400, "text/plain", "Invalid");
      }
      const missing = data.home.art.map((a) => a.id).filter(
        (id) => !existsSync(join(images, id + ".png")) && !existsSync(join(images, id + ".svg")),
      );
      if (missing.length)
        return reply(res, 200, "application/json", JSON.stringify({ missing }));
      if(data.transfer && data.more) {
        writeFileSync(staging+".tmp",JSON.stringify({transfer:data.transfer,home:data.home}),{mode:0o600});
        renameSync(staging+".tmp",staging);
        return reply(res,200,"application/json",'{"ok":true,"staged":true}');
      }
      writeFileSync(snapshot + ".tmp", JSON.stringify(data.home), {
        mode: 0o600,
      });
      renameSync(snapshot + ".tmp", snapshot);
      rmSync(staging,{force:true});
      cached=data.home;
      for(const viewer of listeners) viewer.write(revisionEvent(cached.revision));
      return reply(res, 200, "application/json", '{"ok":true}');
    }
    if (u.pathname === "/api/v1/life/home" && req.method === "GET")
      return reply(
        res,
        200,
        "application/json; charset=utf-8",
        JSON.stringify(publicSummary(archivePage(getHome(),u.searchParams))),
      );
    if(u.pathname==="/feed.xml" && req.method==="GET") return reply(res,200,"application/rss+xml; charset=utf-8",rss(getHome(),siteOrigin));
    if(u.pathname==="/api/v1/life/work-history" && req.method==="GET" && !u.searchParams.has("private")) {
      const id=u.searchParams.get("id"),before=Number(u.searchParams.get("before"))||Number.MAX_SAFE_INTEGER,h=getHome();
      if(u.searchParams.has("art")) {
        const art=u.searchParams.get("art");
        const work=h.art.some(a=>a.id===art) && h.series?.find(w=>h.history?.some(s=>s.work===w.id && s.art===art));
        if(!work) return reply(res,200,"application/json","null");
        const steps=h.history.filter(s=>s.work===work.id).sort((a,b)=>b.position-a.position);
        const refs=new Set(steps.map(s=>s.evidence).filter(Boolean));
        const days=h.posts.filter(p=>(p.evidence??[]).some(e=>refs.has(e))).slice(0,8).map(p=>p.day);
        return reply(res,200,"application/json",JSON.stringify({...work,steps:steps.slice(0,32),days}));
      }
      const steps=h.series?.some(w=>w.id===id)?(h.history??[]).filter(s=>s.work===id && s.position<before).sort((a,b)=>b.position-a.position).slice(0,33):[];
      return reply(res,200,"application/json",JSON.stringify({steps:steps.slice(0,32),more:steps.length>32}));
    }
    if (u.pathname.startsWith("/picture/") && req.method === "GET") {
      const id = u.pathname.slice(9);
      if (
        pictureId.test(id) &&
        getHome().art.some((a) => a.id === id) &&
        (streamFile(res, join(images, id + ".png"), "image/png") ||
          streamFile(res, join(images, id + ".svg"), "image/svg+xml"))
      )
        return;
    }
    if(u.pathname==="/api/v1/life/activity" && req.method==="GET") {
      const item=(getHome().activityArchive??getHome().activities??[]).find(a=>a.id===u.searchParams.get("id"));
      return reply(res,item?200:404,"application/json; charset=utf-8",JSON.stringify(item??{error:"没有这次公开活动"}));
    }
    if (
      /^\/api\/v1\/life\/(admin|health|qq-config|qq-pair|mcp|setting|room|name|recall|media|studio)$/.test(u.pathname)
    ) {
      if (!forwardPort) return reply(res, 503, "application/json; charset=utf-8", JSON.stringify({ error: "常驻端尚未连接。" }));
      const headers = {};
      for (const k of [
        "authorization",
        "content-type",
        "origin",
        "accept",
      ])
        if (req.headers[k]) headers[k] = req.headers[k];
      const request = proxyRequest(
        {
          hostname: "127.0.0.1",
          port: Number(forwardPort),
          path: u.pathname + u.search,
          method: req.method,
          headers,
          timeout: 110000,
        },
        (r) => {
          const h = {};
          for (const k of [
            "content-type",
            "cache-control",
            "content-security-policy",
            "x-content-type-options",
          ])
            if (r.headers[k]) h[k] = r.headers[k];
          res.writeHead(r.statusCode, h);
          r.pipe(res);
        },
      );
      request.on("timeout", () => request.destroy());
      request.on("error", () => {
        if (!res.headersSent)
          reply(
            res,
            503,
            "application/json",
            JSON.stringify({ error: "常驻端暂时离线，请稍后再试。" }),
          );
      });
      req.pipe(request);
      return;
    }
    if(u.pathname.startsWith("/api/")) return reply(res,404,"application/json",'{"error":"入口不可用"}');
    if(req.method!=="GET" && req.method!=="HEAD") return reply(res,405,"text/plain","Method not allowed");
    const parts=u.pathname.split("/").filter(Boolean), slug=parts[0]??"home";
    if(!extname(u.pathname) && !["internal","picture"].includes(slug)) {
      const h=getHome(), pages=h.site?.pages??[{slug:"home"},{slug:"days"},{slug:"journal"},{slug:"gallery"}];
      const page=pages.find(p=>p.slug===slug);
      const entry=parts.length===2 && ((slug==="activity" && (h.activityArchive??h.activities)?.some(a=>a.id===parts[1])) ||
        (slug==="journal" && h.posts.some(p=>p.day===parts[1])));
      if(!(entry || (parts.length<=1 && (page || ["manage","preview"].includes(slug)) && u.pathname!=="/home")))
        return reply(res,404,"text/plain; charset=utf-8","找不到这个页面");
      return reply(
        res,
        200,
        "text/html; charset=utf-8",
        '<!doctype html><html lang="zh-CN" data-host="mac"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="我是鲸鱼娘。这里是我的小屋、动态和画册。"><title>' +
          escape(h.name) +
          '</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="icon" href="/whale.svg"><link rel="stylesheet" href="' + assetUrl("site.css") + '"></head><body><div id="root"></div><script type="module" src="' + assetUrl("site.js") + '"></script></body></html>',
      );
    }
    const file = resolve(root, "." + decodeURIComponent(u.pathname)),
      type = ct[extname(file)];
    if (file.startsWith(root + sep) && type && streamFile(res, file, type))
      return;
    reply(res, 404, "text/plain; charset=utf-8", "找不到这个页面");
  } catch {
    if (!res.headersSent)
      reply(
        res,
        503,
        "application/json",
        JSON.stringify({ error: "小站暂时无法读取数据" }),
      );
    else res.end();
  }
}).listen(publicPort, "127.0.0.1");
