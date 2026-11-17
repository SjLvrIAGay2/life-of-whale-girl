import { all, db, memory, one, stmt, type Memory } from "../db";
import { identityFor, relatedPeers } from "./conversation";
import { promiseDue } from "./friend-memory";
import { anniversaryIn } from "./shared-memory";

export type Correction = "wrong" | "changed" | "avoid";
// Inputs in a burst can belong to a different channel than the delivered reply.
// A QQ quote index, on the other hand, only identifies a message in its own chat.
function withholdDependents(scope:string,peers:string,now:number) {
  return stmt(`WITH RECURSIVE peers(id) AS (SELECT value FROM json_each(?)),
    inputs AS MATERIALIZED (SELECT t.id AS batch,json_extract(t.details,'$.job') AS job,i.value AS source
      FROM reply_turns t JOIN json_each(t.details,'$.inputs') i WHERE t.scope=?),
    blocked(id) AS (
      SELECT id FROM messages WHERE peer IN peers AND withheld=1
      UNION SELECT m.id FROM blocked b JOIN messages m ON m.reply_to=b.id WHERE m.peer IN peers
      UNION SELECT m.id FROM blocked b JOIN messages orig ON orig.id=b.id JOIN messages m ON m.peer=orig.peer
        AND m.quoted_ref IN (orig.qq_index,orig.id,CASE WHEN orig.id LIKE 'qq:%' THEN substr(orig.id,4) END)
      UNION SELECT m.id FROM blocked b JOIN messages orig ON orig.id=b.id AND orig.side='out' JOIN messages m
        ON m.peer=orig.peer AND m.batch_id=orig.batch_id AND m.side='out'
      UNION SELECT m.id FROM blocked b JOIN inputs i ON i.source=b.id JOIN messages m ON m.batch_id=i.batch WHERE m.peer IN peers AND m.side='out'
      UNION SELECT 'art-'||i.job FROM blocked b JOIN inputs i ON i.source=b.id WHERE i.job IS NOT NULL)
    UPDATE messages SET withheld=1,reviewed=1,handled_at=COALESCE(handled_at,?) WHERE withheld=0 AND id IN blocked`,peers,scope,now);
}
function suppressRelatedArt(scope:string,now:number) {
  const blocked=`SELECT j.id FROM art_jobs j WHERE j.scope=? AND (EXISTS
    (SELECT 1 FROM messages m WHERE m.id=j.origin AND m.withheld=1) OR EXISTS
    (SELECT 1 FROM reply_turns t JOIN json_each(t.details,'$.inputs') i JOIN messages m ON m.id=i.value
      WHERE t.scope=j.scope AND json_extract(t.details,'$.job')=j.id AND m.withheld=1))`;
  return [
    stmt("UPDATE works SET state='hidden',updated=? WHERE scope=? AND id IN (SELECT work FROM art_jobs WHERE id IN ("+blocked+"))",now,scope,scope),
    stmt(`UPDATE art_jobs SET state='cancelled',lease=NULL WHERE state IN ('pending','running','paused','ready') AND scope=? AND
      (id IN (${blocked}) OR promise_id IN (SELECT id FROM memories WHERE scope=? AND hidden=1))`,scope,scope,scope),
  ];
}
export async function correctMemory(identity: string, id: string, mode: Correction, replacement = "", now = Date.now()) {
  if (!["wrong", "changed", "avoid"].includes(mode) || replacement.length > 240 || (mode === "changed" && !replacement.trim()))
    throw Error("请填写有效的记忆更正");
  const scope = "chat:" + identity;
  const entry = await one<Memory>("SELECT * FROM memories WHERE id=? AND scope=? AND hidden=0 AND kind IN ('profile','promise','episode','followup','occasion')", id, scope);
  if (!entry) return false;
  const topic = entry.topic === "schedule" ? entry.body : entry.topic || entry.body;
  const peers = JSON.stringify(await relatedPeers(identity));
  const rule = crypto.randomUUID();
  const related = await all<Memory>(`SELECT * FROM memories WHERE scope=? AND (id=? OR (kind=? AND topic=? AND topic<>'schedule')) AND made<=?`,
    scope, id, entry.kind, topic, now);
  const terms = [...new Set([...(mode==="avoid"?[topic]:[]), ...related.flatMap(m => [m.quote, m.body])].filter((s): s is string => !!s && s.length >= 2))];
  const ids = JSON.stringify(related.flatMap(m => [m.id, ...JSON.parse(m.evidence)]));
  const words = JSON.stringify(terms);
  // Keep source messages in the friend's own archive. Exclude both sides of their
  // exchange, inline quotes and transitive derivatives from future model inputs.
  const affected = `WITH RECURSIVE affected(id) AS (
    SELECT value FROM json_each(?) UNION SELECT id FROM memories WHERE scope=? AND made<=? AND EXISTS
      (SELECT 1 FROM json_each(?) term WHERE instr(body,term.value)>0)
    UNION SELECT CASE m.side WHEN 'in' THEN 'chat-in-' ELSE 'chat-out-' END || m.id FROM messages m
      WHERE m.peer IN (SELECT value FROM json_each(?)) AND m.withheld=1
    UNION SELECT m.id FROM memories m JOIN json_each(m.evidence) e JOIN affected a ON a.id=e.value WHERE m.scope=?
  ) UPDATE memories SET hidden=1 WHERE scope=? AND id IN (SELECT id FROM affected)`;
  const writes = [
    stmt("INSERT INTO memory_rules VALUES(?,(SELECT scope FROM memories WHERE id=? AND scope=? AND hidden=0),?,?,?,?)", rule,id,scope,topic,mode,now,words),
    stmt(`UPDATE messages AS m SET withheld=1,reviewed=1,handled_at=COALESCE(handled_at,?)
      WHERE m.peer IN (SELECT value FROM json_each(?)) AND m.made<=? AND
        (('chat-'||m.side||'-'||m.id) IN (SELECT value FROM json_each(?)) OR EXISTS
          (SELECT 1 FROM json_each(?) term WHERE instr(m.body,term.value)>0 OR instr(m.quoted_text,term.value)>0))`,
      now,peers,now,ids,words),
    withholdDependents(scope,peers,now),
    // One letter may contain several independent facts. Give an unrelated fact
    // its exact, verifiable excerpt without putting the whole letter back into recall.
    stmt(`INSERT OR IGNORE INTO memories(id,made,scope,kind,body,source,evidence)
      SELECT 'excerpt/'||m.id||'/'||e.value,l.made,m.scope,'source_quote',m.quote,e.value,'[]'
      FROM memories m JOIN json_each(m.evidence) e JOIN messages l ON e.value='chat-'||l.side||'-'||l.id
      WHERE m.scope=? AND m.hidden=0 AND m.kind IN ('profile','occasion','episode','followup')
        AND m.id NOT IN (SELECT value FROM json_each(?)) AND l.peer IN (SELECT value FROM json_each(?))
        AND l.withheld=1 AND l.withdrawn=0 AND length(m.quote)>1 AND instr(l.body,m.quote)>0
        AND NOT EXISTS(SELECT 1 FROM json_each(?) t WHERE instr(m.quote,t.value)>0 OR instr(t.value,m.quote)>0 OR instr(m.body,t.value)>0)`,scope,ids,peers,words),
    stmt(`UPDATE memories AS m SET evidence=(SELECT json_group_array(COALESCE(q.id,e.value)) FROM json_each(m.evidence) e
      LEFT JOIN memories q ON q.scope=m.scope AND q.kind='source_quote' AND q.hidden=0 AND q.id='excerpt/'||m.id||'/'||e.value)
      WHERE m.scope=? AND m.hidden=0 AND EXISTS(SELECT 1 FROM json_each(m.evidence) e JOIN memories q
        ON q.id='excerpt/'||m.id||'/'||e.value AND q.hidden=0)`,scope),
    stmt(affected,ids,scope,now,words,peers,scope,scope),
    ...suppressRelatedArt(scope,now),
    stmt("DELETE FROM memory_vectors WHERE id IN (SELECT id FROM memories WHERE scope=? AND hidden=1)",scope),
    stmt(`UPDATE messages SET withheld=1 WHERE peer IN (SELECT value FROM json_each(?)) AND side='out' AND art IN
      (SELECT j.art FROM art_jobs j JOIN messages original ON original.id=j.origin WHERE j.scope=? AND original.withheld=1)`,peers,scope),
    stmt(`UPDATE art_jobs SET state='cancelled',lease=NULL WHERE scope=? AND state IN ('pending','running','paused','ready') AND
      (origin IN (SELECT id FROM messages WHERE withheld=1) OR EXISTS(SELECT 1 FROM json_each(?) term WHERE instr(idea,term.value)>0))`,scope,words),
    stmt(`UPDATE works SET state='hidden',updated=? WHERE scope=? AND (EXISTS(SELECT 1 FROM json_each(?) term WHERE instr(works.title,term.value)>0 OR instr(works.next,term.value)>0)
      OR EXISTS(SELECT 1 FROM work_steps s WHERE s.work=works.id AND (s.evidence IN (SELECT id FROM memories WHERE scope=? AND hidden=1)
        OR EXISTS(SELECT 1 FROM json_each(?) term WHERE instr(s.body,term.value)>0)))
      OR id IN (SELECT j.work FROM art_jobs j JOIN messages original ON original.id=j.origin WHERE j.scope=? AND original.withheld=1))`,now,scope,words,scope,words,scope),
  ];
  if (mode === "changed") {
    const body = replacement.trim(), msg = "correction-" + rule;
    const occasion=entry.kind==="occasion"?anniversaryIn(body,now):null;
    const due=occasion?.due??(["promise","followup"].includes(entry.kind)?promiseDue(body,now):null);
    const expires=entry.kind==="followup" && due?due+3*86400000:entry.kind==="profile"?entry.expires:null;
    writes.push(stmt("INSERT INTO messages(id,peer,made,side,body,handled_at,reviewed) VALUES(?,?,?,'in',?,?,1)",msg,identity,now,body,now),
      memory({scope,kind:entry.kind,category:"corrected",topic:entry.topic||topic,body,quote:body,due,expires,
        details:occasion?.details??null,evidence:JSON.stringify(["chat-in-"+msg])},now).write);
  }
  try {await db().batch(writes);}
  catch(error) {
    if(await one("SELECT 1 FROM memories WHERE id=? AND scope=? AND hidden=1",id,scope)) return false;
    throw error;
  }
  return true;
}

