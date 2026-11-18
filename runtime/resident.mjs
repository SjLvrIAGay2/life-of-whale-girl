import { routes } from "../config/routes.ts";
import { numbers } from "../config/numbers.ts";
import { links } from "../config/links.ts";
import { env, sqlite } from "./bindings.mjs";
import { inventory,residentBackups,restoreDrill } from "./recovery.mjs";
import { failureReason } from "../lib/diagnostics";
import { createServer } from "node:http";
import { randomBytes, sign } from "node:crypto";
import { readFileSync,readdirSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { GET, POST } from "../app/api/v1/life/[operation]/route";
import { GET as picture } from "../app/picture/[id]/route";
import { all, one, stmt, house, publicHome, tickLock, unlock, commit } from "../db";
import { safeOrigin, same } from "../lib/security";
import { activityArchive,legacyReading } from "../lib/activities";
import { visibleWorkSteps } from "../lib/works";
import { nextPersonalPlan } from "../lib/personal-plans";
import { processPainting, tick } from "../lib/life";
import { initializeCabin } from "../lib/cabin-store";
import { upgradeExperience } from "../lib/experience-migration";
import { nextBell } from "../lib/sleep";
import { qqToken, acceptQQ, deliverQQ, nextQQDelivery, recoverQQDeliveries } from "../lib/qq";
import { nextFriendPromise, nextInbox } from "../lib/conversation";
import { indexMemories } from "../lib/semantic-memory";
import { runQQ } from "../scripts/qq-bridge.mjs";
const exists = sqlite
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='resident'",
  )
  .get();
const upgrading=!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='activities'").get();
const beforeMigration=upgrading?inventory(sqlite):null;
if (!exists) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const s of ["0000_medical_liz_osborn", "0001_whale_home"])
      sqlite.exec(
        readFileSync(
          new URL("./drizzle/" + s + ".sql", import.meta.url),
          "utf8",
        ),
      );
    sqlite.exec("COMMIT");
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }
}
const drawingColumns = sqlite.prepare("PRAGMA table_info(drawings)").all();
if (!drawingColumns.some((column) => column.name === "png"))
  sqlite.exec(
    readFileSync(new URL("./drizzle/0002_drawing_png.sql", import.meta.url), "utf8"),
  );
if (!sqlite.prepare("PRAGMA table_info(messages)").all().some((column) => column.name === "voice"))
  sqlite.exec(readFileSync(new URL("./drizzle/0003_message_voice.sql", import.meta.url), "utf8"));
if (!sqlite.prepare("PRAGMA table_info(messages)").all().some((column) => column.name === "handled_at")) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0004_social_chat.sql", import.meta.url), "utf8"));
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}
if (!sqlite.prepare("PRAGMA table_info(messages)").all().some(column=>column.name==="reviewed")) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0005_grounded_memory.sql",import.meta.url),"utf8"));
    sqlite.exec("COMMIT");
  } catch(error) { sqlite.exec("ROLLBACK"); throw error; }
}
if (!sqlite.prepare("PRAGMA table_info(messages)").all().some(column => column.name === "image_count")) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0006_chat_context.sql", import.meta.url), "utf8"));
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}
if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_rules'").get()) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0007_companion.sql", import.meta.url), "utf8"));
    sqlite.exec("COMMIT");
  } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
}
if(!sqlite.prepare("PRAGMA table_info(art_jobs)").all().some(col=>col.name==="promise_id"))
  sqlite.exec(readFileSync(new URL("./drizzle/0008_drawing_commitment.sql",import.meta.url),"utf8"));
