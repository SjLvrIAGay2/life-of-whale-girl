import { all, one, stmt, type ChatLine } from "../db";
import { channelPreference, contactAllowed, contactPreferences } from "./contact-preferences";

// Linked QQ accounts keep their original private memory scope after the site inbox closes.
// Only the QQ peer is a delivery address. Historical peers are for scoped recall.
export async function identityFor(peer: string) {
  if (!peer.startsWith("qq-")) return peer;
  const pair = await one<{ value: string }>(
    "SELECT value FROM channel_state WHERE id=?",
    "friend/" + peer,
  );
  return pair?.value.startsWith("web-") ? pair.value : peer;
}
export async function relatedPeers(identity: string) {
  if (!identity.startsWith("web-")) return [identity];
  const peers = await all<{ id: string }>(
    "SELECT id FROM channel_state WHERE id LIKE 'friend/qq-%' AND value=? ORDER BY id",
    identity,
  );
  return [identity, ...peers.map((p) => p.id.slice(7))];
}

export const chatPause = 12000;
export const maxBurst = 60000;
const unread = "peer LIKE 'qq-%' AND EXISTS (SELECT 1 FROM channel_state WHERE id='friend/'||messages.peer) AND side='in' AND handled_at IS NULL AND withheld=0";
export function interactionText(body:string) {
  const text=body.trim();
  return text.startsWith("*") ? text.slice(1).trim() : "";
}
export async function messageReceiptWrites(id:string,body:string) {
  const state=await one<{mode:string;started:number|null}>(`SELECT json_extract(state,'$.mode') AS mode,
    json_extract(state,'$.sleepSession.started') AS started FROM resident WHERE id='whale'`);
  const received={receivedMode:state?.mode??"unknown",sleepStarted:state?.mode==="asleep"?state.started:null};
  const keys=["message-receipt/"+id,...(interactionText(body)?["interaction/"+id]:[])];
  return keys.map(key=>stmt(`INSERT OR IGNORE INTO channel_state(id,value)
    SELECT ?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=? AND side='in' AND withheld=0)`,
    key,JSON.stringify(received),id));
}
export function inboxWhere(sleepOnly=false) {
  // The text fallback also accepts unread messages saved before interaction metadata existed.
  return unread+(sleepOnly ? ` AND (EXISTS(SELECT 1 FROM channel_state WHERE id='interaction/'||messages.id)
    OR (voice=0 AND substr(trim(body),1,1)='*' AND length(trim(substr(trim(body),2),char(9)||char(10)||char(13)||' '))>0))` : "");
}
export async function interactionContext(inbox:ChatLine[]) {
  const rows=await all<{id:string;value:string}>("SELECT id,value FROM channel_state WHERE id IN (SELECT 'interaction/'||value FROM json_each(?))",
    JSON.stringify(inbox.map(m=>m.id)));
  const saved=new Map(rows.map(r=>[r.id,JSON.parse(r.value) as {receivedMode:string;sleepStarted:number|null}]));
  return inbox.flatMap((line,index)=>{
    const mark=saved.get("interaction/"+line.id);
    return mark || (!line.voice && interactionText(line.body)) ? [{source:index+1,...(mark??{receivedMode:"unknown",sleepStarted:null})}] : [];
  });
}
const pauseSQL = `CASE WHEN trim(body) LIKE '等等%' OR trim(body) LIKE '等一下%' OR trim(body) LIKE '我还没说完%' OR trim(body) LIKE '等我一下%' THEN 20000
  WHEN image_count>0 AND trim(body)='' THEN 15500
  WHEN image_count=0 AND length(trim(body))>5 AND substr(trim(body),-1) IN ('？','?','！','。') THEN 6500 ELSE 12000 END`;
export async function nextInbox(peer?: string, sleepOnly=false) {
  return one<{ peer: string; due: number }>(
    `WITH pending AS (
       SELECT peer,made,batch_id,rowid AS position,${pauseSQL} AS pause,
         LEAD(made) OVER timeline AS following, LEAD(batch_id) OVER timeline AS linked
       FROM messages WHERE ${inboxWhere(sleepOnly)} AND (? IS NULL OR peer=?)
       WINDOW timeline AS (PARTITION BY peer ORDER BY made,rowid)
     ) SELECT peer,MIN(MIN(made)+?,MIN(CASE WHEN following IS NULL OR (following-made>pause AND linked IS NULL) THEN made+pause END)) AS due
     FROM pending GROUP BY peer ORDER BY due,MIN(position) LIMIT 1`,
    peer ?? null, peer ?? null, maxBurst,
  );
}
export async function readBurst(peer: string, wokeAt = 0, sleepOnly=false) {
  const rows = await all<ChatLine & {pause:number}>("SELECT *, "+pauseSQL+" AS pause FROM messages WHERE " + inboxWhere(sleepOnly) + " AND peer=? ORDER BY made,rowid LIMIT 25", peer);
  const batch: ChatLine[] = [];
  let chars = 0;
  for (const row of rows) {
    const previous = rows[batch.length-1];
    // A retried inference keeps its explicitly marked correction even across the usual pause.
    if (previous && (
      (row.made > wokeAt && row.made - previous.made > previous.pause && !row.batch_id) ||
      batch.length === 24 || row.made - batch[0].made > maxBurst || chars + row.body.length > 12000
    )) break;
    batch.push(row);
    chars += row.body.length;
  }
  return { batch, allPending: batch.length === rows.length };
}
export function isOpenerEnabled(identity: string) {
  return one("SELECT id FROM channel_state WHERE id=?", "chat-quiet/" + identity).then(row => !row);
}