export function ruleVersion(scope: string) {
  return one<{n:number}>("SELECT count(*) n FROM memory_rules WHERE scope=?", scope).then(row=>row!.n);
}
export async function avoidedTerms(scope:string) {
  const rules=await all<{term:string}>(`SELECT DISTINCT t.value AS term FROM memory_rules r,json_each(r.terms) t
    WHERE r.scope=? AND r.mode='avoid' AND length(t.value)>1`,scope);
  return rules.map(r=>r.term);
}
export const mentionsAvoided=(value:string,terms:string[])=>terms.some(t=>value.includes(t));

export async function correctConversation(identity:string, peer:string, original:string, reason:Correction, newValue="", now=Date.now()) {
    const scope="chat:"+identity;
    const line=await one<{id:string;body:string;made:number;side:string;reply_to:string|null}>("SELECT id,body,made,side,reply_to FROM messages WHERE peer=? AND id=? AND withheld=0",peer,original);
    if(!line) return false;
    const ref="chat-"+line.side+"-"+line.id;
    const candidates=await all<Memory>("SELECT * FROM memories WHERE scope=? AND hidden=0 AND kind IN ('profile','episode','followup','occasion','promise') AND EXISTS(SELECT 1 FROM json_each(evidence) WHERE value IN (?,?)) ORDER BY made DESC",scope,ref,line.reply_to?"chat-in-"+line.reply_to:null);
    const named=candidates.filter(m=>(m.topic && newValue.includes(m.topic)) || (m.quote && newValue.includes(m.quote)) || (m.kind==="occasion" && /生日|纪念日/.test(newValue)));
    if(candidates.length>1 && named.length!==1) return "ambiguous";
    const existing=named[0]??candidates[0];
    const id=existing?.id??"source-"+line.id;
    if(!existing) await memory({id,scope,kind:"episode",topic:line.body||"原消息",body:line.body||"原消息",evidence:JSON.stringify([ref])},line.made).write.run();
    return correctMemory(identity,id,reason,newValue,now);
}