function migrateActivities() {
  for(const row of sqlite.prepare("SELECT m.id,m.made,m.body,m.source,m.category,m.details FROM memories m WHERE m.scope='public' AND m.kind='observation' AND m.hidden=0 AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.id=m.id)").iterate()) {
    const detail=legacyReading(row);
    if(detail) sqlite.prepare("INSERT INTO activities VALUES(?,?,?,'detail',?)").run(row.id,row.made,row.made,JSON.stringify({detail}));
  }
}
if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='activities'").get()) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0009_resident_life.sql",import.meta.url),"utf8"));
    sqlite.exec("COMMIT");
  } catch(error) {sqlite.exec("ROLLBACK");throw error;}
}
if(upgrading && !process.argv.includes("--import")) sqlite.prepare("INSERT OR REPLACE INTO channel_state VALUES('health/migration',?)").run(
  JSON.stringify({time:Date.now(),status:"ok",before:beforeMigration,after:inventory(sqlite)}));
if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='sync_plan_promise'").get()) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0010_reading_and_plans.sql",import.meta.url),"utf8"));
    sqlite.exec("COMMIT");
  } catch(error) { sqlite.exec("ROLLBACK"); throw error; }
}
if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='cabin_items'").get()) {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.exec(readFileSync(new URL("./drizzle/0011_cabin_objects.sql",import.meta.url),"utf8"));
    sqlite.exec("COMMIT");
  } catch(error) {sqlite.exec("ROLLBACK");throw error;}
}
async function migrateCabin() {
  if(!sqlite.prepare("SELECT 1 FROM resident WHERE id='whale' AND json_extract(state,'$.cabinVersion') IS NOT 1").get()) return;
  const token=await tickLock(Date.now());
  if(!token) {
    if(process.argv.includes("--migrate-only")) throw Error("常驻端仍在处理动作，稍后重试迁移");
    return;
  }
  try {
    const {state}=await house();
    if(state.cabinVersion!==1) await commit(token,state,await initializeCabin(state));
  } finally {await unlock(token);}
}
if (process.argv.includes("--migrate-only")) {
  if (sqlite.prepare("SELECT 1 FROM resident WHERE id='whale' AND json_extract(state,'$.experienceVersion') IS NOT 1").get()) {
    const lock=await tickLock(Date.now());
    if (!lock) throw Error("常驻端仍在处理动作，稍后重试迁移");
    try {
      const {state}=await house();
      if (state.experienceVersion!==1) {
        const repairs=await upgradeExperience(state);
        await commit(lock,state,repairs);
      }
    } finally { await unlock(lock); }
  }
  await migrateCabin();
  sqlite.close();
  process.exit(0);
}
if (process.argv.includes("--import")) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const tables = JSON.parse(Buffer.concat(chunks));
  if (sqlite.prepare("SELECT 1 FROM resident LIMIT 1").get())
    throw Error("Import requires an empty resident database");
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const t of [
      "resident",
      "memories",
      "messages",
      "deliveries",
      "daily_posts",
      "drawings",
      "agent_versions",
      "channel_state",
      "memory_rules", "chat_images", "works", "work_steps", "art_jobs", "reply_turns", "model_usage", "memory_vectors","activities","play_saves","site_editions",
      "cabin_types","cabin_items","cabin_requests","cabin_previews",
    ]) {
      const fields = sqlite
        .prepare("PRAGMA table_info(" + t + ")")
        .all()
        .map((x) => x.name);
      const save = sqlite.prepare(
        (t==="cabin_items"?"INSERT OR REPLACE INTO ":"INSERT INTO ") +
          t +
          "(" +
          fields.join(",") +
          ") VALUES(" +
          fields.map(() => "?").join(",") +
          ")",
      );
      for (const row of tables[t] ?? []) {
        if (
          t === "channel_state" &&
          !/^(studio\/|qq-config$|friend\/|owner-peer$|mcp\/|proposal\/|chat-contact\/|chat-quiet\/|contact-prefs\/|qq-promises\/|occasion-receipt\/|episode-receipt\/|followup-receipt\/|standalone-art\/|art-plan\/|promise-check\/)/.test(row.id)
        )
          continue;
        if (t === "resident") {
          row.lease = null;
          row.lease_until = 0;
        }
        if (t === "drawings" && Array.isArray(row.png))
          row.png = Buffer.from(row.png);
        if (t === "messages") { row.voice ??= 0; row.seq ??= 1; row.reviewed ??= 0; row.image_count ??= 0; row.withheld ??= 0; row.withdrawn ??= 0; }
        if (t === "memories") row.hidden ??= 0;
        if (t === "chat_images" && Array.isArray(row.bytes)) row.bytes = Buffer.from(row.bytes);
        if (t === "memory_vectors" && Array.isArray(row.vector)) row.vector = Buffer.from(row.vector);
        if (t === "deliveries") row.next_try ??= 0;
        save.run(...fields.map((k) => row[k] ?? null));
      }
    }
    sqlite.exec("UPDATE messages SET handled_at=made WHERE side='in' AND handled_at IS NULL AND (EXISTS(SELECT 1 FROM memories WHERE id='chat-in-'||messages.id) OR EXISTS(SELECT 1 FROM messages r WHERE r.reply_to=messages.id))");
    migrateActivities();
    const imported=inventory(sqlite);
    const objectTables=["cabin_types","cabin_items","cabin_requests","cabin_previews"].filter(k=>Array.isArray(tables[k]));
    for(const key of ["messages","memories","drawings","works","work_steps","chat_images","memory_rules","art_jobs",...objectTables]) {
      if(imported[key] !== (tables[key]?.length??0)) throw Error("迁移后数量不匹配 "+key);
    }
    sqlite.prepare("INSERT OR REPLACE INTO channel_state VALUES('health/migration',?)").run(JSON.stringify({
      time:Date.now(),status:"ok",before:beforeMigration??{},after:imported,sourceRows:{
        messages:tables.messages?.length??0,drawings:tables.drawings?.length??0,works:tables.works?.length??0}}));
    sqlite.exec("COMMIT");
    console.log(
      "Migrated resident, messages, drawings, credentials and paired friends.",
    );
  } catch (e) {
    sqlite.exec("ROLLBACK");
    throw e;
  }
  await migrateCabin();
  sqlite.close();
  process.exit(0);
}
await house();
await migrateCabin();
const site = env.WHALE_ORIGIN;
if (new URL(site).protocol !== "https:")
  throw Error("A HTTPS origin is required");