// Use with the messages alias m. Pending or rejected QQ text is not shared history.
export const deliveredChatLine = `(m.side<>'out' OR m.peer NOT LIKE 'qq-%' OR EXISTS
  (SELECT 1 FROM deliveries receipt WHERE receipt.id=m.id AND receipt.state='sent'))`;

export function nextFriendPromise(now=Date.now()) {
  return one<{id: string; scope: string; body: string; due: number}>(`SELECT m.id,m.scope,m.body,
    MAX(m.due,COALESCE(CAST(c.value AS INTEGER),0)) AS due FROM memories m
    LEFT JOIN channel_state c ON c.id='promise-check/'||m.id
    WHERE m.kind IN ('promise','followup','occasion') AND m.scope LIKE 'chat:%' AND (m.kind<>'promise' OR m.topic='schedule') AND m.resolved=0 AND m.hidden=0
      AND EXISTS (SELECT 1 FROM channel_state p WHERE p.id LIKE 'friend/qq-%'
        AND (CASE WHEN p.value LIKE 'web-%' THEN p.value ELSE substr(p.id,8) END)=substr(m.scope,6))
      AND m.due IS NOT NULL AND m.closed_by IS NULL AND NOT EXISTS
      (SELECT 1 FROM channel_state WHERE id='chat-quiet/'||substr(m.scope,6))
      AND (m.expires IS NULL OR m.expires>?)
      AND NOT EXISTS(SELECT 1 FROM art_jobs j WHERE j.scope=m.scope AND j.promise_id=m.id AND j.state IN ('pending','running','ready','paused'))
      AND (m.kind<>'followup' OR COALESCE(m.category,'')<>'awaiting')
    ORDER BY MAX(m.due,COALESCE(CAST(c.value AS INTEGER),0)),m.made,m.id LIMIT 1`,now);
}

export type ChatContact = { identity: string; peer: string; owner: boolean; followUp: boolean; lastIn: number | null };
export async function chatContacts(now: number, reminderFor?: string): Promise<ChatContact[]> {
  // Several existing QQ bindings can share one friend and one set of contact limits.
  const rows = await all<{ identity: string; peer: string; owner: number; followUp: number; lastIn: number | null }>(
    `WITH channels(peer,identity) AS (
      SELECT substr(id,8),CASE WHEN value LIKE 'web-%' THEN value ELSE substr(id,8) END
      FROM channel_state WHERE id LIKE 'friend/qq-%'
    ), activity AS (
      SELECT c.identity,c.peer,MAX(CASE WHEN m.side='in' THEN m.made END) AS lastIn,
        MAX(CASE WHEN m.side='out' AND m.reply_to IS NULL AND d.state IN ('sent','unknown') THEN m.made END) AS lastOpener,
        MAX(CASE WHEN m.side='in' AND m.handled_at IS NULL THEN 1
          WHEN m.side='out' AND (d.id IS NULL OR d.state IN ('sending','retry')) THEN 1 ELSE 0 END) AS waiting
      FROM channels c LEFT JOIN messages m ON m.peer=c.peer LEFT JOIN deliveries d ON d.id=m.id GROUP BY c.identity,c.peer
    ), ranked AS (
      SELECT identity,peer,
        ROW_NUMBER() OVER(PARTITION BY identity ORDER BY lastIn DESC,peer) AS rank,
        MAX(lastIn) OVER(PARTITION BY identity) AS lastIn,
        MAX(lastOpener) OVER(PARTITION BY identity) AS lastOpener,
        MAX(waiting) OVER(PARTITION BY identity) AS waiting FROM activity
    )
    SELECT identity,peer,lastIn,identity=COALESCE((SELECT value FROM channel_state WHERE id='owner-peer'),'') AS owner,
      EXISTS(SELECT 1 FROM memories WHERE scope='chat:'||identity AND kind IN ('promise','followup','occasion') AND hidden=0 AND resolved=0 AND due<=? AND closed_by IS NULL) AS followUp
    FROM ranked WHERE rank=1 AND waiting=0 ${reminderFor ? "AND identity=?" : ""}
    AND NOT EXISTS(SELECT 1 FROM channel_state WHERE id='chat-quiet/'||identity)
    ORDER BY followUp DESC,lastOpener IS NOT NULL,lastOpener,owner DESC,lastIn DESC,identity`,
    now, ...(reminderFor ? [reminderFor] : []),
  );
  const contacts=[];
  for (const row of rows) {
    const prefs = await contactPreferences(row.identity,now);
    if (channelPreference(prefs,!!reminderFor) !== "web" && contactAllowed(prefs,now,!!reminderFor))
      contacts.push({...row,owner:!!row.owner,followUp:!!row.followUp});
    if (contacts.length===12) break;
  }
  return contacts;
}