export async function withdrawMessage(peer:string, id:string, now=Date.now()) {
  const msg=await one<{id:string;qq_index:string|null}>("SELECT id,qq_index FROM messages WHERE peer=? AND id=? AND side='in' AND withdrawn=0",peer,id);
  if (!msg) return false;
  const identity=await identityFor(peer),scope="chat:"+identity,peers=JSON.stringify(await relatedPeers(identity));
  await db().batch([
    stmt("UPDATE messages SET withdrawn=1,withheld=1,reviewed=1,handled_at=COALESCE(handled_at,?),body='',quoted_text=NULL,image_count=0 WHERE id=? AND peer=?",now,id,peer),
    withholdDependents(scope,peers,now),
    stmt("UPDATE messages SET quoted_text=NULL WHERE peer IN (SELECT value FROM json_each(?)) AND withheld=1",peers),
    stmt("DELETE FROM chat_images WHERE message=?",id),
    stmt("DELETE FROM chat_images WHERE quoted=1 AND message IN (SELECT id FROM messages WHERE withheld=1 AND peer IN (SELECT value FROM json_each(?)))",peers),
    stmt(`WITH RECURSIVE gone(id) AS (SELECT 'chat-'||side||'-'||id FROM messages WHERE peer IN (SELECT value FROM json_each(?)) AND withheld=1
      UNION SELECT m.id FROM memories m JOIN messages l ON m.source='chat-'||l.side||'-'||l.id
        WHERE m.kind='source_quote' AND m.scope=? AND l.withdrawn=1
      UNION SELECT m.id FROM memories m JOIN json_each(m.evidence) e JOIN gone ON gone.id=e.value WHERE m.scope=?)
      UPDATE memories SET hidden=1 WHERE scope=? AND id IN (SELECT id FROM gone)`,peers,scope,scope,scope),
    stmt("DELETE FROM memory_vectors WHERE id IN (SELECT id FROM memories WHERE scope=? AND hidden=1)",scope),
    ...suppressRelatedArt(scope,now),
    stmt("UPDATE works SET state='hidden',updated=? WHERE scope=? AND id IN (SELECT work FROM work_steps WHERE evidence IN (SELECT id FROM memories WHERE scope=? AND hidden=1))",now,scope,scope),
    stmt("INSERT INTO memory_rules VALUES(?,?,?,'withdrawn',?,'[]')",crypto.randomUUID(),scope,id,now),
  ]);
  return true;
}
