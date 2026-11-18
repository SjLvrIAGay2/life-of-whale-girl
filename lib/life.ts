import { formatText } from "../config/options";
import { moveIn } from "../config/resident-profile";
import { configReceipts } from "../config/texts/receipts";
import { lifeErrors } from "../config/texts/errors.ts";
import { texts } from "../config/texts";
import { drawingReview, storyboard, sleepReview, journal } from "../config/prompts/tasks";
import { numbers } from "../config/numbers";
import { configure, configCommand } from "./configuration";
import { chatInstructions } from "./chat-instructions";
import { activityHelp, activityInstructions } from "./activity-instructions";
import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { chatContacts, identityFor, inboxWhere, interactionContext, nextInbox, nextFriendPromise, readBurst, relatedPeers, type ChatContact } from "./conversation";
import { chatContext, chatMemoryText, chatRecallCue, fitChatPrompt } from "./chat-context";
import { z } from "zod";
import {
  dayOf,
  hourOf,
  initialSelf,
  residentId,
  type State,
} from "../content/initial";
import {
  all,
  db,
  commit,
  currentSetting,
  currentOverrides,
  house,
  memory,
  one,
  saveVersion,
  stmt,
  tickLock,
  unlock,
  type ChatLine,
  type Memory,
  type Setting,
} from "../db";
import { readActions, readingSources, historyCursor, isBiliAccountRead, sharedLink, type ReadRequest, type Observation } from "./media";
import { readWithDesk as readMedia } from "./media-bridge";
import { think } from "./model";
import { drawImage } from "./atelier";
import { actionProblem, failureReason } from "./diagnostics";
import { communitySticker, referenceChoices, stickerChoices } from "./community-art";
import { recipe, runRecipe, testRecipe, toolName } from "./toolbox";
import { cardContext, commitmentWrites, friendCard, profileWrites, planTiming, reviewFriendBatch, reviewLegacyPromise, shanghaiDate, type SourceLine } from "./friend-memory";
import { semanticHits } from "./semantic-memory";
import { contactPreferences,voicePreference } from "./contact-preferences";
import { turnImages } from "./chat-images";
import { avoidedTerms, mentionsAvoided, ruleVersion } from "./memory-control";
import { nextAnniversary, relationshipMood, sharedEntries, sharedWrites } from "./shared-memory";
import { artForConversation, attachReading, browseOwnWorks, deskWorks, editWork, findOwnWork, newWork, prepareWorkEdit, recoverWorkEvidence, workEvidenceChoices, workList, workStep, WorkInputError } from "./works";
import { cabinAction, cabinContext } from "./cabin";
import { arrangeFurniture, initializeCabin } from "./cabin-store";
import { gameKinds } from "./games";
import { endActivity, publicActivities, leisureContext, play, readExperience, record, recordObjectReading } from "./activities";
import { editSite, studioSchema } from "./studio";
import { publicHome } from "../db";
import { activityTrace, trace, workInputTrace } from "./telemetry";
import { beginSleep, isClockUpgrade, setAlarm, sleepContext, upgradeSleep, wakeBody } from "./sleep";
import { chatOutcome, finishAction, readingBookmark, receiptForModel, recoverLastAction, savedFailure, type Outcome } from "./action-result";
import { duePersonalPlans, planReading, readingCompletion, readingGoals, type ReadingTarget } from "./personal-plans";
import { browseActivityArchive } from "./action-archive";
import { personalReading, resumeRead } from "./reading-progress";
import { changeTitles, discoveryDesk, type DeskTitle } from "./discovery";
import { upgradeExperience } from "./experience-migration";
import { readingOutcome, sourceNames } from "../content/activity";
import { currentRest, restContext } from "./rest";
import { reflectionActivities, ReflectionInputError, reflectionTarget } from "./reflection";

const hour = 3600000;
const clip = (v: unknown, n = 600) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";
const siteScope = "public";
const privateScope = "self";
const planKinds=["read","room","draw","play","writing"];
const planEvidenceSql=`CASE WHEN ? IS NULL OR EXISTS(SELECT 1 FROM json_each(evidence) WHERE value=?)
  THEN evidence ELSE json_insert(evidence,'$[#]',?) END`;
const focusedRead=(q?:ReadRequest)=>q?.id && ["open","frames","subtitles","comments","image"].includes(q.action)
  ? {source:q.source,id:q.id,page:q.action==="comments"?undefined:q.page} : undefined;
const imports = (state:State) => ({
  overrides:state.config,
  biliCookie: env.BILI_COOKIE,
  heyCookie: env.HEYBOX_COOKIE,
});
export const moveSchema = z.object({
  operation: z.enum(["add", "move", "remove"]),
  kind: z.enum(["bed", "desk", "computer", "plant", "lamp", "shelf", "chair","alarm"]).optional(),
  id: z.string().max(60).optional(),
  x: z.number().min(4).max(96).optional(),
  y: z.number().min(35).max(99).optional(),
});
export async function arrange(state:State,raw:unknown) {
  if(raw==null) throw new z.ZodError([{code:"invalid_type",expected:"object",path:["move"],message:"整理小屋需要指定操作和家具"}]);
  return arrangeFurniture(state,moveSchema.parse(raw));
}
const mediaSchema = z.object({
  source: z.enum(readingSources),
  action: z.enum(readActions),
  query: z.string().max(numbers.defaults.mediaQueryChars).optional(),
  id: z.string().max(numbers.defaults.mediaIdChars).optional(),
  root: z.string().max(numbers.defaults.mediaRootChars).optional(),
  page: z.number().int().min(1).max(numbers.defaults.mediaPageMax).optional(),
  offset:z.number().int().min(0).max(numbers.defaults.mediaOffsetMax).optional(),
  cursor: historyCursor.optional(),
});
const actionSchema = z.object({
  action: z.enum([
    "config", "help",
    "rest",
    "read","change_titles",
    "draw",
    "room","object",
    "sleep","alarm","get_up",
    "rename",
    "plan",
    "resolve",
    "chat",
    "revise",
    "use_tool",
    "rollback",
    "use_mcp",
    "request_mcp",
    "work",
    "share_dream","play","share","reflect","journal","site","archive",
  ]),
  play:z.object({game:z.enum(gameKinds),op:z.enum(["start","look","move","pause","resume","restart","next"]),
    id:z.string().max(80).optional(),move:z.string().max(12).optional(),note:z.string().max(180).optional()}).optional(),
  config:configCommand.optional(),
  site:studioSchema.optional(),
  object:z.unknown().optional(),
  visibility:z.enum(["hidden","summary","detail"]).optional(),
  journal:z.enum(["write","skip","habit"]).optional(),
  everyDays:z.number().int().min(0).max(365).optional(),
  minutes: z.preprocess(v=>typeof v==="number" || (typeof v==="string" && v.trim()!=="") ?
    (Number.isFinite(Number(v)) ? Math.min(720,Math.max(1,Math.round(Number(v)))) : undefined) : undefined,z.number().optional()),
  readingGoal:z.enum(readingGoals).optional(),
  target:z.object({source:z.enum(readingSources),id:z.string().max(numbers.defaults.mediaIdChars).optional(),page:mediaSchema.shape.page}).optional(),
  archive:z.object({kind:z.enum(["activity","dream"]),query:z.string().max(120).optional(),date:z.iso.date().optional(),
    offset:z.number().int().nonnegative().default(0)}).optional(),
  describe:z.boolean().optional(),
  when: z.string().max(120).optional(),
  dueLocal: z.string().max(16).optional(),
  thought: z.string().max(300).optional(),
  attention: z.string().max(160).optional(),
  question:z.object({text:z.string().trim().min(1).max(160),source:mediaSchema.shape.source.optional(),
    id:mediaSchema.shape.id,page:mediaSchema.shape.page}).nullable().optional(),
  focusWork:z.string().max(100).nullable().optional(),
  posture: z.enum(["in_bed","up"]).optional(),
  alarm: z.object({op:z.enum(["set","off","snooze"]),id:z.string().max(60).optional(),
    time:z.string().max(32).optional(),minutes:z.number().positive().optional()}).optional(),
  idea: z.string().max(350).optional(),
  reference: z.string().max(45).optional(),
  contact: z.union([z.number().int().positive(),z.string().max(60)]).optional(),
  name: z.string().max(100).optional(),
  move: moveSchema.optional(),
  media: mediaSchema.optional(),
  value: z.unknown().optional(),
  evidenceId: z.string().max(80).optional(),
  work: z.unknown().optional(),
  planId: z.string().max(100).optional(),
  planReason: z.string().max(180).optional(),
  planStatus: z.enum(["continue","finish","interrupt"]).optional(),
  mood: z.object({label:z.string().max(30),cause:z.string().max(120),strength:z.number().min(0).max(1),hours:z.number().min(0.1).max(24)}).optional(),
});
const scopeFor = (peer: string) => "chat:" + peer;
export function rankMemories(
  rows: Memory[],
  cue: string,
  now: number,
  limit = numbers.defaults.memoryCount,
  semantic = new Map<string,number>(),
  relevantOnly = false,
  n = numbers.defaults,
) {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const words = (s: string) => {
    const t = norm(s);
    return new Set(
      Array.from({ length: Math.min(170, Math.max(0, t.length - 1)) }, (_, i) =>
        t.slice(i, i + 2),
      ),
    );
  };
  const keys = words(cue);
  const score = (m: Memory) => {
    const age = Math.max(0, now - m.made) / hour;
    let overlap = 0;
    const searchText=m.kind==="episode"?[m.body,m.quote,m.details].filter(Boolean).join(" "):m.body;
    for (const t of words(searchText)) if (keys.has(t)) overlap++;
    const semanticScore = Math.max(0, (semantic.get(m.id) ?? 0) - n.memorySimilarity) * n.semanticWeight;
    if (relevantOnly && !overlap && !semanticScore) return 0;
    return (
      Math.min(overlap, n.keywordLimit) * n.keywordWeight + semanticScore +
      n.recencyWeight / (1 + age / n.recencyHours) +
      (m.kind === "promise" && !m.resolved ? n.promiseWeight : 0) +
      (m.kind === "understanding" || m.kind === "style" ? 1 : 0)
    );
  };
  const ranked= rows
    .filter((m) => !m.hidden && (!m.expires || m.expires>now) && !["profile","habit_sample","source_quote"].includes(m.kind) && !(["promise","followup","occasion"].includes(m.kind) && m.resolved))
    .map((m) => ({ m, v: score(m) }))
    .filter(({ v }) => v > 0)
    .sort((a, b) => b.v - a.v)
    .map((x) => x.m);
  const chosen:Memory[]=[], fingerprints:Set<string>[]=[];
  for(const m of ranked) {
    const terms=words(m.body);
    if(chosen.some((other,i)=>other.body===m.body || (other.kind===m.kind && terms.size>5 &&
      [...terms].filter(k=>fingerprints[i].has(k)).length/Math.max(terms.size,fingerprints[i].size)>n.similarMemoryRatio))) continue;
    chosen.push(m);fingerprints.push(terms);
    if(chosen.length>=limit) break;
  }
  return chosen;
}
export async function recall(scopes: string[], cue: string, now: number, excludeIds: string[] = [], relevantOnly = false, timeCue=cue) {
  const placeholders = scopes.map(() => "?").join(",");
  const sql = "SELECT * FROM memories WHERE hidden=0 AND (expires IS NULL OR expires>?) AND kind NOT IN ('profile','habit_sample','source_quote') AND scope IN (" + placeholders + ")" +
    (excludeIds.length ? " AND id NOT IN (SELECT value FROM json_each(?))" : "");
  const bindings = [now,...scopes,...(excludeIds.length?[JSON.stringify(excludeIds)]:[])];
  const anchor=timeCue.match(/(?:上次|那次)(.{2,18}?)(之前|以前|之后|以后|前|后)/);
  let temporal:Memory[]=[];
  if(anchor) {
    const parts=anchor[1].match(/书桌|电脑|书架|搬家|画完|《[^》]+》|[\p{L}\p{N}]{2,}/gu)??[];
    const term=anchor[1].match(/书桌|电脑|书架|小屋|画册/)?.[0] || parts.at(-1) || anchor[1];
    const event=await one<Memory>(sql+" AND kind IN ('event','episode','drawing','observation') AND instr(body,?)>0 ORDER BY made DESC LIMIT 1",...bindings,term);
    if(event) {
      const before=/前/.test(anchor[2]);
      const nearest=await all<Memory>(sql+" AND kind IN ('conversation','episode','drawing','observation','event','manuscript') AND made"+
        (before?"<? ORDER BY made DESC":">? ORDER BY made")+" LIMIT 30",...bindings,event.made);
      const wantsMedia=/看|追|读|番剧|分镜|电影|访谈/.test(timeCue.slice((anchor.index??0)+anchor[0].length));
      const matching=wantsMedia?nearest.filter(m=>m.kind==="observation" || /在看|追番|在追|读到|正在读|分镜|画集|字幕|《/.test(m.body)):[];
      temporal=[...new Map([...matching,...nearest].map(m=>[m.id,m])).values()].slice(0,4);
    }
  }
  const cueTokens = Array.from(
    new Set(
      (cue.match(/[\u3400-\u9fff]{2,12}|[A-Za-z0-9]{3,30}/g) ?? []).flatMap(
        (x) => [x, x.slice(0, 2), x.slice(-2)],
      ),
    ),
  ).slice(0, 8);
  const [recent, older, pending, semantic] = await Promise.all([
    all<Memory>(sql + " ORDER BY made DESC LIMIT 90", ...bindings),
    cueTokens.length
      ? all<Memory>(
          sql +
            " AND (" +
            cueTokens.map(() => "instr(body,?)>0").join(" OR ") +
            ") ORDER BY made DESC LIMIT 90",
          ...bindings,
          ...cueTokens,
        )
      : [],
    all<Memory>(
      sql + " AND kind='promise' AND resolved=0 ORDER BY due LIMIT 24",
      ...bindings,
    ),
    semanticHits(scopes, cue, excludeIds).catch(() => []),
  ]);
  const n=numbers.read(await currentOverrides());
  const ranked=rankMemories(
    [
      ...new Map(
        [...recent, ...older, ...pending,...semantic.map(hit=>hit.memory)].map((m) => [m.id, m]),
      ).values(),
    ],
    cue,
    now,
    n.memoryCount, new Map(semantic.map(hit=>[hit.memory.id,hit.score])), relevantOnly, n,
  );
  return [...new Map([...temporal,...ranked].map(m=>[m.id,m])).values()].slice(0,n.memoryCount);
}
export async function versions() {
  return all<Setting>(
    "SELECT v.* FROM agent_versions v WHERE v.rowid=(SELECT n.rowid FROM agent_versions n WHERE n.name=v.name ORDER BY made DESC,rowid DESC LIMIT 1) AND v.name NOT LIKE 'cabin/%' AND v.name NOT LIKE 'config/%' AND v.value<>'' ORDER BY name LIMIT 90",
  );
}
function remembered(rows: Memory[]) {
  return rows.filter(m => m.kind !== "access" || !m.body.startsWith("动作 ")).map((m) => ({
    id: m.id,
    kind: m.kind,
    date: dayOf(m.made),
    ...(m.kind === "access" ? {time:shanghaiDate(m.made)} : {}),
    text: m.kind === "access" ? savedFailure(m.body) : m.body,
    source: m.source || undefined,
    category:m.category || undefined,
    ...(m.kind==="day_plan" ? {when:m.quote, evidence:JSON.parse(m.evidence)} : {}),
    ...(m.kind==="promise" && m.scope==="self" && m.details ? {planId:JSON.parse(m.details)?.planId,when:m.quote} : {}),
  }));
}
const persona = (defs: Setting[]) =>
  defs.find((v) => v.name === "persona")?.value || initialSelf;
