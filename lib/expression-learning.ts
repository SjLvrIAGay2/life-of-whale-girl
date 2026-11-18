import { createHash } from "node:crypto";
import { z } from "zod";
import { numbers } from "../config/numbers";
import { all, stmt } from "../db";
import { mentionsAvoided } from "./memory-control";
import { semanticHits } from "./semantic-memory";

const readingLevels = {
  bili_comment: "bili / filtered_comments · ",
  heybox_discussion: "heybox / discussion · ",
  heybox_article: "heybox / article · ",
};
type ReadingKind = keyof typeof readingLevels;
export type StyleSample = {
  evidence: string;
  kind: ReadingKind | "private_message";
  text: string;
  context?: string;
};
type ObservationRow = {id:string; body:string; details:string|null};
type Comment = {id:string; text:string; parent?:string};

function savedDetails(json:string|null) {
  try { return JSON.parse(json || "{}") ?? {}; }
  catch { return {}; } // Some early observations only have the formatted body.
}

function observationSamples(row: ObservationRow, kind: ReadingKind): StyleSample[] {
  if (!row.body.startsWith(readingLevels[kind])) return [];
  const [,title,...lines] = row.body.split("\n");
  const sample = (text:string, context=title):StyleSample => ({evidence:row.id,kind,text,context});
  if (kind === "heybox_article") {
    const body = lines.join("\n").trim();
    // Keep adjacent sentences together so the model can see their rhythm and transitions.
    return (body.match(/[\s\S]{1,600}(?:[。！？\n]|$)|[\s\S]{1,600}/gu) ?? []).map(text=>sample(text));
  }
  const stored = savedDetails(row.details).comments;
  if (Array.isArray(stored)) {
    const comments:Comment[] = stored.filter(c=>c && typeof c.text==="string" && c.text.trim());
    const byId = new Map(comments.map(c=>[c.id,c.text]));
    return comments.map(c=>sample(c.text,[title,byId.get(c.parent ?? "")].filter(Boolean).join("\n")));
  }
  // Pre-upgrade observations kept the approved comments as numbered lines after the title.
  return lines.flatMap(line=>{
    const match = (kind==="bili_comment" ? /^评论 #\d+ · (.+)$/u : /^评论 #[\w-]+ · (.+)$/u).exec(line);
    return match ? [sample(match[1])] : [];
  });
}

function interleave<T>(groups:T[][], limit:number) {
  const items:T[] = [];
  for (let i=0; groups.some(group=>i<group.length); i++)
    for (const group of groups) {
      if (i<group.length) items.push(group[i]);
      if (items.length>=limit) return items;
    }
  return items;
}

// Offsets advance in the same database batch as the lessons. -1 means the source was read to its end.
export function styleReviewProgress(offsets:Map<string,number>) {
  return stmt(`INSERT OR REPLACE INTO channel_state(id,value)
    SELECT 'style-review/'||key,CAST(value AS TEXT) FROM json_each(?)`,JSON.stringify(Object.fromEntries(offsets)));
}

export async function readingStyleBatch(limit:number, now:number) {
  const positions = new Map<string,{offset:number; total:number}>();
  const groups = await Promise.all((Object.keys(readingLevels) as ReadingKind[]).map(async kind=>{
    const rows = await all<ObservationRow & {offset:number}>(`SELECT m.id,m.body,m.details,
      CAST(COALESCE(p.value,'0') AS INTEGER) AS offset FROM memories m
      LEFT JOIN channel_state p ON p.id='style-review/'||m.id
      WHERE m.scope IN ('self','public') AND m.kind='observation' AND m.hidden=0 AND m.made<=? AND m.body GLOB ?
      AND COALESCE(p.value,'0')<>'-1' ORDER BY m.made DESC,m.rowid DESC LIMIT ?`,now,readingLevels[kind]+"*",limit);
    const perReading = rows.map(row=>{
      const samples = observationSamples(row,kind);
      positions.set(row.id,{offset:row.offset,total:samples.length});
      return samples.slice(row.offset);
    });
    return interleave(perReading,limit);
  }));
  const samples = interleave(groups,limit);
  function advance(seen:StyleSample[]) {
    const offsets = new Map<string,number>();
    for (const [id,pos] of positions) if (pos.offset>=pos.total) offsets.set(id,-1);
    for (const {evidence} of seen) {
      const pos = positions.get(evidence)!;
      const offset = (offsets.get(evidence) ?? pos.offset)+1;
      offsets.set(evidence,offset>=pos.total ? -1 : offset);
    }
    return styleReviewProgress(offsets);
  }
  return {samples,advance};
}

const field = (max:number)=>z.string().trim().min(2).max(max);
const cues = z.array(z.string().trim().min(1).max(32)).max(8);
const technique = z.object({
  pattern:field(160), tone:field(80), use:field(140), avoid:field(140),
  cues:cues.min(1), avoidCues:cues.default([]),
});
const lesson = technique.extend({source:z.number().int().positive(),quote:field(240)});
const normalize = (s:string)=>s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
const sceneText = (s:string)=>s.normalize("NFKC").toLowerCase().replace(/\s+/gu,"");

export function styleWrites(scope:string, raw:unknown, samples:(StyleSample | undefined)[], now:number, limit:number, avoided:string[] = []) {
  const writes:D1PreparedStatement[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(raw)) return writes;
  for (const entry of raw) {
    const parsed = lesson.safeParse(entry);
    if (!parsed.success) continue;
    const {source,quote,...guide} = parsed.data;
    const sample = samples[source-1];
    if (!sample?.text.includes(quote) || (sample.kind==="private_message") !== scope.startsWith("chat:")) continue;
    const pattern = normalize(guide.pattern);
    const topic = [pattern,normalize(guide.tone),normalize(guide.use)].join("/");
    if (!pattern || seen.has(topic) || normalize(sample.text).includes(pattern) || mentionsAvoided(JSON.stringify(entry),avoided)) continue;
    seen.add(topic);
    const body = [guide.use,...guide.cues,guide.tone,guide.pattern].join(" ");
    const id = "style-"+createHash("sha256").update(JSON.stringify([scope,topic,sample.evidence])).digest("hex");
    // Recheck the source at commit time. A friend can withdraw a message during inference.
    const live = sample.kind==="private_message"
      ? "SELECT 1 FROM messages WHERE id=? AND side='in' AND handled_at IS NOT NULL AND withheld=0 AND withdrawn=0 AND instr(body,?)>0"
      : "SELECT 1 FROM memories WHERE id=? AND scope IN ('self','public') AND kind='observation' AND hidden=0";
    const proof = sample.kind==="private_message" ? [sample.evidence.slice("chat-in-".length),quote] : [sample.evidence];
    writes.push(stmt(`INSERT OR IGNORE INTO memories(id,made,scope,kind,body,source,evidence,topic,quote,category,details)
      SELECT ?,?,?,'style',?,'',?,?,?,?,? WHERE EXISTS(${live}) AND NOT EXISTS
      (SELECT 1 FROM memories WHERE scope=? AND kind='style' AND topic=? AND hidden=0)`,
      id,now,scope,body,JSON.stringify([sample.evidence]),topic,quote,sample.kind,JSON.stringify(guide),...proof,scope,topic));
    if (writes.length>=limit) break;
  }
  return writes;
}

type Guide = {pattern?:string; tone?:string; use?:string; avoid?:string; example?:string};
type SavedStyle = {id:string; body:string; quote:string|null; category:string|null; details:string|null; legacySource:string|null};
function readGuide(row:SavedStyle) {
  const details = savedDetails(row.details);
  if (row.category) {
    const parsed = technique.safeParse(details);
    if (!parsed.success) return;
    const {cues,avoidCues,...guide} = parsed.data;
    return {guide,cues,avoidCues};
  }
  const phrase = row.quote || row.body;
  if (!row.legacySource || phrase.length<2 || phrase.length>80 || !observationSamples(
    {id:"",body:row.legacySource,details:null},"bili_comment").some(s=>s.text.includes(phrase))) return;
  const value = (v:unknown)=>typeof v==="string" && v.trim() || undefined;
  const guide:Guide = {example:value(details.own) || phrase,use:value(details.use),avoid:value(details.avoid)};
  return {guide,cues:[phrase],avoidCues:[] as string[]};
}

export async function chatExpressionGuide(
  scope:string, peers:string[], latest:string, context:string, avoided:string[], n:typeof numbers.defaults,
) {
  const cue = sceneText(latest.trim() || context);
  if (!cue) return [];
  const rows = await all<SavedStyle>(`SELECT s.id,s.body,s.quote,s.details,s.category,
    CASE WHEN s.category IS NULL THEN o.body END AS legacySource
    FROM memories s JOIN json_each(s.evidence) e LEFT JOIN memories o ON o.id=e.value
    WHERE s.kind='style' AND s.hidden=0 AND s.scope IN ('self',?) AND (
      (s.scope='self' AND o.hidden=0 AND o.scope IN ('public','self') AND o.kind='observation' AND
       ((COALESCE(s.category,'bili_comment')='bili_comment' AND o.body GLOB 'bili / filtered_comments · *')
       OR (s.category='heybox_discussion' AND o.body GLOB 'heybox / discussion · *')
       OR (s.category='heybox_article' AND o.body GLOB 'heybox / article · *')))
      OR (s.scope=? AND s.category='private_message' AND COALESCE(o.hidden,0)=0 AND EXISTS
        (SELECT 1 FROM messages l WHERE l.id=substr(e.value,9) AND e.value='chat-in-'||l.id AND l.side='in'
        AND l.peer IN (SELECT value FROM json_each(?)) AND l.handled_at IS NOT NULL AND l.withheld=0 AND l.withdrawn=0)))
    ORDER BY s.made DESC,s.rowid DESC`,scope,scope,JSON.stringify(peers));
  if (!rows.length) return [];
  // Backchannels and references such as “这句呢” borrow their scene from the preceding exchange.
  const followUp = /^(?:[嗯哦啊唉哈好对是呀呢啦嘛]+|继续|然后呢?|后来呢?|还有呢|真的吗|怎么说|那怎么办|[这那](?:个|句|件事|样)呢?)$/u;
  const useHistory = !latest.trim() || followUp.test(normalize(cue));
  const preceding = useHistory ? sceneText(context) : "";
  const hits = await semanticHits(["self",scope],useHistory ? context : latest,[],"style").catch(()=>[]);
  const scores = new Map(hits.map(hit=>[hit.memory.id,hit.score]));
  const ranked:{guide:Guide; score:number}[] = [];
  for (const row of rows) {
    const saved = readGuide(row);
    if (!saved || mentionsAvoided(JSON.stringify(saved),avoided)) continue;
    const {guide,cues,avoidCues} = saved;
    if (avoidCues.map(sceneText).some(word=>cue.includes(word) || preceding.includes(word))) continue;
    const signals = cues.map(sceneText);
    const direct = signals.filter(word=>cue.includes(word)).length;
    const previous = signals.some(word=>preceding.includes(word));
    const use = normalize(guide.use ?? "");
    const overlap = new Set<string>();
    for (let i=0; i+1<use.length; i++) {
      const pair = use.slice(i,i+2);
      if (cue.includes(pair)) overlap.add(pair);
    }
    const semantic = Math.max(0,(scores.get(row.id) ?? 0)-n.memorySimilarity);
    const score = direct*12 + Math.min(4,overlap.size) + (previous ? 1 : 0) + semantic*n.semanticWeight;
    if (score>0) ranked.push({guide,score});
  }
  const unique = new Set<string>();
  return ranked.sort((a,b)=>b.score-a.score).filter(({guide})=>{
    const key = normalize(guide.pattern || guide.example || "");
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  }).slice(0,n.chatStyleCount).map(item=>item.guide);
}