async function publicSnapshot(cursors) {
  const base=cursors??{posts:0,art:0,history:0};
  const {state}=await house();
  const pageSize=96;
  const [home,posts,art,history,series,archive]=await Promise.all([publicHome(),
    all("SELECT rowid AS position,day,body,made,sources,evidence FROM daily_posts WHERE rowid>? ORDER BY rowid LIMIT ?",base.posts,pageSize+1),
    all("SELECT rowid AS position,id,made,title FROM drawings WHERE scope='public' AND rowid>? ORDER BY rowid LIMIT ?",base.art,pageSize+1),
    all(`SELECT s.* FROM ${visibleWorkSteps} s JOIN works w ON w.id=s.work WHERE w.scope='public' AND w.state<>'hidden' AND s.position>? ORDER BY s.position LIMIT ?`,base.history,pageSize+1),
    all("SELECT id,title FROM works WHERE scope='public' AND state<>'hidden' ORDER BY updated DESC"),
    activityArchive(state,base.activities??0,48),
  ]);
  const more=archive.more || [posts,art,history].some(items=>items.length>pageSize);
  for(const items of [posts,art,history]) if(items.length>pageSize) items.pop();
  return {more,home:{...home,activityArchive:archive.items,series,posts:posts.map(p=>({...p,sources:JSON.parse(p.sources),evidence:JSON.parse(p.evidence)})),art,history,
    cursors:{activities:archive.cursor,posts:posts.at(-1)?.position??base.posts,art:art.at(-1)?.position??base.art,history:history.at(-1)?.position??base.history}}};
}
const mirrorPrivate = readFileSync(env.WHALE_MIRROR_PRIVATE);
const saveBackup = residentBackups(sqlite, env.WHALE_DB);
function healthRecord(name,data) {
  return stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)","health/"+name,JSON.stringify({time:Date.now(),...data})).run();
}
async function backupResident(force=false) {
  try {const saved=await saveBackup(force); if(saved) await healthRecord("backup",{status:"ok",...saved});}
  catch(error){await healthRecord("backup",{status:"error",detail:failureReason(error)});throw error;}
}
function reportFailure(operation, error) {
  const detail = failureReason(error);
  console.error(JSON.stringify({ time: new Date().toISOString(), operation, detail }));
  return detail;
}
async function sendMirror(body) {
  const ts = String(Date.now());
  const signature = sign(null, Buffer.from(ts + "\n" + body), mirrorPrivate).toString("hex");
  const r = await fetch(site + routes.mirror, {
    method: "POST",
    redirect: "error",
    headers: {
      "x-whale-timestamp": ts,
      "x-whale-signature": signature,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw Error("Mirror HTTP " + r.status);
  return r.json();
}
let mirrorBase=null,lastBeat=0,
  mirroring,
  dirty = false;
async function mirror() {
  dirty = true;
  if (mirroring) return mirroring;
  mirroring = (async () => {
    while (dirty) {
      dirty = false;
      const {revision,state}=await house();
      const epoch=state.shareEpoch??"initial";
      if(mirrorBase && mirrorBase.epoch!==epoch) mirrorBase=null;
      if(mirrorBase?.revision===revision && Date.now()-lastBeat<60000) continue;
      if(mirrorBase?.revision===revision) {
        const result=await sendMirror(JSON.stringify({heartbeat:mirrorBase}));
        if(result.reset) {mirrorBase=null;dirty=true;continue;}
        if(result.ok!==true) throw Error("Mirror heartbeat failed");
        lastBeat=Date.now();await healthRecord("mirror",{status:"ok",revision});continue;
      }
      let base=mirrorBase,transfer=null;
      do {
        const {home,more} = await publicSnapshot(base?.cursors);
        // A multi-page transfer represents one revision. Restart if the actor changed it while we were uploading.
        if(home.revision!==revision || (await house()).revision!==revision) {mirrorBase=null;dirty=true;break;}
        if(more && !transfer) transfer=randomBytes(16).toString("hex");
        const body=JSON.stringify({home,base,...(transfer?{transfer,more}:{})});
        let response=await sendMirror(body);
        if(response.missing?.length) {
          for (const id of response.missing) {
            const row = await one("SELECT svg,png FROM drawings WHERE scope='public' AND id=?",id);
            if (!row) throw Error("Unknown public drawing");
            const drawing = row.png ? {id,png:Buffer.from(row.png).toString("base64")} : {id,svg:row.svg};
            await sendMirror(JSON.stringify({ drawing }));
          }
          response = await sendMirror(body);
        }
        if(response.reset) {
          if(!mirrorBase) throw Error("Archive transfer lost its staging copy");
          mirrorBase=null;dirty=true;break;
        }
        if(response.ok!==true || (more && response.staged!==true)) throw Error("Public archive page was not accepted");
        base={revision:home.revision,cursors:home.cursors,epoch};
        if(more) continue;
        mirrorBase=base;lastBeat=Date.now();
        await healthRecord("mirror",{status:"ok",revision:home.revision});
        break;
      } while(!closed);
    }
  })()
    .catch((error) => healthRecord("mirror",{status:"error",detail:reportFailure("public_sync", error)}))
    .finally(() => {
      mirroring = undefined;
    });
  return mirroring;
}
let deliveryPump;
function deliverInBackground() {
  if(deliveryPump) return;
  deliveryPump=deliverQQ().catch(error=>reportFailure("qq_delivery",error)).finally(async()=>{
    deliveryPump=undefined;
    if(!closed && (await nextQQDelivery())?.due!=null) after(1500);
  }).catch(error=>reportFailure("qq_schedule",error));
}
async function selfTurn() {
  let outcome;
  try { outcome = await tick("clock"); }
  finally { deliverInBackground(); }
  await stmt(
    "INSERT OR REPLACE INTO channel_state VALUES('clock-health',?)",
    JSON.stringify({ time: Date.now(), status: outcome.status, host: "mac" }),
  ).run();
  void backupResident().catch((error) => { reportFailure("backup", error); });
  void mirror();
  return outcome;
}
let timer,
  timerAt = Infinity,
  closed = false,
  active = false,
  requested = false;
function after(ms) {
  if (closed) return;
  const due = Date.now() + Math.max(1200, ms);
  if (timerAt <= due) return;
  clearTimeout(timer);
  timerAt = due;
  timer = setTimeout(() => { timerAt = Infinity; void loop(); }, due - Date.now());
}
async function loop() {
  if (active) {
    requested = true;
    return;
  }
  active = true;
  let delay = 45000;
  try {
    const outcome = await selfTurn(),
      now = Date.now(),
      { state } = await house();
    const planDue=state.mode==="awake" ? await nextPersonalPlan() : Infinity;
    const next = state.mode === "asleep" ? state.wakeAt : Math.min(state.nextAt,planDue);
    const inbox = await nextInbox(undefined,state.mode==="asleep");
    const delivery = await nextQQDelivery();
    const sleepWork = state.mode==="asleep" && sqlite.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM messages WHERE reviewed=0 AND side='in' AND handled_at IS NOT NULL)
      OR EXISTS(SELECT 1 FROM memories WHERE kind='promise' AND scope LIKE 'chat:%' AND topic IS NULL AND resolved=0)`).get();
    const promise = state.mode === "awake" && !inbox ? await nextFriendPromise() : null;
    // tick waits for the rest of an incoming turn before attempting other activity.
    const nextWork = Math.min(inbox?.due ?? Math.min(next || now + 45000, promise?.due ?? Infinity),
      state.mode==="asleep"?state.wakeAt:Infinity);
    delay = outcome.status === "busy" ? 5000 :
      Math.max(1200, Math.min(nextWork, nextBell(state), delivery?.due ?? Infinity, sleepWork ? now+3000 : Infinity) - now);
  } catch (error) {
    const detail = reportFailure("clock", error);
    await stmt(
      "INSERT OR REPLACE INTO channel_state VALUES('clock-health',?)",
      JSON.stringify({ time: Date.now(), status: "error", host: "mac", detail }),
    ).run().catch((dbError) => { reportFailure("clock_health", dbError); });
  } finally {
    active = false;
    if (requested) {
      requested = false;
      delay = 1500;
    }
    after(delay);
  }
}
const qqController = new AbortController();
const qqDriver = async (payload) => {
  if (payload.action === "gateway") {
    const token = await qqToken();
    const r = await fetch(links.defaults.qqGateway, {
      headers: { Authorization: "QQBot " + token },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("QQ gateway " + r.status);
    await healthRecord("qq_gateway",{status:"ok"});
    return { url: (await r.json()).url, token };
  }
  if (payload.action === "ready") {
    await stmt(
      "INSERT OR REPLACE INTO channel_state VALUES('qq-ready',?)",
      String(Date.now()),
    ).run();
    return {};
  }
  if (payload.action === "event") {
    await acceptQQ(payload.event);
    after(2200);
    return {};
  }
};
async function serve(req) {
  const u = new URL(req.url),
    op = u.pathname.split("/").at(-1);
  if (!safeOrigin(req))
    return Response.json({ error: "来源不匹配" }, { status: 403 });
  const editor =
    env.WHALE_EDITOR_TOKEN &&
    same(
      req.headers.get("authorization") ?? "",
      "Bearer " + env.WHALE_EDITOR_TOKEN,
    );
  if(op==="health" && req.method==="POST" && editor) {
    const {probe}=await req.clone().json();
    if(probe==="restore") {
      await backupResident(true);
      const dir=join(dirname(dirname(env.WHALE_DB)),"recovery");
      const name=readdirSync(dir).filter(x=>/^resident-auto-.*-r\d+\.sqlite$/.test(x)).sort().at(-1);
      if(!name) return Response.json({error:"尚无可演练的备份"},{status:409});
      const result=restoreDrill(join(dir,name));await healthRecord("restore",result);return Response.json(result);
    }
    if(probe==="mirror") {lastBeat=0;await mirror();return Response.json({result:JSON.parse((await one("SELECT value FROM channel_state WHERE id='health/mirror'")).value)});}
  }
  let response;
  if (u.pathname.startsWith(routes.picture))
    response = await picture(req, { params: Promise.resolve({ id: op }) });
  else if (
    u.pathname === routes.life + op && [
      "admin",
      "clock","studio","home","activity","work-history",
      "health",
      "qq-config",
      "qq-pair",
      "mcp",
      "setting",
      "room",
      "name",
      "recall",
      "media",
    ].includes(op)
  )
    response = await (req.method === "GET" ? GET : POST)(req, {
      params: Promise.resolve({ operation: op }),
    });
  else return Response.json({ error: "未知入口" }, { status: 404 });
  if (req.method === "POST" && response.ok) {
    void mirror();
    if (["clock","setting", "name", "room"].includes(op)) after(1500);
  }
  return response;
}
const server = createServer(async (r, s) => {
  try {
    if (!["GET", "POST"].includes(r.method)) {
      s.writeHead(405);
      s.end();
      return;
    }
    const chunks = [];
    let n = 0;
    const limit = 90000;
    for await (const x of r) {
      n += x.length;
      if (n > limit) {
        s.writeHead(413);
        s.end();
        return;
      }
      chunks.push(x);
    }
    const headers = new Headers();
    for (const k of [
      "authorization",
      "x-whale-clock",
      "origin",
      "accept",
      "content-type",
    ])
      if (typeof r.headers[k] === "string") headers.set(k, r.headers[k]);
    const req = new Request(new URL(r.url, site), {
      method: r.method,
      headers,
      ...(n ? { body: Buffer.concat(chunks) } : {}),
    });
    const response = await serve(req);
    s.writeHead(response.status, {
      ...Object.fromEntries(response.headers),
      "Cache-Control": "private, no-store",
    });
    s.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    s.writeHead(503, { "Content-Type": "application/json" });
    s.end(JSON.stringify({ error: "我的小屋暂时忙，请稍后再试。" }));
  }
});
server.listen(Number(env.WHALE_AGENT_PORT || numbers.defaults.residentPort), links.defaults.loopback);
await house();
await recoverQQDeliveries();
await backupResident();
void mirror();
void runQQ(qqDriver, qqController.signal).catch(() => {});
const indexTimer=setInterval(()=>void indexMemories().catch(error=>reportFailure("memory_index",error)),15000);
let artPump;
const artTimer=setInterval(()=>{
  if(artPump) return;
  artPump=processPainting().then(state=>{
    if(state==="done") {deliverInBackground();void mirror();after(1500);}
  }).catch(error=>reportFailure("art_queue",error)).finally(()=>{artPump=undefined;});
},2500);
void indexMemories().catch(error=>reportFailure("memory_index",error));
after(2000);
const mirrorTimer = setInterval(() => {
  void mirror();
  void backupResident().catch((error) => { reportFailure("backup", error); });
}, 60000);
for (const e of ["SIGTERM", "SIGINT"])
  process.on(e, () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(mirrorTimer);
    clearInterval(indexTimer);
    clearInterval(artTimer);
    qqController.abort();
    server.close();
    setTimeout(async () => {
      try { await backupResident(); } catch (error) { reportFailure("shutdown_backup", error); }
      process.exit(0);
    }, 700);
  });