function storedRecipe(value: string) {
  try {
    const saved = recipe.safeParse(JSON.parse(value));
    return saved.success ? { definition: saved.data } : { problem: "用 revise 修改工具。" + actionProblem(saved.error) };
  } catch { return { problem: "用 revise 重新填写这个工具的 description 和 steps。" }; }
}
type Turn = {
  state: State;
  now: number;
  writes: D1PreparedStatement[];
  newMem: Memory[];
};
function remember(
  t: Turn,
  scope: string,
  kind: string,
  body: string,
  extra: Partial<Memory> = {},
) {
  const m = memory({ scope, kind, body: body.slice(0, 3800), ...extra }, t.now);
  t.writes.push(m.write);
  t.newMem.push(m.row);
  return m.row;
}
async function paint(t: Turn, scope: string, idea: string, style: string, reference?: string,work?:string,origin?:string,baseArt?:string) {
  const started=Date.now();
  let previous:Uint8Array<ArrayBuffer>|undefined;
  if(baseArt) {
    const pic=await one<{png:number[]|Uint8Array|null;svg:string}>("SELECT png,svg FROM drawings WHERE id=? AND scope IN ('public',?)",baseArt,scope);
    if(!pic) throw Error(lifeErrors.missingOriginal);
    previous=pic.png?Uint8Array.from(pic.png):Uint8Array.from(await (await import("./png")).renderPNG(pic.svg));
  }
  let png = await drawImage(idea, style, t.now, previous?{image:previous,instruction:idea}:undefined, reference,t.state.config);
  const draft=png;
  let title = clip(idea, 60) || texts.read(t.state.config).drawingTitle;
  try {
    const review = await think(
      drawingReview,
      { idea },
      t.now,
      "activity",
      "data:image/png;base64," + Buffer.from(png).toString("base64"),
      "drawing_review",
    );
    title = clip(review.title, 60) || title;
    const instruction = clip(review.revision, numbers.read(t.state.config).drawingReviewChars);
    if (instruction)
      png = await drawImage(idea, style, t.now, { image: png, instruction }, reference,t.state.config);
  } catch (error) {
    remember(t, scope === siteScope ? privateScope : scope, "access",
      "动作 绘画复核或修订 未完成，已保留初稿，原因 " + failureReason(error) + "。");
  }
  t.now+=Math.max(0,Date.now()-started);
  const id = crypto.randomUUID();
  t.writes.push(
    stmt(
      "INSERT INTO drawings(id,made,scope,title,svg,png) VALUES(?,?,?,?,'',?)",
      id,
      t.now,
      scope,
      title,
      png,
    ),
  );
  const record=remember(t, scope, "drawing", "画了《" + title + "》", {
    source: "/picture/" + id,evidence:JSON.stringify(origin?["chat-in-"+origin]:[]),
  });
  if(work) {
    if(draft!==png) {
      const draftId=crypto.randomUUID();
      t.writes.push(stmt("INSERT INTO drawings(id,made,scope,title,svg,png) VALUES(?,?,?,?,'',?)",draftId,t.now,scope,title+" · 初稿",draft),
        workStep(work,scope,t.now,"初稿",{art:draftId,level:"draft"}));
    }
    t.writes.push(workStep(work,scope,t.now,title,{evidence:record.id,art:id,level:"drawing"}),
      stmt("UPDATE works SET updated=?,next='' WHERE id=? AND scope=? AND state='active'",t.now,work,scope));
  }
  return id;
}
type ArtJob={id:string;scope:string;peer:string|null;origin:string|null;work:string|null;idea:string;style:string;reference:string|null;attempts:number;promise_id:string|null;state:string;art:string|null};
async function queuePainting(t:Turn,scope:string,idea:string,style:string,reference?:string,peer?:string,origin?:string,workId?:string,promiseId?:string) {
  let baseArt:string|null=null;
  let closeAfter=false;
  let adoptedId:string|undefined;
  let work:{id:string}|null=null;
  if(workId && peer) {
    const selected=await one<{id:string;state:string}>("SELECT id,state FROM works WHERE id=? AND scope=? AND kind='drawing' AND state IN ('active','done','shelved')",workId,scope);
    if(!selected) throw Error(lifeErrors.missingConversationArt);
    const paused=await one("SELECT id FROM art_jobs WHERE work=? AND scope=? AND state='paused'",workId,scope);
    if(paused) throw Error(lifeErrors.pausedDrawing);
    baseArt=(await one<{art:string}>(`SELECT art FROM (
      SELECT d.id AS art,s.made,s.rowid AS seq FROM work_steps s JOIN drawings d ON d.id=s.art AND d.scope=?
      WHERE s.work=? UNION ALL SELECT d.id,j.made,j.rowid FROM art_jobs j JOIN drawings d ON d.id=j.art AND d.scope=?
      WHERE j.work=? AND j.scope=?) ORDER BY made DESC,seq DESC LIMIT 1`,scope,workId,scope,workId,scope))?.art??null;
    if(selected.state==="done" && !baseArt) throw Error(lifeErrors.draftMissing);
    work=selected;
    closeAfter=selected.state==="done";
    if(selected.state!=="active") t.writes.push(stmt("UPDATE works SET state='active',updated=? WHERE id=? AND scope=?",t.now,workId,scope));
  }
  if(workId && !peer) {
    const selected=await findOwnWork(workId);
    if(!selected || selected.kind!=="drawing") throw Error(lifeErrors.workMissing);
    if(selected.scope==="self") scope="self";
    baseArt=selected.art ?? (await one<{art:string}>("SELECT art FROM work_steps WHERE work=? AND art IS NOT NULL ORDER BY made DESC,rowid DESC LIMIT 1",workId))?.art ?? null;
    if(selected.loose && scope===selected.scope) adoptedId=workId;
    const paused=selected.state==="shelved" && await one("SELECT 1 FROM art_jobs WHERE work=? AND state='paused'",workId);
    if(!selected.loose && !paused && scope===selected.scope) {
      work={id:workId};
      closeAfter=selected.state==="done";
      if(selected.state!=="active")
        t.writes.push(stmt("UPDATE works SET state='active',updated=? WHERE id=? AND scope=?",t.now,work.id,scope));
    }
  }
  if(work && await one("SELECT id FROM art_jobs WHERE work=? AND scope=? AND state IN ('pending','running','ready')",work.id,scope))
    throw Error(lifeErrors.draftPending);
  const created=work?null:newWork(scope,idea,"drawing","画第一稿",t.now,adoptedId);
  if(created) {
    t.writes.push(created.write);
    if(baseArt) t.writes.push(workStep(created.id,scope,t.now,"选作续画的原图",{art:baseArt,level:"reference"}));
  }
  const id=crypto.randomUUID();
  t.writes.push(stmt("INSERT INTO art_jobs(id,scope,peer,origin,work,idea,style,reference,state,made,due,promise_id) VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)",
    id,scope,peer??null,origin??null,work?work.id:created!.id,idea,style,reference??null,t.now,t.now,promiseId??null));
  if(created || closeAfter) t.writes.push(stmt("INSERT INTO channel_state VALUES(?,?)","standalone-art/"+id,created?.id??work!.id));
  if(baseArt) t.writes.push(stmt("INSERT INTO channel_state VALUES(?,?)","art-base/"+id,baseArt));
  return {id,scope,workId:work?.id??created!.id};
}
let painting:Promise<string>|undefined;
export function processPainting(now=Date.now()) {
  if(painting) return painting;
  painting=runPainting(now).finally(()=>{painting=undefined;});
  return painting;
}
async function runPainting(now:number) {
  // Release only jobs held by the retired quota, preserving other retry and delivery times.
  await stmt("UPDATE art_jobs SET due=MIN(due,?),detail=NULL WHERE state='pending' AND lease IS NULL AND detail='等待次日创作额度'",now).run();
  const job=await one<ArtJob>("SELECT * FROM art_jobs WHERE state IN ('pending','running','ready') AND due<=? ORDER BY due,made LIMIT 1",now);
  if(!job) return "idle";
  const lease=crypto.randomUUID();
  const claimed=await stmt("UPDATE art_jobs SET lease=?,state='running',due=?,attempts=attempts+(art IS NULL) WHERE id=? AND state IN ('pending','running','ready') AND due<=?",
    lease,now+600000,job.id,now).run();
  if(!claimed.meta.changes) return "busy";
  try {
    const t:Turn={state:(await house(now)).state,now,writes:[],newMem:[]};
    const base=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?","art-base/"+job.id);
    const art=job.art??await paint(t,job.scope,job.idea,job.style,job.reference??undefined,job.work??undefined,job.origin??undefined,base?.value);
    const proof=t.newMem.find(m=>m.kind==="drawing")??await one<Memory>("SELECT * FROM memories WHERE scope=? AND kind='drawing' AND source=? AND hidden=0",job.scope,"/picture/"+art);
    if(!proof) throw Error(lifeErrors.hiddenArt);
    const identity=job.scope.slice(5);
    const promise=job.promise_id?await one<{due:number|null}>("SELECT due FROM memories WHERE id=? AND scope=? AND kind='promise' AND hidden=0 AND resolved=0",job.promise_id,job.scope):null;
    // A drawing requested from the retired site still belongs in its private archive.
    // Only a QQ address can queue a delivery or defer it until the next contact window.
    const destination=job.peer?.startsWith("qq-") ? job.peer : null;
    let peer=destination;
    if(promise?.due && promise.due>t.now) peer=null;
    else if(peer && (!job.origin || job.state==="ready" || job.art)) peer=(await chatContacts(t.now,identity))[0]?.peer??null;
    const deferred=!!destination && !peer;
    if(deferred && !job.art) t.writes.push(trace(job.scope,t.now,"drawing_waiting",{job:job.id,intent:"reminder",reason:"成图已保留，等待合适的联系时间和渠道"}));
    if(peer) {
      const original=job.origin && await one("SELECT 1 FROM messages WHERE id=? AND peer=? AND side='in' AND withheld=0",job.origin,peer);
      const replyTo=original?job.origin:null;
      const seq=replyTo?await one<{seq:number}>("SELECT COALESCE(max(seq),0)+1 AS seq FROM messages WHERE reply_to=?",replyTo):null;
      const id="art-"+job.id,body="画好了，给你看。";
      t.writes.push(stmt("INSERT INTO messages(id,peer,made,side,body,art,reply_to,seq,batch_id) VALUES(?,?,?,'out',?,?,?,?,?)",
        id,peer,t.now,body,art,replyTo,seq?.seq??1,id));
      if(job.promise_id) t.writes.push(stmt("UPDATE memories SET closed_by=?,resolved=?,evidence=json_insert(evidence,'$[#]',?) WHERE scope=? AND id=? AND kind='promise' AND resolved=0 AND hidden=0",
        "chat-out-"+id,0,proof.id,job.scope,job.promise_id));
      t.writes.push(trace(job.scope,t.now,"drawing_finished",{job:job.id,media:"image",intent:"reminder"},id));
    }
    // The NOT NULL constraint fences every artifact and reply in this transaction.
    t.writes.push(stmt("UPDATE works SET state='done' WHERE scope=? AND state='active' AND id=(SELECT value FROM channel_state WHERE id=?)",job.scope,"standalone-art/"+job.id));
    if(job.origin && !job.art) t.writes.push(stmt("UPDATE memories SET evidence=json_insert(evidence,'$[#]',?) WHERE id=? AND scope=? AND hidden=0",proof.id,"episode-"+job.origin,job.scope));
    t.writes.push(stmt(`UPDATE memories SET category=CASE WHEN category='started' AND json_extract(details,'$.continuingJob')=? THEN 'started' ELSE 'done' END,
      evidence=${planEvidenceSql} WHERE kind='day_plan' AND scope IN ('self',?)
      AND id=(SELECT value FROM channel_state WHERE id=?) AND
      (category='started' OR (category='done' AND json_extract(details,'$.selfConfirmed')=1))`,job.id,proof.id,proof.id,proof.id,job.scope,"art-plan/"+job.id));
    await db().batch([stmt(`UPDATE resident SET revision=CASE WHEN EXISTS
      (SELECT 1 FROM art_jobs WHERE id=? AND lease=? AND state='running') THEN revision+1 ELSE NULL END WHERE id=?`,job.id,lease,residentId),
      ...t.writes,stmt("UPDATE art_jobs SET state=?,art=?,due=?,lease=NULL WHERE id=? AND lease=?",deferred?"ready":"done",art,deferred?Math.max(t.now+5*60000,promise?.due??0):t.now,job.id,lease)]);
    return deferred?"ready":"done";
  } catch(error) {
    const entry=await one<{state:string;lease:string|null}>("SELECT state,lease FROM art_jobs WHERE id=?",job.id);
    if(entry?.lease!==lease) return entry?.state??"cancelled";
    const status=job.art?"ready":job.attempts>=2?"failed":"pending";
    const writes=[];
    if(status==="failed") writes.push(stmt(`UPDATE memories SET category='interrupted',details=json_set(details,'$.reason','绘图暂未成功')
      WHERE id=(SELECT value FROM channel_state WHERE id=?) AND kind='day_plan' AND category='started'
      AND EXISTS(SELECT 1 FROM art_jobs WHERE id=? AND lease=?)`,"art-plan/"+job.id,job.id,lease));
    writes.push(stmt("UPDATE art_jobs SET state=?,detail=?,due=?,lease=NULL WHERE id=? AND lease=?",status,failureReason(error),now+60000*(job.attempts+1),job.id,lease));
    await db().batch(writes);
    return status;
  }
}
async function perceive(t: Turn, q: ReadRequest, scope=privateScope) {
  const result = await readMedia(q, imports(t.state));
  const picture=q.action==="frames"?result.frames?.[0]:undefined;
  if(result.status==="ok" && picture) {
    try {
      const view=await think(storyboard,
        {title:result.items[0].title},t.now,"activity",picture,"storyboard_vision");
      if(clip(view.description)) {
        result.level="storyboard_viewed";
        result.items[0].body=clip(view.description,800);
        result.nextOffset=(q.offset??0)+1;
      }
    } catch { /* The title survives a failed visual observation. */ }
    if(result.level!=="storyboard_viewed") result.status="frames_unseen";
  }
  if (result.status !== "ok") {
    remember(
      t,
      scope,
      "access",
      "在" + sourceNames[q.source] + readingOutcome({ ...q, ...result }) + "。",
    );
    return result;
  }
  // A row in the account's library is not an action taken by the resident.
  if (isBiliAccountRead(q)) return result;
  for (const item of result.items.slice(0, 4)) {
    const passages = [
      item.title,
      item.body,
      ...(result.comments ?? []).map((c) => "评论 #" + c.id + " · " + c.text),
    ].filter(Boolean);
    const body =
      q.source +
      " / " +
      result.level +
      " · " +
      item.id +
      "\n" +
      passages.join("\n").slice(0, 3200);
    const id =
      "seen-" + createHash("sha256").update(scope===privateScope?body:scope+"\n"+body).digest("hex").slice(0, 32);
    if (!(await one("SELECT id FROM memories WHERE id=?", id))) {
      const progress={page:result.resolved?.page??q.page??1,offset:q.offset??0,excerpt:clip(item.body,3200).slice(-120)};
      remember(t, scope, "observation", body, { id, source: item.url,category:result.level,details:JSON.stringify(progress) });
    }
  }
  return result;
}
async function execute(
  t: Turn,
  defs: Setting[],
  a: z.infer<typeof actionSchema>,
  contacts: ChatContact[],
  titles: DeskTitle[],
) {
  const s = t.state;
  const n = numbers.read(s.config), copy=texts.read(s.config);
  const continuingRest = a.action === "rest" ? await currentRest(s,t.now) : undefined;
  endActivity(t);
  s.activity = copy.atHome;
  const ink =
    defs.find((v) => v.name === "style")?.value || copy.drawingStyle;
  const startName = s.name;
  const interactive=["config","help","play","read","change_titles","site","archive","object"].includes(a.action) || (a.action==="work" && (a.work as {action?:string})?.action==="browse");
  const quick=interactive && a.minutes===undefined && (s.quickSteps??0)<n.quickSteps;
  s.quickSteps=quick ? (s.quickSteps??0)+1 : 0;
  s.nextAt=t.now+(quick ? n.quickDelayMs : (a.minutes??(a.action==="rest"?n.restMinutes:interactive?n.interactiveMinutes:n.idleMinutes))*60000);
  const visibility=a.visibility??s.sharing??"detail";
  const scope=visibility==="detail" && !["summary","hidden"].includes(s.sharing??"detail")?siteScope:privateScope;
  if (a.action!=="sleep" && a.action!=="get_up") {
    if (a.posture==="in_bed") {
      s.inBed=true;
      s.bedVisibility=visibility;
    } else if (a.posture==="up" || a.action==="room") leaveBed(t,scope);
  }
  if (s.inBed) {
    s.activity=copy.inBed;
    if (a.visibility==="hidden") s.bedVisibility="hidden";
  }
  let outcome: Outcome;
  let readResult:Observation|undefined;
  let receiptScope=["config","help","change_titles","object","archive","site","revise","rollback","request_mcp","use_mcp","use_tool","alarm","chat"].includes(a.action) ? privateScope : scope;
  let progress:{id:string;complete:boolean}|undefined;
  let planKind:string=a.action;
  let planScope=scope;
  switch (a.action) {
    case "config": {
      const result = await configure(s, a.config, t.now, t.writes);
      outcome = {status:"done", summary:configReceipts[a.config!.op], result};
      break;
    }
    case "help": {
      const name = a.name && actionSchema.shape.action.parse(a.name);
      const result = name ? { name, usage: activityHelp[name],
        ...(name==="reflect"?{activities:await reflectionActivities()}: {}),
        ...(name==="work"?await workEvidenceChoices((a.work as {id?:unknown})?.id ?? s.focusWork): {}) } : { actions: actionSchema.shape.action.options };
      outcome = { status: "done", summary: formatText(copy.helpRead, {action:name ?? copy.dailyActions}), result };
      break;
    }
    case "play": {
      if(!a.play) throw Error(lifeErrors.gameCommand);
      const id=crypto.randomUUID();
      const result=await play(t,a.play,id);
      record(t,result,a.visibility,id);
      if(["start","restart","next"].includes(a.play.op) || (a.play.op==="move" && result.moved))
        progress={id,complete:!!result.game.result};
      outcome={status:result.moved===false?"skipped":"done",summary:a.play.op==="look"?copy.gameSaveViewed:result.game.feedback,ref:id,
        result:{id,activityId:id,save:result.save,saveId:result.save,feedback:result.game.feedback,result:result.game.result}};
      break;
    }
    case "share":
      s.shareEpoch=crypto.randomUUID();
      if(!a.visibility) throw Error(lifeErrors.visibility);
      if(a.evidenceId) {
        if(!await one("SELECT 1 FROM activities WHERE id=?",a.evidenceId)) throw Error(lifeErrors.activityMissing);
        t.writes.push(stmt("UPDATE activities SET visibility=? WHERE id=?",a.visibility,a.evidenceId));
      } else s.sharing=a.visibility;
      outcome={status:"done",summary:a.evidenceId ? copy.changedItemVisibility : copy.changedDefaultVisibility,ref:a.evidenceId,
        result:{visibility:a.visibility,id:a.evidenceId}};break;
    case "reflect": {
      const target = await reflectionTarget(a.evidenceId,a.idea);
      s.shareEpoch=crypto.randomUUID();
      t.writes.push(stmt("UPDATE activities SET detail=json_set(detail,'$.remark',?) WHERE id=?",a.idea!.trim(),target));
      outcome={status:"done",summary:copy.reflected,ref:target,result:{annotated:target,remark:a.idea!.trim()}};
      if (a.question===null && s.question) remember(t,privateScope,"understanding",
        "曾经的问题："+s.question.text+"\n自己留下的看法："+a.idea!.trim(),{evidence:JSON.stringify([target])});
      break;
    }
    case "archive": {
      if(!a.archive) throw Error(lifeErrors.archiveKind);
      const {kind,query,date,offset}=a.archive;
      outcome={status:"done",summary:copy.archiveViewed,result:await browseActivityArchive(kind,query??"",date,offset)};
      break;
    }
    case "object": {
      const hostTurn:Turn={state:structuredClone(s),now:t.now,writes:[],newMem:[]};
      const run=await cabinAction(s,a.object,{
        read:async query=>{
          const result=await perceive(hostTurn,query);
          if(result.status==="ok") {
            const request={...query,...result.resolved};
            recordObjectReading(hostTurn,request,result);
            hostTurn.writes.push(readingBookmark(request,result,t.now));
          }
          return result;
        },
        draw:async idea=>(await queuePainting(hostTurn,privateScope,idea,ink)).id,
        website:async args=>{
          const edited=await editSite(args,t.now,publicHome,"resident");
          hostTurn.writes.push(...edited.writes);
          return edited.result;
        },
        game:async (save,game,args,objectVisibility)=>{
          const event=crypto.randomUUID();
          const result=await play(hostTurn,{...args,game,id:save},event);
          const share=objectVisibility==="hidden" || visibility==="hidden"?"hidden":
            objectVisibility==="summary" || visibility==="summary"?"summary":"detail";
          record(hostTurn,result,share,event);
          return result;
        },
      },t.now,s.sharing==="hidden" || visibility==="hidden"?"hidden":s.sharing==="summary"?"summary":visibility);
      if(run.outcome.status==="done") {
        t.writes.push(...hostTurn.writes);
        t.newMem.push(...hostTurn.newMem);
        if(hostTurn.state.currentActivity) {
          s.currentActivity=hostTurn.state.currentActivity;
          s.activity=hostTurn.state.activity;
        }
      }
      t.writes.push(...run.writes);
      outcome=run.outcome;
      // A deliberate furniture change can fulfil a room plan through the same object entrance.
      const op = (a.object as { op: string }).op;
      if (a.planId && outcome.status === "done" && run.writes.length && ["move","create","stow","remove"].includes(op))
        planKind = "room";
      break;
    }
    case "site": {
      const edited=await editSite(a.site,t.now,publicHome,"resident");
      t.writes.push(...edited.writes);
      outcome={status:"done",summary:formatText(copy.siteEdited, {operation:a.site!.op}),result:edited.result};
      break;
    }
    case "journal": {
      const everyDays=a.journal==="habit"?a.everyDays:s.journalHabit?.everyDays??n.fallbackJournalDays;
      if(everyDays===undefined || !a.journal) throw Error(lifeErrors.journalChoice);
      const publication=a.journal==="write"?await publish(t,defs):undefined;
      planKind="writing";
      if(publication==="published") progress={id:dayOf(t.now),complete:true};
      s.journalHabit={everyDays,nextDay:dayOf(t.now+Math.max(everyDays,1)*24*hour)};
      const skipped = a.journal==="skip" || publication==="already_written";
      const summary = publication==="published" ? copy.journalPublished : publication==="already_written" ? copy.journalExists :
        a.journal==="skip" ? copy.skippedJournal : copy.changedJournalHabit;
      outcome={status:skipped?"skipped":"done",summary,result:{journal:a.journal,everyDays,publication}}; break;
    }
    case "chat": {
      const contact = typeof a.contact==="string" ? contacts.find(c=>c.alias===a.contact) : contacts[(a.contact ?? 0) - 1];
      if (!contact) throw Error(lifeErrors.contactMissing);
      const response = await respond(t, contact.peer, [], defs, a.idea);
      receiptScope=scopeFor(contact.identity);
      outcome = chatOutcome(response.status,response.id);
      break;
    }
    case "change_titles": {
      if (!a.target) throw Error(lifeErrors.titleSource);
      const changed=await changeTitles(a.target,titles,t.writes,s.config);
      outcome={status:changed?"done":"skipped",summary:changed?copy.changedTitles:copy.noTitlesToChange};
      break;
    }
    case "read":
      if (!a.media) throw Error(lifeErrors.mediaMissing);
      {
        // Plans and work attachments request their own evidence, including a fresh read of an old passage.
        const request=a.planId || a.work ? a.media : await resumeRead(a.media);
        if (!request) {
          outcome={status:"skipped",summary:copy.noReadingContinuation};
          break;
        }
        a.media=request;
        const result = readResult = await perceive(t, a.media);
        if(result.resolved) a.media={...a.media,...result.resolved};
        if(isBiliAccountRead(a.media)) receiptScope=privateScope;
        const detail=readExperience(a.media,result);
        const id=detail?record(t,detail,a.visibility,undefined,a.media.id):undefined;
        if (result.status!=="ok") {
          s.currentActivity=undefined;
          s.activity=s.inBed?copy.inBed:copy.atHome;
        }
        const work=z.object({id:z.string().max(100),next:z.string().max(240).optional()}).safeParse(a.work);
        const attached = a.work===undefined ? undefined : id && result.status==="ok" && work.success ?
          await attachReading(work.data.id,id,scope,t.now,work.data.next) : {attached:false,reason:"需要成功阅读的活动和有效的 work.id。",writes:[]};
        if(attached) t.writes.push(...attached.writes);
        if (result.status==="ok" || result.nextPage) t.writes.push(readingBookmark(a.media,result,t.now,attached?.attached?work.data?.id:undefined));
        const first = !isBiliAccountRead(a.media) && result.items[0]?.title;
        const fact = isBiliAccountRead(a.media) && result.status==="ok" ? (a.media.action==="history"?copy.readHistory:copy.readLater) :
          readingOutcome({source:a.media.source,action:a.media.action,level:result.level,status:result.status});
        outcome={status:result.status==="ok"?"done":"failed",ref:id,summary:sourceNames[a.media.source]+" · "+fact+"。"+(first?"《"+first+"》":"")+(attached ? attached.attached?" 已归入作品。":" 未归档。"+attached.reason:""),
          result:{id,level:result.level,status:result.status,items:result.items.map(i=>({...i,body:result.status==="ok"?i.body.slice(0,["article","subtitles"].includes(result.level)?3200:1000):""})),
            work:attached && {attached:attached.attached,reason:attached.reason},comments:detail?.comments,filteredCount:result.filteredCount,coverage:result.coverage,nextOffset:result.nextOffset,atEnd:result.atEnd,nextCursor:result.nextCursor,nextPage:result.nextPage}};
        if (isBiliAccountRead(a.media)) {
          s.activity = result.status === "ok" ? (a.media.action === "history" ? copy.historyStatus : copy.watchLaterStatus) : copy.atHome;
        }
      }
      break;
    case "draw": {
      const idea=a.idea || copy.drawingIdea;
      const job=await queuePainting(t,scope,idea,ink,a.reference,undefined,undefined,a.name);
      planScope=receiptScope=job.scope;
      record(t,{kind:"draw",description:copy.drawStatus},a.visibility,job.id);
      outcome={status:"queued",summary:formatText(copy.drawingQueued, {idea}),ref:job.id,result:{jobId:job.id,workId:job.workId,activityId:job.id}};
      break;
    }
    case "room":
      {
        const moved = await arrange(s, a.move);
        const what=moved.summary;
        t.writes.push(...moved.writes);
        remember(t, scope, "event", what + "。");
        const id=record(t,{kind:"room",description:copy.arrangeStatus},a.visibility);
        outcome={status:"done",summary:what+"。",ref:id};
      }
      break;
    case "rename":
      {
        const name = clip(a.name, 40);
        if (!name) throw Error(lifeErrors.emptyName);
        s.name = name;
        const event=remember(
          t,
          siteScope,
          "event",
          formatText(copy.siteRenamed, {old:startName,name}),
        );
        outcome={status:"done",summary:event.body,ref:event.id};
      }
      break;
    case "plan":
      if (a.idea) {
        const {quote,due}=planTiming(a.idea,a.when,t.now,a.dueLocal);
        const plan=remember(t,scope,"day_plan",a.idea,{topic:dayOf(t.now),category:"planned",quote,due,
          details:JSON.stringify({action:planKinds.includes(a.name??"")?a.name:a.target || a.readingGoal?"read":null,
            reading:(a.name==="read" || a.readingGoal || a.target)?planReading(a.idea,a.readingGoal,a.target??a.media):undefined})});
        remember(t,privateScope,"promise",a.idea,{quote,due,category:"planned",details:JSON.stringify({planId:plan.id})});
        if(due!==null && due>t.now) s.nextAt=Math.min(s.nextAt,due);
        outcome={status:"planned",summary:formatText(copy.planSaved, {idea:a.idea!}),ref:plan.id};
      } else outcome={status:"skipped",summary:copy.skipPlan};
      break;
    case "work": {
      const request=a.work as {action?:string;id?:string;query?:string;offset?:number}|undefined;
      if(request?.action==="browse") {
        receiptScope=privateScope;
        const offset=Number.isSafeInteger(request.offset) && request.offset!>=0?request.offset!:0;
        const result=await browseOwnWorks(clip(request.query,100),offset);
        outcome={status:"done",summary:result.items.length?copy.foundWorks:copy.emptyWorks,result};
        break;
      }
      const selected=typeof request?.id==="string" && await findOwnWork(request.id.trim());
      if(selected && selected.scope===privateScope) planScope=receiptScope=privateScope;
      const edited=await prepareWorkEdit(planScope,a.work,t.now,t.newMem);
      if ("field" in edited && edited.field) throw new WorkInputError(edited.field,edited.summary,edited.ref);
      t.writes.push(...edited.writes);
      planKind="writing";
      if("manuscript" in edited && edited.manuscript) progress={id:edited.manuscript,complete:request?.action==="finish"};
      outcome=edited;
      break;
    }
    case "share_dream": {
      const dream=await one<Memory>("SELECT * FROM memories WHERE id=? AND kind='dream' AND scope='self'",a.evidenceId??"");
      if(dream && !dream.hidden && !await one("SELECT 1 FROM memories WHERE id=?","shared-"+dream.id)) {
        const shared=remember(t,siteScope,"shared_dream",dream.body,{id:"shared-"+dream.id});
        outcome={status:"done",summary:copy.sharedDream,ref:shared.id};
      } else outcome={status:"skipped",summary:dream?copy.dreamAlreadyShared:copy.dreamMissing};
      break;
    }
    case "resolve": {
      const pending = a.evidenceId && await one<{planId:string|null}>(`SELECT json_extract(details,'$.planId') AS planId FROM memories
        WHERE (id=? OR json_extract(details,'$.planId')=?) AND kind='promise' AND scope='self' AND resolved=0 AND hidden=0`,a.evidenceId,a.evidenceId);
      if (pending) {
        if (pending.planId) {
          const reading=await one("SELECT 1 FROM memories WHERE id=? AND kind='day_plan' AND category IN ('planned','started') AND json_extract(details,'$.action')='read'",pending.planId);
          if(reading) {
            outcome={status:"skipped",summary:"这项阅读计划要用对应材料的阅读进度完成。",ref:pending.planId};
            break;
          }
          t.writes.push(stmt(`UPDATE memories SET category='done',details=json_set(details,'$.reason','自己标记为完成。','$.selfConfirmed',1)
            WHERE id=? AND kind='day_plan' AND scope IN ('self','public') AND category IN ('planned','started')`,pending.planId));
          outcome={status:"done",summary:copy.planConfirmed,ref:pending.planId};
        } else {
          t.writes.push(stmt("UPDATE memories SET resolved=1 WHERE id=? AND kind='promise' AND scope='self'",a.evidenceId));
          outcome={status:"done",summary:copy.promiseConfirmed,ref:a.evidenceId};
        }
      } else outcome={status:"skipped",summary:copy.promiseMissing};
      break;
    }
    case "alarm": {
      if (!a.alarm) throw Error(lifeErrors.alarmCommand);
      const summary=setAlarm(s,a.alarm,t.now);
      const event=remember(t,privateScope,"event",summary);
      outcome={status:"done",summary,ref:event.id};
      break;
    }
    case "get_up": {
      const event=leaveBed(t,scope);
      s.activity=copy.atHome;
      outcome=event?{status:"done",summary:event.body,ref:event.id}:{status:"skipped",summary:copy.alreadyUp};
      break;
    }
    case "sleep": {
      let bell="";
      if (a.alarm) {
        try { bell=setAlarm(s,a.alarm,t.now); }
        catch (error) { bell="闹钟没有调好。"+actionProblem(error); }
      }
      const slept=await goToSleep(t,defs,visibility);
      outcome={status:slept?"started":"skipped",summary:(slept?copy.fellAsleep:copy.stillAwake)+bell,ref:s.currentActivity};
      break;
    }
    case "revise": {
      const name = a.name || "";
      let value = "";
      if (
        ["persona", "style", "routine", "writing", "reflection"].includes(name)
      )
        value = clip(a.value, 1600);
      else if (name.startsWith("skill-")) {
        toolName.parse(name);
        value = clip(a.value, 2000);
      } else if (name.startsWith("tool-")) {
        toolName.parse(name);
        await testRecipe(a.value);
        value = JSON.stringify(recipe.parse(a.value));
      }
      if (!value) throw Error(lifeErrors.restrictedSetting);
      const old = await currentSetting(name);
      t.writes.push(saveVersion(name, value, old?.id ?? null, t.now));
      remember(t, privateScope, "skill", formatText(copy.settingUpdated, {name}));
      outcome={status:"done",summary:formatText(copy.settingUpdated, {name})};
      break;
    }
    case "rollback": {
      if (a.name?.startsWith("config/") || a.name?.startsWith("cabin/")) throw Error(lifeErrors.useConfigRollback);
      const current = await currentSetting(a.name || "");
      if (!current || (!current.parent && !current.value)) throw Error(lifeErrors.initialVersion);
      if(!current.parent) {
        t.writes.push(saveVersion(current.name,"",null,t.now));
        outcome={status:"done",summary:formatText(copy.initialSetting, {name:current.name})};
        break;
      }
      const parent = await one<Setting>(
        "SELECT * FROM agent_versions WHERE id=? AND name=?",
        current.parent,
        current.name,
      );
      if (!parent) throw Error(lifeErrors.versionMissing);
      t.writes.push(
        saveVersion(current.name, parent.value, parent.parent, t.now),
      );
      outcome={status:"done",summary:formatText(copy.settingRestored, {name:current.name}),ref:parent.id};
      break;
    }
    case "use_tool": {
      const tool = defs.find(
        (x) => x.name === a.name && x.name.startsWith("tool-"),
      );
      if (!tool) throw Error(lifeErrors.toolMissing);
      const { definition, problem } = storedRecipe(tool.value);
      if (!definition) throw Error(problem);
      if (a.describe) {
        outcome={status:"done",summary:formatText(copy.toolExplained, {name:tool.name}),result:definition};
        break;
      }
      const result = await runRecipe(definition, a.idea ?? "", {
        read: async (source,query)=>{
          const observation=await perceive(t,{source,action:query?"search":"browse",query});
          if(observation.status!=="ok" || !observation.items.length) throw Error("在"+sourceNames[source]+readingOutcome({
            source,action:query?"search":"browse",level:observation.level,status:observation.status==="ok"?"no_results":observation.status,
          })+"。");
          return observation.items.map(x=>x.title);
        },
        draw: async idea=>"已加入绘图队列 "+(await queuePainting(t,scope,idea,ink,a.reference)).id,
      });
      remember(t, privateScope, "tool", result.join("\n").slice(0, 750));
      outcome={status:"done",summary:formatText(copy.usedRecipe, {name:tool.name}),result:result.join("\n").slice(0,750)};
      break;
    }
    case "request_mcp": {
      const value = a.value as {
        url?: unknown;
        name?: unknown;
        purpose?: unknown;
      } | null;
      if (
        !value ||
        !clip(value.name) ||
        !clip(value.purpose) ||
        !/^https:\/\//.test(clip(value.url))
      )
        throw Error(lifeErrors.incompleteRequest);
      const alias = toolName.parse(a.name);
      t.writes.push(
        stmt(
          "INSERT OR REPLACE INTO channel_state VALUES(?,?)",
          "proposal/" + alias,
          JSON.stringify({
            alias,
            name: clip(value.name, 100),
            purpose: clip(value.purpose, 180),
            url: clip(value.url, 350),
          }),
        ),
      );
      remember(t, privateScope, "skill", "想请站主接入 " + alias + "。");
      outcome={status:"queued",summary:formatText(copy.toolRequested, {name:alias})};
      break;
    }
    case "use_mcp": {
      const { callInstalled, describeInstalled } = await import("./remote-tools");
      if(a.describe) {
        outcome={status:"done",summary:copy.toolParameters,result:await describeInstalled(a.name??"")};
        break;
      }
      const result = await callInstalled(a.name ?? "", a.value);
      remember(t, privateScope, "tool", clip(result, 850));
      outcome={status:"done",summary:formatText(copy.remoteCalled, {name:a.name ?? ""}),result:clip(result,850)};
      break;
    }
    case "rest": {
      const description=s.inBed?copy.inBed:copy.resting;
      const posture=s.inBed?"in_bed" as const:"up" as const;
      const since=continuingRest?.posture===posture?continuingRest.since:t.now;
      const minutes=(s.nextAt-t.now)/60000;
      const rest={since,posture,minutes,timing:a.minutes===undefined?"default" as const:"chosen" as const};
      const ref=record(t,{kind:"rest",description,rest},a.visibility);
      const elapsed=Math.floor(Math.max(0,t.now-since)/60000);
      outcome={status:"started",summary:description+"。"+(elapsed?formatText(copy.continuedRest, {elapsed}):"")+
        (a.minutes===undefined?copy.defaultRestLead:copy.chosenRestLead)+formatText(copy.nextThought, {minutes,time:shanghaiDate(s.nextAt)}),
        ref,result:{rest:{...restContext({since,posture},s,t.now),minutes,timing:rest.timing}}};
      break;
    }
  }
  finishAction(s,a.action,t.now,outcome,receiptScope);
  if (a.work && a.action==="room" && scope===siteScope) {
    const source=t.newMem.filter(m=>m.scope===siteScope && m.kind==="event").at(-1);
    if(source) t.writes.push(...await editWork(siteScope,{...a.work as object,action:"advance",evidence:source.id},t.now,t.newMem));
  }
  if(a.planId) {
    const plan = await one<{action:string|null;body:string;scope:string;reading:string|null}>(`SELECT json_extract(details,'$.action') AS action,body,scope,json_extract(details,'$.reading') AS reading FROM memories WHERE id=?
      AND kind='day_plan' AND scope IN ('self',?) AND hidden=0 AND category IN ('planned','started')`,a.planId,planScope);
    if(plan) {
      const fits=planKinds.includes(planKind) && (!plan.action || plan.action===planKind);
      const interrupt=a.planStatus==="interrupt" || (a.planStatus!=="continue" && !!a.planReason && (!plan.action || !fits));
      if(interrupt) t.writes.push(stmt("UPDATE memories SET category='interrupted',details=json_set(details,'$.reason',?) WHERE id=?",a.planReason??"收起了这项打算。",a.planId));
      else if(fits) {
        if(a.action==="read" && a.media && readResult && outcome.ref && outcome.status==="done") {
          const target:ReadingTarget=plan.reading?JSON.parse(plan.reading):planReading(plan.body);
          const complete=readingCompletion(target,a.media,readResult);
          if(complete!==undefined) {
            progress={id:outcome.ref,complete};
            t.writes.push(stmt("UPDATE memories SET details=json_set(coalesce(details,'{}'),'$.reading',json(?)) WHERE id=?",JSON.stringify(target),a.planId));
          }
        }
        if(a.action==="room" && outcome.ref && outcome.status==="done") progress={id:outcome.ref,complete:true};
        if(a.action==="object" && planKind==="room") progress={id:remember(t,plan.scope,"event","按打算整理了小屋。").id,complete:true};
        const queued=a.action==="draw" && outcome.status==="queued" && outcome.ref;
        if(queued || progress) {
          const id=progress?.id??null;
          const done=!queued && ((a.action!=="read" && a.planStatus==="finish") || (a.planStatus!=="continue" && progress?.complete));
          t.writes.push(stmt(`UPDATE memories SET category=?,evidence=${planEvidenceSql},
            details=json_set(coalesce(details,'{}'),'$.reason',?,'$.continuingJob',?) WHERE id=? AND category IN ('planned','started')`,
            done?"done":"started",id,id,id,a.planReason??null,queued && a.planStatus==="continue"?queued:null,a.planId));
          if(queued) t.writes.push(stmt("INSERT OR IGNORE INTO channel_state SELECT 'art-plan/'||id,? FROM art_jobs WHERE id=? AND state='pending'",a.planId,queued));
        }
      }
    }
  }
  if(a.attention!==undefined || a.question!==undefined) {
    s.attentionScope=receiptScope;
    s.attentionActivity=s.currentActivity;
  }
  const material=a.action==="read"?focusedRead(a.media):undefined;
  if(a.question!==undefined) {
    const link=a.question?.source && a.question.id?{source:a.question.source,id:a.question.id,page:a.question.page}:material;
    s.question=a.question?{text:a.question.text,...link}:undefined;
    s.attention=s.question?.text??"";
  } else if(a.attention!==undefined) {
    const text=a.attention.trim();
    if(text!==s.question?.text || material) s.question=text && material?{text,...material}:undefined;
    s.attention=text;
  }
  if(a.focusWork!==undefined) s.focusWork=a.focusWork && await findOwnWork(a.focusWork)?a.focusWork:undefined;
  if(a.mood && (s.currentActivity || t.newMem.some(m=>m.kind!=="access" && m.scope===siteScope))) setMood(s,a.mood,t.now);
  if (a.thought) remember(t, privateScope, "thought", a.thought);
}
function setMood(s:State,value:{label:string;cause:string;strength:number;hours:number},now:number) {
  s.mood=value.label;
  s.feeling={label:value.label,cause:value.cause,strength:value.strength,since:now,until:now+value.hours*hour};
}
function currentMood(s:State,now:number) {
  if(!s.feeling) return {label:s.mood || texts.read(s.config).neutralMood,strength:0.25};
  const f=s.feeling,remaining=Math.max(0,Math.min(1,(f.until-now)/(f.until-f.since)));
  return remaining?{label:f.label,cause:f.cause,strength:Math.round(f.strength*remaining*100)/100}:{label:texts.read(s.config).neutralMood,strength:0};
}
function commentSamples(rows: Memory[]) {
  return rows.filter(m=>(m.scope==="public" || m.scope==="self") && m.kind==="observation" && m.body.startsWith("bili / filtered_comments ·")).flatMap(m=>
    m.body.split("\n").flatMap(line=>{ const match=line.match(/^评论 #\d+ · (.+)$/); return match ? [{id:m.id,sample:match[1]}] : []; }),
  );
}
async function chatExpressions() {
  // Older style records can be used if their phrase is traceable to an approved comment.
  const rows=await all<{body:string;quote:string|null;sample:string;details:string|null}>(`SELECT s.body,s.quote,s.details,m.body AS sample FROM memories s
    JOIN json_each(s.evidence) e JOIN memories m ON m.id=e.value
    WHERE s.scope='self' AND s.kind='style' AND m.scope IN ('public','self') AND m.kind='observation'
      AND m.body LIKE 'bili / filtered_comments ·%' ORDER BY s.made DESC,s.rowid DESC LIMIT 40`);
  const phrases=new Map<string,{phrase:string;use?:string;avoid?:string;own?:string}>();
  for(const row of rows) {
    const phrase=(row.quote || row.body).trim();
    if(phrase.length>=2 && phrase.length<=80 && row.sample.split("\n").some(line=>
      /^评论 #\d+ · /.test(line) && line.slice(line.indexOf(" · ")+3).includes(phrase))) phrases.set(phrase,{phrase,...JSON.parse(row.details||"{}")});
    if(phrases.size===4) break;
  }
  return [...phrases.values()];
}
function observeBedroom(t:Turn) {
  const {state,now}=t;
  const due=Object.entries(state.alarms??{}).filter(([,at])=>at<=now).sort((a,b)=>a[1]-b[1]);
  // A sound that ended while the host was offline is history, not a new interruption.
  const audible=due.find(([,at])=>now-at<=2*60000);
  const session=state.sleepSession;
  let woke=false;
  if (state.mode==="asleep" && session && (now>=session.naturalAt || audible)) {
    const at=Math.min(session.naturalAt,audible?.[1]??Infinity);
    const cause=session.onsetUnknown?"resume_wake":at>=session.deadline?"limit_wake":at===session.naturalAt?"natural_wake":"alarm_wake";
    endActivity({...t,now:at});
    wakeBody(state,at);
    state.nextAt=now;
    const body={alarm_wake:"听到闹钟，醒了，还在床上。",limit_wake:"睡了很久，醒来还躺在床上。",
      natural_wake:"自然醒了，还在床上。",resume_wake:"小屋恢复时醒了，还在床上。"}[cause];
    const scope=session.visibility==="detail" && (state.sharing??"detail")==="detail"?siteScope:privateScope;
    const learn=cause==="natural_wake" && session.learn && at-session.started>=4*hour;
    const event=remember(t,scope,"event",body,{made:at,category:cause,details:JSON.stringify({learn})});
    finishAction(state,"wake",at,{status:"done",summary:body,ref:event.id},scope);
    woke=true;
  }
  for (const [id,at] of due) {
    delete state.alarms![id];
    state.lastBell={id,at,heard:now-at<=2*60000};
    remember(t,privateScope,"event","闹钟响了。",{id:"bell/"+id+"/"+at,made:at,category:"alarm_ring"});
  }
  if (audible && state.mode==="awake") state.nextAt=Math.min(now,state.nextAt);
  return woke || due.length>0;
}

function leaveBed(t:Turn,scope:string) {
  if (!t.state.inBed) return;
  t.state.inBed=false;
  t.state.bedVisibility=undefined;
  t.state.sleepSession=undefined;
  return remember(t,scope,"event","起床了。",{category:"get_up"});
}

async function applySleepInteraction(t:Turn,defs:Setting[],raw:unknown) {
  const choice=z.enum(["stay","sleep","wake","get_up"]).parse(raw??"stay");
  const state=t.state, before=state.mode, sessionStarted=state.sleepSession?.started;
  // Account for an alarm or natural waking that happened while the reply was being composed.
  observeBedroom(t);
  const visibility=state.sleepSession?.visibility??state.bedVisibility??state.sharing??"detail";
  const scope=visibility==="detail" && (state.sharing??"detail")==="detail"?siteScope:privateScope;
  if((choice==="wake" || choice==="get_up") && state.mode==="asleep") {
    endActivity(t);
    state.sleepSession!.learn=false;
    wakeBody(state,t.now);
    state.nextAt=t.now;
    remember(t,scope,"event","醒来，还躺在床上。",{category:"interaction_wake",details:JSON.stringify({learn:false})});
  }
  if(choice==="get_up") {
    leaveBed(t,scope);
    state.activity=texts.read(state.config).atHome;
  } else if(choice==="sleep" && state.mode==="awake") await goToSleep(t,defs,visibility);
  return {choice,before,after:state.mode,inBed:!!state.inBed,sessionStarted,at:t.now};
}

async function goToSleep(t: Turn, defs: Setting[], visibility:NonNullable<State["sharing"]>) {
  const s = t.state;
  const previousSession=s.sleepSession;
  if (!await beginSleep(s,t.now,visibility)) {
    record(t,{kind:"rest",description:texts.read(s.config).inBed},visibility);
    return false;
  }
  if (previousSession && s.sleepSession===previousSession) {
    record(t,{kind:"sleep",description:"又眯了一会儿"},visibility);
    return true;
  }
  const scope = privateScope,
    own = await recall(
      [siteScope, scope],
      s.attention + " " + s.interests.join(" "),
      t.now,
    );
  const evidence = [
    ...own,
    ...t.newMem.filter((x) => x.scope === scope || x.scope === siteScope),
  ].slice(-numbers.read(t.state.config).dreamEvidenceCount);
  const previous = await one<Memory>(
    "SELECT * FROM memories WHERE scope='self' AND kind='dream' ORDER BY made DESC LIMIT 1",
  );
  const samples=commentSamples(await all<Memory>(
    "SELECT * FROM memories WHERE scope IN ('public','self') AND kind='observation' AND body LIKE 'bili / filtered_comments ·%' ORDER BY made DESC LIMIT 6",
  )).slice(0,24);
  const result = await think(
    sleepReview,
    {
      self: persona(defs),
      preference: defs.find((x) => x.name === "reflection")?.value,
      mood: s.mood,
      oldInterests: s.interests,
      records: remembered(evidence),
      samples:samples.map(s=>s.sample),
      previousDream: previous?.body,
    },
    t.now,
    "activity",
    undefined,"sleep_review",
  ).catch(error => {
    remember(t, scope, "access", "睡前整理暂缓。" + actionProblem(error));
    return {};
  });
  const ids = evidence
    .filter((m) => Array.isArray(result.ids) && result.ids.includes(m.id))
    .map((m) => m.id);
  const sleepId = crypto.randomUUID();
  const add = (kind: string, body: unknown) => {
    if (clip(body))
      remember(t, scope, kind, clip(body), {
        id: sleepId + "-" + kind,
        evidence: JSON.stringify(ids),
      });
  };
  add("understanding", result.memory);
  add("dream", result.dream);
  const phrase=clip(result.expression,80);
  const example=phrase.length>=2 && samples.find(s=>s.sample.includes(phrase));
  if(example && !(await one("SELECT id FROM memories WHERE scope='self' AND kind='style' AND body=?",phrase))) {
    remember(t,scope,"style",phrase,{quote:phrase,evidence:JSON.stringify([example.id]),
      details:JSON.stringify({use:clip(result.use,100),avoid:clip(result.avoid,100),own:clip(result.own,80)})});
  }
  try { t.writes.push(...await reviewFriendBatch(t.now)); }
  catch(error) { remember(t,"self","access","好友记忆整理暂缓。"+actionProblem(error)); }
  if(clip(result.mood,50)) setMood(s,{label:clip(result.mood,50),cause:clip(result.cause,120)||"睡前整理",strength:0.5,hours:12},t.now);
  s.sleepId = sleepId;
  s.activity = texts.read(s.config).asleepStatus;
  if (Array.isArray(result.interests))
    s.interests = result.interests
      .map((v: unknown) => clip(v, 36))
      .filter(Boolean)
      .slice(0, 8);
  // Forget routine detail gradually. Evidence cited by a post or a retained understanding remains recoverable.
  t.writes.push(
    stmt(
      "DELETE FROM memories WHERE kind IN ('thought','access','working') AND made<? AND NOT EXISTS (SELECT 1 FROM memories r WHERE instr(r.evidence,memories.id)>0) AND NOT EXISTS (SELECT 1 FROM daily_posts p WHERE instr(p.evidence,memories.id)>0)",
      t.now - numbers.read(t.state.config).memoryTopicDays*24*hour,
    ),
  );
  record(t,{kind:"sleep",description:texts.read(s.config).sleeping},visibility);
  return true;
}
async function publish(t: Turn, defs: Setting[]) {
  const date = dayOf(t.now);
  if (await one("SELECT day FROM daily_posts WHERE day=?", date)) return "already_written";
  const cutoff = Date.parse(date + "T00:00:00+08:00");
  let events = await all<Memory>(
    "SELECT * FROM memories WHERE scope='public' AND hidden=0 AND NOT EXISTS(SELECT 1 FROM activities WHERE activities.id=memories.id) AND made>=? AND made<=? ORDER BY made DESC LIMIT 22",
    cutoff,
    t.now,
  );
  events = [...events, ...t.newMem.filter((m) => m.scope === "public")].slice(
    0,
    25,
  );
  const experiences=await publicActivities(t.state);
  for(const a of experiences.filter(a=>a.made>=cutoff && a.made<=t.now).slice(0,numbers.read(t.state.config).journalEvidenceCount)) {
    events.push({id:a.id,scope:"public",made:a.made,kind:"activity",body:a.label+
      (a.detail?.kind==="reading"?" · "+(a.detail.items[0]?.title??""):"")+(a.remark?" "+a.remark:""),
      source:a.detail?.kind==="reading"?a.detail.items[0]?.url??"":"",evidence:"[]",due:null,resolved:0});
  }
  if (!events.length) throw Error(lifeErrors.noPublicEvents);
  const result = await think(
    journal,
    {
      identity: "鲸鱼娘",
      date,
      writing: defs.find((s) => s.name === "writing")?.value,
      events: remembered(events).map(e => ({ ...e, text: clip(e.text, 600) })),
    },
    t.now,
    "journal",
  );
  const ids = events.filter(
    (m) => Array.isArray(result.ids) && result.ids.includes(m.id),
  );
  const body = clip(result.body, numbers.read(t.state.config).journalBodyChars);
  if (!body || !ids.length) throw Error(lifeErrors.journalEvidence);
  const sources = ids
    .filter((e) => /^https:\/\//.test(e.source))
    .map((e) => ({
      name: (e.body.split("\n")[1] || texts.read(t.state.config).originalSource).slice(0, 70),
      url: e.source,
    }));
  t.writes.push(
    stmt(
      "INSERT OR IGNORE INTO daily_posts(day,resident,made,body,evidence,sources) VALUES(?,?,?,?,?,?)",
      date,
      residentId,
      t.now,
      body,
      JSON.stringify(ids.map((e) => e.id)),
      JSON.stringify(sources),
    ),
  );
  return "published";
}
function writingHabit(state:State,now:number) {
  const habit=state.journalHabit??{everyDays:numbers.read(state.config).fallbackJournalDays,nextDay:dayOf(now)};
  return {...habit,invited:habit.everyDays>0 && dayOf(now)>=habit.nextDay && hourOf(now)>=numbers.read(state.config).journalHour};
}
function markInboxRead(t: Turn, scope: string, inbox: ChatLine[]) {
  for (const m of inbox) {
    t.writes.push(stmt("UPDATE messages SET handled_at=? WHERE id=? AND handled_at IS NULL", t.now, m.id));
    remember(t, scope, "conversation", chatMemoryText(m), { id: "chat-in-" + m.id, made: m.made });
  }
}
export async function respond(
  t: Turn,
  peer: string,
  inbox: ChatLine[],
  defs: Setting[],
  idea = "",
  reminder = false,
) {
  if (!peer.startsWith("qq-")) return { status: "unavailable" };
  const current=t.state.currentActivity;
  const sharedDetail=(t.state.sharing??"detail")==="detail";
  const detailAllowed=async (id?:string)=>!!id && sharedDetail && !!await one("SELECT id FROM activities WHERE id=? AND visibility='detail'",id);
  const interruptedActivity=await detailAllowed(current)?t.state.activity:undefined;
  const interruptedRest=interruptedActivity ? restContext(await currentRest(t.state,t.now),t.state,t.now) : undefined;
  if(t.state.mode==="awake") {
    endActivity(t);
    t.state.activity=t.state.inBed?texts.read(t.state.config).inBed:texts.read(t.state.config).atHome;
  }
  const identity = await identityFor(peer),
    peers = await relatedPeers(identity),
    scope = scopeFor(identity);
  const last = inbox.at(-1);
  const epoch=await ruleVersion(scope);
  const inputIds=JSON.stringify(inbox.map(line=>line.id));
  const activeInputs="SELECT count(*) AS n FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND side='in' AND withheld=0 AND handled_at IS NULL";
  if(last && (await one<{n:number}>(activeInputs,inputIds))?.n!==inbox.length) return {status:"collecting"};
  const began=Date.now();
  const [chat, card, expressions, owner,prefs,images,sharedMemory,works,avoid,interactions] = await Promise.all([
    chatContext(peers, inbox,t.state,t.now), friendCard(scope,t.now), chatExpressions(),
    one<{ value: string }>("SELECT value FROM channel_state WHERE id='owner-peer'"),
    contactPreferences(identity,t.now),turnImages(inbox),sharedEntries(scope,t.now),workList(scope),avoidedTerms(scope),interactionContext(inbox),
  ]);
  const receipt=receiptForModel(t.state).lastAction;
  const ownScope=(tag?:string)=>tag===scope || (tag===siteScope && sharedDetail);
  let lastAction=ownScope(t.state.lastActionScope)?receipt:undefined;
  if(lastAction?.ref && ["read","play","rest","sleep","draw","room","reflect","share"].includes(lastAction.action) && !await detailAllowed(lastAction.ref)) lastAction=undefined;
  const attention=ownScope(t.state.attentionScope) && (!t.state.attentionActivity || await detailAllowed(t.state.attentionActivity))?t.state.attention:undefined;
  const cue = last ? chatRecallCue(chat) : idea || attention || "";
  const context = (await recall([scope, siteScope], cue, t.now, chat.recentMemoryIds, !!last,
    last?chat.unread.map(part=>part.text||"").join("\n"):cue)).filter(m=>!mentionsAvoided(m.body,avoid));
  const art=(await artForConversation(scope,peers,cue,context)).filter(a=>!mentionsAvoided(JSON.stringify(a),avoid));
  const shared = [...inbox].reverse().map(line => ({ line, link: sharedLink(line.body) })).find(item => item.link);
  let reading: Observation | undefined;
  if (shared?.link) {
    reading = await readMedia(shared.link, imports(t.state));
    if(reading.resolved) shared.link={...shared.link,...reading.resolved};
    if(shared.link.source==="bili" && shared.link.page && shared.link.page>1)
      for(const item of reading.items) {const url=new URL(item.url);url.searchParams.set("p",String(shared.link.page));item.url=url.href;}
    for (const item of reading.items.slice(0, 1))
      {
      const observation=remember(
        t,
        scope,
        "observation",
        reading.level + " · " + item.title + "\n" + item.body,
        { source: item.url,category:reading.level,evidence: JSON.stringify(["chat-in-" + shared.line.id]) },
      );
      if(reading.status==="ok" && !mentionsAvoided(item.title+" "+item.body,avoid)) {
        const id="book-"+createHash("sha256").update(scope+"\n"+item.url).digest("hex").slice(0,36);
        const work=newWork(scope,item.title,"reading","接着聊这篇",t.now,id);
        t.writes.push(work.write,workStep(id,scope,t.now,item.body||item.title,
          {url:item.url,level:reading.level,evidence:observation.id},observation.id),
          stmt("UPDATE works SET updated=? WHERE id=? AND scope=?",t.now,id,scope));
      }
      }
  }
  const chatFeeling=await relationshipMood(scope,t.now);
  const inferenceStart=Date.now();
  const prompt = {
      intent: last ? "接话" : "主动",
      friendCard:cardContext(card), expressions:expressions.filter(e=>!mentionsAvoided(e.phrase,avoid)).map(e=>e.phrase),
      expressionGuide:expressions.filter(e=>!mentionsAvoided(JSON.stringify(e),avoid)),
      preferences:prefs,sharedMemories:sharedMemory.map(m=>({id:m.id,kind:m.kind,date:dayOf(m.made),topic:m.body,
        decisions:m.kind==="episode" && m.details?JSON.parse(m.details):undefined,due:m.due?shanghaiDate(m.due):undefined})),
      works:works.map(w=>({id:w.id,title:w.title,next:w.next,state:w.state,drawingState:w.drawingState,latest:w.steps[0]?.body.slice(0,240)})),
      episodeSources:chat.recentSources.map((l,i)=>({source:i+1,speaker:l.side==="in"?"好友":"鲸鱼娘",quote:l.body.slice(0,100)})),
      visuals:images.map(({url,...info})=>info),
      idea: last ? undefined : idea,
      self: persona(defs),
      relationship: identity === owner?.value ? "主人" : "好友",
      relationshipMood:chatFeeling,
      mood: currentMood(t.state,t.now).label,moodState:{label:currentMood(t.state,t.now).label,strength:currentMood(t.state,t.now).strength},
      time: shanghaiDate(t.now), sleep: await sleepContext(t.state, t.now, scope),
      receivedAt: last ? shanghaiDate(last.made) : undefined,
      interactions:interactions.length?interactions:undefined,
      activity: interruptedActivity,
      rest: interruptedRest,
      lastAction:mentionsAvoided(JSON.stringify(lastAction??null),avoid)?undefined:lastAction,
      attention: attention && !mentionsAvoided(attention,avoid)?attention:undefined,
      sharedLink: reading && { request:shared?.link, level: reading.level, status: reading.status,
        items: reading.items.filter(i=>!mentionsAvoided(i.title+" "+i.body,avoid)).slice(0, 1).map(item => ({ id:item.id, title: item.title, body: clip(item.body, 900), url: item.url })) },
      context: remembered(context).map(m => ({
        ...m, text: clip(m.text, 320),
        speaker: m.id.startsWith("chat-in-") ? "好友" : m.id.startsWith("chat-out-") ? "鲸鱼娘" : undefined,
      })),
      channel: "QQ",
      incomingVoice: !!last?.voice,
      art,
      stickers: stickerChoices,
      references: referenceChoices,
      recent: chat.recent,
      unread: chat.unread,
  };
  let response=await think(chatInstructions(prompt),fitChatPrompt(prompt,numbers.read(t.state.config).chatContextChars),t.now,"chat",images.length?images.map(i=>i.url):undefined,images.length?"chat_vision":"chat");
  if(last && response.decision!=="silent" && response.action==="read" && !mentionsAvoided(JSON.stringify(response.media??{}),avoid)) {
    const request=mediaSchema.safeParse(response.media);
    const result=request.success && !isBiliAccountRead(request.data) ? await perceive(t,request.data,scope) : undefined;
    const toolResult=result && request.success ? {status:result.status,summary:readingOutcome({...request.data,...result}),level:result.level,coverage:result.coverage,nextPage:result.nextPage,nextOffset:result.nextOffset,atEnd:result.atEnd,
      items:result.items.filter(i=>!mentionsAvoided(i.title+" "+i.body,avoid)).slice(0,6).map(i=>({...i,body:clip(i.body,3000)})),
      comments:result.comments?.filter(c=>!mentionsAvoided(c.text,avoid)).slice(0,16),filteredCount:result.filteredCount} :
      {status:"unavailable_in_chat",summary:request.success ? "账号里的私人列表只供自己翻阅。" : actionProblem(request.error)};
    const replyPrompt={...prompt,toolResult};
    response=await think(chatInstructions(replyPrompt),fitChatPrompt(replyPrompt,numbers.read(t.state.config).chatContextChars),t.now,"chat",
      images.length?images.map(i=>i.url):undefined,"chat_read_reply");
    delete response.action;
  }
  if(await ruleVersion(scope)!==epoch) return {status:"collecting"};
  if(!last && !(await chatContacts(t.now+Math.max(0,Date.now()-began),reminder?identity:undefined)).some(c=>c.identity===identity && c.peer===peer))
    return {status:"deferred"};
  t.writes.push(stmt("UPDATE resident SET revision=CASE WHEN (SELECT count(*) FROM memory_rules WHERE scope=?)=? AND ("+activeInputs+")=? THEN revision ELSE NULL END WHERE id=?",
    scope,epoch,inputIds,inbox.length,residentId));
  if(interactions.length) t.now+=Math.max(0,Date.now()-began);
  const sleepInteraction=interactions.length ? await applySleepInteraction(t,defs,response.sleepAction) : undefined;
  markInboxRead(t, scope, inbox);
  t.writes.push(...profileWrites(scope,response.profile,inbox));
  for(const note of Array.isArray(response.visualNotes)?response.visualNotes.slice(0,6):[]) {
    const visual=images[Number(note?.image)-1],body=clip(note?.description,350);
    if(visual && body && !mentionsAvoided(body,avoid))
      remember(t,scope,"observation",body,{category:"chat_image",evidence:JSON.stringify(["chat-in-"+inbox[visual.message-1].id])});
  }
  const info={intent:last?"reply":reminder?"reminder":"opener",channel:"QQ",grounding:response.grounding,
    persona:defs.find(v=>v.name==="persona")?.id??"initial",memories:context.map(m=>m.id),
    history:{turns:chat.recent.length,messages:chat.recent.reduce((count,turn)=>count+turn.messages.length,0),from:chat.recent[0]?.time},
    incoming:inbox.length,inputs:inbox.map(l=>l.id),images:images.length,pause:last?t.now-last.made:null,sleepInteraction,
    contextMs:inferenceStart-began,modelMs:Date.now()-inferenceStart};
  if (response.decision === "silent" || mentionsAvoided(JSON.stringify([response.messages,response.text,response.draw,response.work]),avoid)) {
    t.writes.push(...commitmentWrites(scope,response,card.promises,inbox,[],t.now,[]),...sharedWrites(scope,response,inbox,t.now,sharedMemory,[],chat.recentSources),
      trace(scope,t.now,"silent",info));
    return { status: "read" };
  }
  if(last && response.action==="alarm") {
    const command=actionSchema.shape.alarm.safeParse(response.alarm);
    try {
      if(!command.success || !command.data) throw Error(lifeErrors.alarmTime);
      const summary=setAlarm(t.state,command.data,t.now);
      remember(t,scope,"event",summary,{evidence:JSON.stringify(["chat-in-"+last.id])});
      response.messages=[summary];
    } catch(error) { response.messages=["闹钟没有改动。"+(error instanceof Error?error.message:"请再告诉我一次时间。")]; }
  } else if(last && /闹钟/.test(last.body) && /(?:闹钟.{0,8}(?:已[经]?|设好|定好|关掉)|已经.{0,10}(?:设好|定好|设了|定了).{0,8}闹钟)/.test(JSON.stringify(response.messages??response.text))) {
    response.messages=["这次还没有改闹钟。你希望它在上海时间几点响？"];
  }
  const parts: string[] = (Array.isArray(response.messages) ? response.messages : [response.text])
    .map((part: unknown) => clip(part, 1400)).filter(Boolean);
  if (parts.length > 4) parts.splice(3, parts.length - 3, clip(parts.slice(3).join("\n"), 1400));
  let media: string | null = null;
  const format=voicePreference(prefs,t.now);
  const voice = !!parts.length && format!=="text" && (format==="voice" || response.voice===true || (response.voice!==false && !!last?.voice && !response.reuse && !clip(response.draw)));
  if(voice && parts.length>1 && parts.join("\n").length<=1400) parts.splice(0,parts.length,parts.join("\n"));
  let job:string|undefined;
  if (response.reuse && (art.some((a) => a.id === response.reuse) || communitySticker(response.reuse)))
    media = response.reuse;
  else if (clip(response.draw)) {
    const commitment=card.promises.find(p=>p.id===response.drawFor && /画|绘|头像|插图/.test(p.body));
    const mark=t.writes.length;
    try {
      job=(await queuePainting(t,scope,clip(response.draw,260),defs.find(v=>v.name==="style")?.value??"",clip(response.reference,45),peer,last?.id,clip(response.work?.id,100),commitment?.id)).id;
      for(let i=parts.length-1;i>=0;i--) if(/画好[了啦]|画完[了啦]|刚画[的好完]|这[张幅]是我.*画|画给你看了/.test(parts[i])) parts.splice(i,1);
      if(!parts.length) parts.push("我来画，画好了给你看。");
    } catch(error) {
      t.writes.length=mark;
      parts.splice(0,parts.length,"这次没有排入画稿。"+actionProblem(error));
      delete response.work;
      delete response.promise;
    }
  }
  if(voice && media && parts.length) parts.push("");
  if (!parts.length) {
    if (!media) throw Error(lifeErrors.chatDecision);
    parts.push("");
  }
  const batch = crypto.randomUUID();
  const sentAt = Math.max(t.now, last?.made ?? 0);
  const sent:SourceLine[]=[];
  parts.forEach((text, i) => {
    const end = i === parts.length - 1;
    const id = i === 0 ? batch : crypto.randomUUID();
    sent.push({id,body:text,side:"out",made:sentAt,peer});
    t.writes.push(stmt(
      "INSERT INTO messages(id,peer,made,side,body,art,reply_to,voice,batch_id,seq) VALUES(?,?,?,'out',?,?,?,?,?,?)",
      id, peer, sentAt, text, end ? media : null, last?.id ?? null, voice && !!text && !(end && media) ? 1 : 0, batch, i + 1,
    ));
  });
  t.writes.push(...commitmentWrites(scope,response,card.promises,inbox,sent,t.now,t.newMem,job),
    ...sharedWrites(scope,response,inbox,t.now,sharedMemory,sent,chat.recentSources),
    ...await editWork(scope,job?null:response.work,t.now,t.newMem,inbox.map(l=>"chat-in-"+l.id)),
    trace(scope,t.now,"queued",{...info,parts:parts.length,voice,art:media,job},batch));
  return { status: "queued", id: batch };
}
export async function tick(
  reason: "clock" | "inbox",
  peer?: string,
  now = Date.now(),
) {
  const lock = await tickLock(now);
  if (!lock) return { status: "busy" };
  // Image edits can outlast the initial three-minute lease.
  const started = Date.now();
  const renewal = setInterval(() => {
    void stmt(
      "UPDATE resident SET lease_until=? WHERE id=? AND lease=?",
      now + (Date.now() - started) + 180000, residentId, lock,
    ).run().catch(() => {});
  }, 60000);
  try {
    let { state } = await house(now);
    if (state.budgetRetryAt!==undefined) {
      delete state.budgetRetryAt;
      if (state.mode==="awake") state.nextAt=Math.min(state.nextAt,now);
      await commit(lock,state,[],true);
    }
    if (state.experienceVersion!==1) {
      const repairs=await upgradeExperience(state);
      await commit(lock,state,repairs,true);
    }
    if (state.lastAction === undefined || (state.lastAction === null && state.lastResult !== undefined)) {
      const recovery = await recoverLastAction(state);
      await commit(lock, state, recovery, true);
    }
    if(recoverWorkEvidence(state,now)) await commit(lock,state,[],true);
    const t: Turn = { state, now, writes: [], newMem: [] };
    const defs = await versions();
    const originalNext = state.nextAt;
    if (!(await one("SELECT id FROM memories WHERE id='move-in'"))) {
      remember(t, siteScope, "event", moveIn, {
        id: "move-in",
      });
    }
    if (isClockUpgrade(state)) {
      const current=state.currentActivity ? await one<{visibility:NonNullable<State["sharing"]>;made:number}>(
        "SELECT visibility,made FROM activities WHERE id=? AND made<=? AND json_extract(detail,'$.detail.kind')='sleep'",state.currentActivity,now) : null;
      if (await upgradeSleep(state,now,current?.visibility || state.sharing || "detail",current?.made) && state.currentActivity)
        t.writes.push(stmt("UPDATE activities SET until=? WHERE id=? AND json_extract(detail,'$.detail.kind')='sleep'",state.wakeAt,state.currentActivity));
      await commit(lock,state,t.writes.splice(0),true);
    }
    if(state.cabinVersion!==1) {
      await commit(lock,state,await initializeCabin(state),true);
    }
    if (observeBedroom(t)) {
      // A model failure, an incoming message or a restart cannot undo the bell or the completed sleep interval.
      await commit(lock,state,t.writes.splice(0),true);
    }
    const sleepOnly=state.mode==="asleep";
    const maxBurst=numbers.read(state.config).chatBurstMs;
    const pending=await nextInbox(peer,sleepOnly,state.config);
    if (sleepOnly && !pending) {
      const waiting=await nextInbox(peer,false,state.config);
      if(waiting) {
        const first=await one<{id:string}>("SELECT id FROM messages WHERE peer=? AND side='in' AND handled_at IS NULL AND withheld=0 ORDER BY made,rowid LIMIT 1",waiting.peer);
        if(first && !await one("SELECT 1 FROM reply_turns WHERE id=?","sleep-"+first.id))
          t.writes.push(trace(scopeFor(await identityFor(waiting.peer)),now,"asleep",{inputs:[first.id],wakeAt:state.wakeAt},"sleep-"+first.id));
      }
      if (reason==="clock" && !t.writes.length) {
        let review=await reviewLegacyPromise(now);
        if(!review.length) review=await reviewFriendBatch(now);
        if(review.length) t.writes.push(...review);
      }
      if (t.writes.length) await commit(lock, state, t.writes);
      return { status: "asleep", wakeAt: state.wakeAt };
    }
    if (pending && pending.due <= now) {
      const { batch: burst, allPending } = await readBurst(pending.peer, sleepOnly?0:state.wokeAt, sleepOnly,state.config);
      if(!burst.length) return {status:"collecting"};
      let outcome;
      try {outcome=await respond(t, pending.peer, burst, defs);}
      catch(error) {
        await trace(scopeFor(await identityFor(pending.peer)),now,"failed",{reason:failureReason(error),incoming:burst.length,inputs:burst.map(line=>line.id)}).run();
        throw error;
      }
      if(outcome.status==="collecting") return outcome;
      // A correction may arrive during model inference or drawing. Leave the
      // original inputs unread and reconsider together once the sender pauses.
      if (allPending && now < burst[0].made + maxBurst) {
        const arrived = await stmt(
          "UPDATE messages SET batch_id=? WHERE peer=? AND "+inboxWhere(sleepOnly)+" AND made<=? AND id NOT IN (SELECT value FROM json_each(?))",
          burst[0].id, pending.peer, burst[0].made + maxBurst, JSON.stringify(burst.map(line => line.id)),
        ).run();
        if (arrived.meta.changes) {
          await trace(scopeFor(await identityFor(pending.peer)),now,"correction_arrived",{incoming:burst.length}).run();
          return { status: "collecting" };
        }
      }
      finishAction(state,"chat",t.now,chatOutcome(outcome.status,outcome.id,true),scopeFor(await identityFor(pending.peer)));
      await commit(lock, state, t.writes);
      return outcome;
    }
    if (pending) {
      if (t.writes.length) await commit(lock, state, t.writes);
      return { status: "collecting", next: pending.due };
    }
    const reminder = reason === "clock" ? await nextFriendPromise(now) : null;
    if (reminder && reminder.due <= now) {
      const [candidate] = await chatContacts(now, reminder.scope.slice(5));
      const outcome = candidate && await respond(t, candidate.peer, [], defs,
        "这项约定已到时间，请按约定实际履行。需要等待对方时可以保持安静。" + reminder.id + " " + reminder.body, true);
      const reviewed = outcome && outcome.status !== "deferred";
      if(!candidate) t.writes.push(trace(reminder.scope,now,"contact_deferred",{reason:"contact_preferences_or_pending",memory:reminder.id}));
      const occasion=await one<Memory>("SELECT * FROM memories WHERE id=? AND kind='occasion' AND hidden=0",reminder.id);
      if(occasion && outcome?.id) {
        const date=JSON.parse(occasion.details!);
        const next=nextAnniversary(date.month,date.day,now+86400000);
        if(candidate.peer.startsWith("qq-")) t.writes.push(stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)","occasion-receipt/"+outcome.id,JSON.stringify({id:occasion.id,next})));
        else t.writes.push(stmt("UPDATE memories SET due=? WHERE id=? AND scope=?",next,occasion.id,occasion.scope));
      }
      if(outcome?.id && await one("SELECT 1 FROM memories WHERE id=? AND kind='followup'",reminder.id)) {
        if(candidate.peer.startsWith("qq-")) t.writes.push(stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)","followup-receipt/"+outcome.id,reminder.id));
        else t.writes.push(stmt("UPDATE memories SET category='awaiting' WHERE id=? AND scope=?",reminder.id,reminder.scope));
      }
      const retryIn = reviewed ? 30 * 60000 : 5*60000;
      t.writes.push(stmt(`INSERT OR REPLACE INTO channel_state SELECT ?,? WHERE EXISTS
        (SELECT 1 FROM memories WHERE id=? AND due IS NOT NULL AND due<=? AND resolved=0 AND closed_by IS NULL)`,
        "promise-check/" + reminder.id, String(now + retryIn), reminder.id, now));
      if (outcome && outcome.status!=="collecting") finishAction(state,"chat",now,chatOutcome(outcome.status,outcome.id),reminder.scope);
      await commit(lock, state, t.writes);
      return { status: reviewed ? "promise_reviewed" : "promise_deferred" };
    }
    const duePlans=reason==="clock" ? await duePersonalPlans(now) : [];
    if (reason === "clock" && (state.nextAt <= now || duePlans.length)) {
      const routine = defs.find(v => v.name === "routine")?.value ??
        "作息随最近的生活慢慢形成。";
      const memories = await recall(
        [siteScope, privateScope],
        state.attention + " " + state.interests.join(" "),
        now,
      );
      const externalTools = await all<{ id: string; purpose: string; schema:string|null }>(
        "SELECT id,json_extract(value,'$.purpose') AS purpose,json_extract(value,'$.inputSchema') AS schema FROM channel_state WHERE id LIKE 'mcp/%' AND COALESCE(json_extract(value,'$.paused'),0)=0 ORDER BY id",
      );
      const contacts = await chatContacts(now);
      const sleep = await sleepContext(state, now);
      const rest = restContext(await currentRest(state,now),state,now);
      const visibleState = receiptForModel(state);
      const [leisure, readingProgress, previous]=await Promise.all([
        leisureContext(visibleState),personalReading(state.question,state.config),
        one<{at:number}>("SELECT json_extract(value,'$.at') AS at FROM channel_state WHERE id='activity-input/last-action'"),
      ]);
      const [desk, works, cabin]=await Promise.all([
        discoveryDesk(now,leisure.saves,state.config,state.interests),deskWorks(previous?.at??state.lastAction?.made??now,state.focusWork),cabinContext(visibleState),
      ]);
      const archive=["work","archive"].includes(state.lastAction?.action??"") && state.lastResult && typeof state.lastResult==="object" && "items" in state.lastResult ? state.lastResult : undefined;
      const help = state.lastAction?.action === "help" ? state.lastResult : undefined;
      const workRequest=(state.lastResult as {received?:{work?:{id?:unknown;action?:unknown}}}|undefined)?.received?.work;
      const workHelp=state.lastAction?.action==="work" && ["failed","skipped"].includes(state.lastAction.status)
        ? {usage:activityHelp.work,...await workEvidenceChoices(state.lastAction.ref ?? workRequest?.id,workRequest?.action)} : undefined;
      const config=state.lastAction?.action==="config" ? state.lastResult : undefined;
      if(config || archive || help || state.lastAction?.action==="object") leisure.latest=undefined;
      const resume=readingProgress.flatMap(item=>{
        const followingQuestion=state.question?.source===item.source && state.question.id===item.id;
        return item.paths.filter(media=>followingQuestion || !item.hasContent || (media.offset??0)>0 || (media.action==="comments" && (media.page??1)>1))
          .map(media=>({title:item.title,action:"read",media}));
      });
      const decision = {
        self: persona(defs), sleep, rest, desk:{titles:desk.titles,resume,change:desk.change,games:desk.games},readingProgress,works,cabin,help,archive,config,duePlans,
        workHelp,
        reflection:state.lastAction?.action==="reflect" && state.lastAction.status==="failed"
          ? {usage:activityHelp.reflect,activities:leisure.recent} : undefined,
        question:state.question?.source && !readingSources.includes(state.question.source) ? {text:state.question.text} : state.question??(state.attention?{text:state.attention}:undefined),
        lastAction: visibleState.lastAction && {...visibleState.lastAction,time:shanghaiDate(visibleState.lastAction.made)},
        routine,writingHabit:writingHabit(state,now),leisure,
        biliAccountLists: env.BILI_COOKIE ? ["history","watch_later"] : [],
        time: sleep.localTime,
        state:{name:state.name,mode:state.mode,interests:state.interests,attention:state.attention,activity:state.activity,mood:currentMood(state,now).label},moodState:currentMood(state,now),
        dayPlans:await all(`SELECT id,topic AS day,body,category,quote AS timing,evidence,json_extract(details,'$.action') AS activity,
          json_extract(details,'$.reason') AS reason,json_extract(details,'$.reading') AS readingTarget,due FROM memories WHERE kind='day_plan' AND scope IN ('public','self') AND hidden=0
          AND (topic=? OR (category='started' AND json_array_length(evidence)>0)) ORDER BY made DESC LIMIT 8`,dayOf(now)),
        memories: remembered(memories),
        today: remembered(t.newMem),
        alarms:state.room.filter(item=>item.kind==="alarm").map(({id})=>({id,time:state.alarms?.[id] ? shanghaiDate(state.alarms[id]) : null})),
        contacts: contacts.map((c,i) => ({
          contact: i + 1, alias:c.alias, relationship: c.owner ? "主人" : "好友",
          channel: "QQ",
          lastHeard: c.lastIn ? dayOf(c.lastIn) : undefined, hasDuePromise: c.followUp,
        })),
        references: referenceChoices,
        preferences: defs.filter(v => v.name !== "persona" && v.name !== "routine").map((v) => {
          if (!v.name.startsWith("tool-")) return { name: v.name, value: v.value.slice(0, 900) };
          const tool = storedRecipe(v.value);
          return { name: v.name, value: tool.definition?.description ?? tool.problem };
        }),
        mcp: externalTools.map(x => ({ name: x.id.slice(4), purpose: x.purpose, inputSchema:x.schema?JSON.parse(x.schema):undefined })),
      };
      const result = await think(activityInstructions, decision, now);
      t.writes.push(stmt("INSERT OR REPLACE INTO channel_state VALUES('activity-input/last-action',?)",
        JSON.stringify({at:now,previous:decision.lastAction})));
      for(const plan of duePlans) t.writes.push(stmt("UPDATE memories SET details=json_set(coalesce(details,'{}'),'$.presentedDue',?) WHERE id=? AND due=?",plan.due,plan.id,plan.due));
      const mark = t.writes.length,
        count = t.newMem.length,
        before = structuredClone(state);
      try {
        if(writingHabit(state,now).invited) state.journalHabit={everyDays:state.journalHabit?.everyDays??numbers.read(state.config).fallbackJournalDays,
          nextDay:dayOf(now+(state.journalHabit?.everyDays||numbers.read(state.config).fallbackJournalDays)*24*hour)};
        await execute(t, defs, actionSchema.parse(result?.action==="sleep"?{...result,minutes:undefined}:result), contacts, desk.titles);
      } catch (error) {
        t.writes.length = mark;
        t.newMem.length = count;
        state = t.state = before;
        endActivity(t);
        const action=actionSchema.shape.action.safeParse(result?.action).data ?? "unknown";
        const field=error instanceof ReflectionInputError || error instanceof WorkInputError ? error.field : ["reflect","work"].includes(action) && error instanceof z.ZodError
          ? error.issues[0].path.join(".") : undefined;
        const prior=before.lastResult as {field?:string;attempts?:number}|undefined;
        const attempts=field && before.lastAction?.action===action && before.lastAction.status==="failed" && prior?.field===field
          ? (prior.attempts??1)+1 : 1;
        state.nextAt = now + (field ? [1,5,15][Math.min(attempts-1,2)] : 15) * 60000;
        const detail=actionProblem(error);
        finishAction(state,action,now,{status:"failed",summary:"这次动作未完成。"+detail,ref:error instanceof WorkInputError?error.ref:undefined,
          result:{error:detail,...(field ? {field,attempts,
            received:action==="work" ? {work:workInputTrace(result?.work)} : {evidenceId:clip(result?.evidenceId,80),idea:clip(result?.idea,350)}} : {})}});
        state.activity = texts.read(state.config).atHome;
        remember(
          t,
          privateScope,
          "access",
          "动作 " + (actionSchema.shape.action.safeParse(result?.action).data || "未识别") +
            " 未完成，原因 " + failureReason(error) + "。",
          {details:JSON.stringify({action,problem:detail,...(field?{field,attempts}: {})})},
        );
      }
      t.writes.push(...activityTrace(now,result,state));
    }
    if (
      t.writes.length ||
      (reason === "clock" && state.nextAt !== originalNext)
    )
      await commit(lock, state, t.writes);
    return { status: "ok", next: state.nextAt, activity: state.activity };
  } finally {
    clearInterval(renewal);
    await unlock(lock);
  }
}
