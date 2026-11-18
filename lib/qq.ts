import { qqErrors } from "../config/texts/errors.ts";
import { numbers } from "../config/numbers.ts";
import { links } from "../config/links.ts";
import { qqHelp } from "../config/tool-guides/qq";
import { env, waitUntil } from "cloudflare:workers";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
} from "node:crypto";
import { all, db, memory, one, stmt, type ChatLine } from "../db";
import { limited } from "./security";
import { assetBytes, communitySticker } from "./community-art";
import { hearQQVoice, isQQVoice, type QQAudio } from "./qq-voice";
import { synthesize } from "./speech";
import { failureReason } from "./diagnostics";
import { qqPromiseChanges } from "./friend-memory";
import { nextInbox, identityFor, messageReceiptWrites } from "./conversation";
import { imageWrites, isQQImage, maxImages, qqImages } from "./chat-images";
import { channelPreference, contactAllowed, contactPreferences, qqPreferences, setContactPreferences,voicePreference } from "./contact-preferences";
import { correctConversation, withdrawMessage } from "./memory-control";
function signingKey(secret: string) {
  const seed = Buffer.from(secret.repeat(32)).subarray(0, 32);
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]),
    format: "der",
    type: "pkcs8",
  });
}
export function checkQQ(
  secret: string,
  timestamp: string,
  body: string,
  signature: string,
) {
  if (!/^\d{9,13}$/.test(timestamp) || !/^([\da-f]{2}){64}$/i.test(signature))
    return false;
  return verify(
    null,
    Buffer.from(timestamp + body),
    createPublicKey(signingKey(secret)),
    Buffer.from(signature, "hex"),
  );
}
export function qqChallenge(secret: string, ts: string, token: string) {
  if (
    !/^\d{9,13}$/.test(ts) ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_./+=-]{1,128}$/.test(token)
  )
    throw Error(qqErrors.signature);
  return {
    plain_token: token,
    signature: sign(null, Buffer.from(ts + token), signingKey(secret)).toString(
      "hex",
    ),
  };
}
async function qqConfig() {
  const row = await one<{ value: string }>(
    "SELECT value FROM channel_state WHERE id='qq-config'",
  );
  if (row) {
    const { openSecret } = await import("./vault");
    return JSON.parse(await openSecret(row.value)) as {
      appId: string;
      secret: string;
    };
  }
  return { appId: env.WHALE_QQBOT_APPID ?? "", secret: env.WHALE_QQBOT_APPSECRET ?? "" };
}
export async function configureQQ(appId: string, secret: string) {
  if (!/^\d{5,20}$/.test(appId) || secret.length < 12 || secret.length > 256)
    throw Error(qqErrors.format);
  const { seal } = await import("./vault");
  const value = await seal(JSON.stringify({ appId, secret }));
  await stmt(
    "INSERT OR REPLACE INTO channel_state VALUES('qq-config',?)",
    value,
  ).run();
  access = undefined;
}
export async function hasQQ() {
  const config = await qqConfig();
  return !!(config.appId && config.secret);
}
export async function issuePair() {
  const code = randomBytes(12).toString("base64url"),
    digest = createHash("sha256").update(code).digest("hex");
  await db().batch([
    stmt(
      "DELETE FROM channel_state WHERE id LIKE 'qq-pair/%' AND json_extract(value,'$.until')<?",
      Date.now(),
    ),
    stmt(
      "INSERT INTO channel_state VALUES(?,?)",
      "qq-pair/" + digest,
      JSON.stringify({ until: Date.now() + numbers.defaults.pairLifetimeMs }),
    ),
  ]);
  return code;
}
export async function qqEvent(r: Request) {
  const config = await qqConfig();
  if (!config.secret)
    return Response.json({ message: qqErrors.credentials }, { status: 503 });
  if (!r.body) return new Response(null, { status: 400 });
  const raw = new TextDecoder().decode(await limited(r.body, 64000));
  const x = JSON.parse(raw);
  if (x.op === 13)
    return Response.json(
      qqChallenge(
        config.secret,
        String(x.d?.event_ts ?? ""),
        x.d?.plain_token ?? "",
      ),
    );
  const ts = r.headers.get("x-signature-timestamp") ?? "";
  if (
    !checkQQ(
      config.secret,
      ts,
      raw,
      r.headers.get("x-signature-ed25519") ?? "",
    ) ||
    Math.abs(Date.now() / 1000 - Number(ts)) > 600
  )
    return new Response(null, { status: 401 });
  if (x.op === 1) return Response.json({ op: 11, d: x.d });
  await acceptQQ(x);
  return Response.json({ op: 12, d: 0 });
}
type QQMessageContent = { content?: unknown; attachments?: QQAudio[] };
type QQIncoming = QQMessageContent & {
  message_scene?: { ext?: string[] };
  message_type?: number;
  msg_elements?: (QQMessageContent & { msg_idx?: string })[];
  message_reference?: { message_id?: string };
};

function qqText(content: unknown, limit: number) {
  if (typeof content !== "string") return "";
  return content.replace(/<faceType=\d+,faceId="[^"]*",ext="([^"]*)">/g, (_, ext: string) => {
    try {
      const label = JSON.parse(Buffer.from(ext, "base64").toString("utf8")).text;
      if (typeof label === "string" && label.trim()) return "〔表情·" + label.trim().slice(0, 40) + "〕";
    } catch { /* Some QQ faces carry no readable name. */ }
    return "〔QQ 表情〕";
  }).replace(/\[<face,id=\d+\/?>\]/g, "〔QQ 表情〕").trim().slice(0, limit);
}

function qqImageCount(attachments?: QQAudio[]) {
  return Array.isArray(attachments) ? attachments.filter(isQQImage).length : 0;
}

function qqReferences(event: QQIncoming) {
  const ext = Array.isArray(event.message_scene?.ext) ? event.message_scene.ext : [];
  const field = (prefix: string) => ext.find(s => typeof s === "string" && s.startsWith(prefix))?.slice(prefix.length).trim();
  const ref = field("ref_msg_idx=") || event.message_reference?.message_id;
  const isQuote = event.message_type === 103 || !!ref;
  const element = isQuote ? event.msg_elements?.[0] : undefined;
  let quotedText = null;
  if (isQuote) {
    const images = qqImageCount(element?.attachments);
    const voice = Array.isArray(element?.attachments) && element.attachments.some(isQQVoice);
    quotedText = [qqText(element?.content, 800), images && "〔图片〕", voice && "〔语音〕"]
      .filter(Boolean).join(" ") || "原消息不可用";
  }
  return { index: field("msg_idx=") || null, quotedRef: element?.msg_idx || ref || null, quotedText };
}

export async function acceptQQ(x: any) {
  if(x.op===0 && x.t==="C2C_MESSAGE_RECALL") {
    const user=x.d?.author?.user_openid??x.d?.user_openid;
    const id=x.d?.message_id;
    if(typeof user==="string" && /^[\w-]{5,100}$/.test(user) && typeof id==="string" && id.length>0 && id.length<=150) {
      const peer="qq-"+user,now=Date.now();
      // A recall can beat the original event or its attachment download.
      await stmt(`INSERT OR IGNORE INTO messages(id,peer,made,side,body,handled_at,reviewed,withdrawn,withheld)
        SELECT ?,?,?,'in','',?,1,1,1 WHERE EXISTS(SELECT 1 FROM channel_state WHERE id=?)`,
        "qq:"+id,peer,now,now,"friend/"+peer).run();
      await withdrawMessage("qq-"+user,"qq:"+id);
    }
    return;
  }
  if (x.op === 0 && x.t === "C2C_MESSAGE_CREATE") {
    const { author, id, content, attachments } = x.d ?? {};
    const user = author?.user_openid;
    if (
      typeof user === "string" &&
      /^[\w-]{5,100}$/.test(user) &&
      typeof id === "string" && id.length>0 && id.length<=150
    ) {
      const peer = "qq-" + user;
      let body = qqText(content, 1600);
      const voice: QQAudio | undefined = Array.isArray(attachments) ? attachments.find(isQQVoice) : undefined;
      const images = qqImageCount(attachments);
      const { index, quotedRef, quotedText } = qqReferences(x.d);
      if (!voice && body.startsWith("配对 ")) {
        const digest = createHash("sha256")
          .update(body.slice(3).trim())
          .digest("hex");
        const pairKey = "qq-pair/" + digest,
          pair = await one<{ value: string }>(
            "SELECT value FROM channel_state WHERE id=?",
            pairKey,
          );
        if (pair) {
          const p = JSON.parse(pair.value);
          if ((!p.target || p.target === "paired") && p.until > Date.now()) {
            const at=Date.now();
            await db().batch([
              stmt(`INSERT OR IGNORE INTO messages(id,peer,made,side,body,handled_at,reviewed)
                SELECT ?,?,?,'in','QQ 配对',?,1 WHERE EXISTS(SELECT 1 FROM channel_state WHERE id=? AND value=?)`,
                "qq:"+id,peer,at,at,pairKey,pair.value),
              stmt(`INSERT OR IGNORE INTO messages(id,peer,made,side,body,reply_to,batch_id)
                SELECT ?,?,?,'out',?,?,? WHERE EXISTS(SELECT 1 FROM channel_state WHERE id=? AND value=?)`,
                "pair-help-"+id,peer,at,qqHelp,"qq:"+id,"pair-help-"+id,pairKey,pair.value),
              stmt(
                "INSERT OR IGNORE INTO channel_state SELECT ?,'paired' WHERE EXISTS(SELECT 1 FROM channel_state WHERE id=? AND value=?)",
                "friend/" + peer, pairKey, pair.value,
              ),
              stmt(
                "DELETE FROM channel_state WHERE id=? AND value=?",
                pairKey,
                pair.value,
              ),
            ]);
            if(env.WHALE_SELF_HOSTED!=="1") waitUntil(deliverQQ());
          }
        }
      } else if (
        (body || voice || images || quotedText) &&
        (await one("SELECT id FROM channel_state WHERE id=?", "friend/" + peer))
      ) {
        if (await one("SELECT id FROM messages WHERE id=?", "qq:" + id)) return;
        const receivedAt = Date.now();
        const receipts=await messageReceiptWrites("qq:"+id,body);
        if (voice) {
          const heard = await hearQQVoice(voice);
          body = heard ? [body, heard].filter(Boolean).join("\n").slice(0, 6000) : [body, "〔这条语音没有听清〕"].filter(Boolean).join("\n");
        }
        const insert = stmt(
          "INSERT OR IGNORE INTO messages(id,peer,made,side,body,voice,image_count,qq_index,quoted_ref,quoted_text) VALUES(?,?,?,'in',?,?,?,?,?,?)",
          "qq:" + id, peer, receivedAt, body, voice ? 1 : 0, images, index, quotedRef, quotedText,
        );
        const current=await qqImages(attachments);
        const quoted=quotedText?await qqImages(x.d.msg_elements?.[0]?.attachments,maxImages-current.length):[];
        const [added]=await db().batch([insert,...imageWrites("qq:"+id,current,false,true),...imageWrites("qq:"+id,quoted,true,true),...receipts]);
        if(added.meta.changes && !voice && /^(?:QQ\s*)?(?:帮助|互动说明|使用说明)$/i.test(body.trim())) {
          await db().batch([
            stmt("UPDATE messages SET handled_at=?,reviewed=1 WHERE id=? AND withheld=0",receivedAt,"qq:"+id),
            stmt(`INSERT OR IGNORE INTO messages(id,peer,made,side,body,reply_to,batch_id)
              SELECT ?,?,?,'out',?,?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=? AND withheld=0)`,
              "help-"+id,peer,receivedAt,qqHelp,"qq:"+id,"help-"+id,"qq:"+id),
          ]);
          if(env.WHALE_SELF_HOSTED!=="1") waitUntil(deliverQQ());
          return;
        }
        const correction=!voice && body.match(/^(记错人了|以后别再提|现在变了)[：:\s]*(.*)$/);
        if(added.meta.changes && quotedRef && correction && (correction[1]!=="现在变了" || correction[2].trim())) {
          const original=await one<{id:string}>("SELECT id FROM messages WHERE peer=? AND (qq_index=? OR id='qq:'||?) AND id<>? LIMIT 1",peer,quotedRef,quotedRef,"qq:"+id);
          const result=original && await correctConversation(await identityFor(peer),peer,original.id,correction[1]==="现在变了"?"changed":correction[1]==="记错人了"?"wrong":"avoid",correction[2].trim().slice(0,240),receivedAt);
          if(result) {
            await stmt("UPDATE messages SET handled_at=?,reviewed=1,withheld=1 WHERE id=?",receivedAt,"qq:"+id).run();
            await stmt("INSERT OR IGNORE INTO messages(id,peer,made,side,body,reply_to,batch_id) VALUES(?,?,?,'out',?,?,?)","correct-"+id,peer,receivedAt,
              result==="ambiguous"?"这条消息里记下了几件事。再引用一次，用「记错人了 记忆原话」指出要改的那一件吧。":"好的，我改好了。","qq:"+id,"correct-"+id).run();
            if(env.WHALE_SELF_HOSTED!=="1") waitUntil(deliverQQ());
            return;
          }
        }
        const preference=!voice && qqPreferences(body);
        if(added.meta.changes && preference)
          await setContactPreferences(await identityFor(peer),preference).catch(()=>{});
        if (added.meta.changes && env.WHALE_SELF_HOSTED !== "1")
          waitUntil(
            import("./life")
              .then(async ({ tick,processPainting }) => {
                const state=await one<{mode:string}>("SELECT json_extract(state,'$.mode') AS mode FROM resident WHERE id='whale'");
                const pending=await nextInbox(peer,state?.mode==="asleep");
                if(!pending) return;
                await new Promise(resolve => setTimeout(resolve, Math.max(0,pending.due-Date.now())+5));
                await tick("inbox", peer);
                await deliverQQ();
                await processPainting();
                await deliverQQ();
              })
              .catch(() => {}),
          );
      }
    }
  }
}
let access: { token: string; until: number; appId: string } | undefined;
export async function qqToken() {
  const { appId, secret } = await qqConfig();
  if (!secret) throw Error(qqErrors.credentials);
  if (access && access.appId === appId && access.until > Date.now())
    return access.token;
  const r = await fetch(links.defaults.qqToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
    signal: AbortSignal.timeout(9000),
  });
  const b = (await r.json()) as any;
  if (!r.ok || !b.access_token) throw Error(qqErrors.invalidCredentials);
  access = {
    token: b.access_token,
    appId,
    until: Date.now() + (Number(b.expires_in) - 60) * 1000,
  };
  return access.token;
}
const qqQueue = ` FROM messages m LEFT JOIN deliveries d ON d.id=m.id
  WHERE m.peer LIKE 'qq-%' AND m.side='out'
  AND (d.id IS NULL OR (d.state='retry' AND d.attempt<3))
  AND NOT EXISTS(SELECT 1 FROM messages p LEFT JOIN deliveries pd ON pd.id=p.id
    WHERE p.peer=m.peer AND p.side='out' AND (p.made<m.made OR (p.made=m.made AND p.rowid<m.rowid))
    AND (pd.id IS NULL OR pd.state='sending' OR (pd.state='retry' AND pd.attempt<3)))`;
export function nextQQDelivery() {
  return one<{ due: number | null }>("SELECT MIN(COALESCE(d.next_try,0)) AS due" + qqQueue);
}
export async function recoverQQDeliveries() {
  // Older residents marked these exact inputs handled without asking the model. Reopen only those turns.
  if (!await one("SELECT 1 FROM channel_state WHERE id='migration/qq-reply-decisions'")) {
    await db().batch([
      stmt(`UPDATE messages AS m SET handled_at=NULL WHERE side='in' AND withdrawn=0 AND withheld=0
        AND EXISTS (SELECT 1 FROM channel_state f JOIN reply_turns t
          ON t.scope='chat:'||CASE WHEN f.value LIKE 'web-%' THEN f.value ELSE m.peer END
          WHERE f.id='friend/'||m.peer AND t.made=m.handled_at AND t.status='reply_expired')
        AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.reply_to=m.id)`),
      stmt(`UPDATE deliveries SET state='retry',attempt=0,next_try=0 WHERE state IN ('skipped','reply_expired')
        AND id IN (SELECT m.id FROM messages m JOIN messages original ON original.id=m.reply_to AND original.peer=m.peer
          WHERE m.withheld=0 AND original.withdrawn=0 AND EXISTS(SELECT 1 FROM messages p JOIN deliveries d ON d.id=p.id
            WHERE (p.id=m.id OR (p.batch_id=m.batch_id AND p.seq<m.seq)) AND d.state='reply_expired'))`),
      stmt("INSERT OR IGNORE INTO channel_state VALUES('migration/qq-reply-decisions','1')"),
    ]);
  }
  // A process exit cannot tell us whether QQ accepted an in-flight POST.
  await db().batch([stmt("UPDATE deliveries SET state='unknown' WHERE state='sending'"),
    ...["episode-receipt/","occasion-receipt/","followup-receipt/"].map(prefix=>stmt("DELETE FROM channel_state WHERE id IN (SELECT ?||id FROM deliveries WHERE state='unknown')",prefix)),
    stmt("DELETE FROM channel_state WHERE id IN (SELECT 'qq-promises/'||id FROM deliveries WHERE state='unknown')"),
    stmt("UPDATE memories SET closed_by=NULL WHERE kind='promise' AND resolved=0 AND closed_by IN (SELECT 'chat-out-'||id FROM deliveries WHERE state='unknown')"),
    stmt(`DELETE FROM memories WHERE kind='conversation' AND id IN
      (SELECT 'chat-out-'||m.id FROM messages m LEFT JOIN deliveries d ON d.id=m.id
       WHERE m.peer LIKE 'qq-%' AND m.side='out' AND COALESCE(d.state,'queued')<>'sent')`)]);
}
export async function deliverQQ(now=Date.now()) {
  const rows = await all<ChatLine & { attempts: number }>(
    "SELECT m.*,COALESCE(d.attempt,0) AS attempts" + qqQueue + " AND COALESCE(d.next_try,0)<=? ORDER BY m.made,m.rowid LIMIT 3", now,
  );
  for (const m of rows) {
    const claimed = await stmt(
      "INSERT INTO deliveries(id,state,attempt) VALUES(?,'sending',1) ON CONFLICT(id) DO UPDATE SET state='sending',attempt=attempt+1 WHERE state='retry' AND attempt<3",
      m.id,
    ).run();
    if (!claimed.meta.changes) continue;
    let status = "retry";
    let sentIndex: string | undefined;
    const started=Date.now();
    let sending=0, httpStatus:number|undefined, code:number|undefined;
    let withReference = !!m.reply_to;
    try {
      if(m.withheld) {status="suppressed";continue;}
      if (m.seq > 1 && await one(
        "SELECT 1 FROM messages p JOIN deliveries d ON d.id=p.id WHERE p.batch_id=? AND p.seq<? AND d.state<>'sent' LIMIT 1",
        m.batch_id, m.seq,
      )) { status = "skipped"; continue; }
      if (!m.reply_to && !await permitsQQOpener(m,now)) {status="suppressed";continue;}
      const token = await qqToken();
      const base =
        links.defaults.qqUsers +
        encodeURIComponent(m.peer.slice(3));
      const headers = {
        "Content-Type": "application/json",
        Authorization: "QQBot " + token,
      };
      const payload: Record<string, unknown> = {
        content: m.body,
        msg_type: 0,
        ...(m.reply_to ? { msg_id: m.reply_to.slice(3), msg_seq: m.seq } : {}),
      };
      if (m.voice && env.WHALE_QQ_VOICE && voicePreference(await contactPreferences(await identityFor(m.peer),now),now)!=="text") {
        try {
          const silk = await env.WHALE_QQ_VOICE.toSilk(await synthesize(m.body));
          const upload = await fetch(base + "/files", {
            method: "POST", headers,
            body: JSON.stringify({ file_type: 3, srv_send_msg: false, file_data: Buffer.from(silk).toString("base64") }),
            signal: AbortSignal.timeout(20000),
          });
          if (!upload.ok) throw Error("QQ 语音上传失败 (" + upload.status + ")");
          const file = await upload.json<{ file_info?: string }>();
          if (!file.file_info) throw Error(qqErrors.voiceToken);
          delete payload.content;
          payload.msg_type = 7;
          payload.media = { file_info: file.file_info };
        } catch (error) {
          console.error(JSON.stringify({ operation: "qq_voice_fallback", detail: failureReason(error) }));
        }
      } else if (m.art) {
        const sticker = communitySticker(m.art);
        const image = sticker ? { png: assetBytes(sticker.data), svg: "" } : await one<{ svg: string; png: Uint8Array | number[] | null }>(
          "SELECT svg,png FROM drawings WHERE id=?",
          m.art,
        );
        if (image) {
          const data = image.png
            ? Buffer.from(image.png)
            : await (await import("./png")).renderPNG(image.svg);
          const upload = await fetch(base + "/files", {
            method: "POST",
            headers,
            body: JSON.stringify({
              file_type: 1,
              srv_send_msg: false,
              file_data: data.toString("base64"),
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (!upload.ok) throw Error(qqErrors.uploadImage);
          const file = await upload.json<{ file_info: string }>();
          if (!file.file_info) throw Error(qqErrors.imageToken);
          payload.msg_type = 7;
          payload.media = { file_info: file.file_info };
        }
      }
      status = "unknown";
      // Preparing audio or uploading an image can outlive a source withdrawal.
      const sendable=async()=>{
        const at=now+Math.max(0,Date.now()-started);
        if (await one("SELECT 1 FROM messages WHERE id=? AND withheld=1",m.id)) return false;
        if (m.reply_to) {
          // Switching transport keeps the original recipient and the intent of this reply.
          return !!await one(`SELECT 1 FROM messages WHERE id=? AND peer=? AND side='in' AND withdrawn=0
            AND EXISTS(SELECT 1 FROM channel_state WHERE id='friend/'||messages.peer)`,m.reply_to,m.peer);
        }
        return permitsQQOpener(m,at);
      };
      const send = async () => {
        if (!await sendable()) return "suppressed";
        httpStatus=undefined; code=undefined;
        const r = await fetch(base + "/messages", {method:"POST",headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
        httpStatus=r.status;
        const receipt = await r.json<{code?:number|string; err_code?:number|string; id?:string; ext_info?:{ref_idx?:string}}>().catch(()=>null);
        const rawCode=receipt?.err_code ?? receipt?.code;
        code=rawCode===undefined ? undefined : Number(rawCode);
        if (r.ok && (code === undefined || code === 0)) {
          sentIndex=receipt?.ext_info?.ref_idx || receipt?.id;
          return "sent";
        }
        return r.status===429 ? "retry" : r.status>=500 ? "unknown" : "rejected";
      };
      if(m.voice && payload.media && voicePreference(await contactPreferences(await identityFor(m.peer)),now+Math.max(0,Date.now()-started))==="text") {
        delete payload.media;payload.msg_type=0;payload.content=m.body;
      }
      sending=Date.now();
      // Retry only an explicitly refused reference or media format. An ambiguous POST is never repeated.
      for (;;) {
        status="unknown";
        status = await send();
        if (status !== "rejected") break;
        if (withReference && [304026,304027,304103,40034005,40034024,40034026,40034128].includes(code ?? 0)) {
          withReference=false; delete payload.msg_id; delete payload.msg_seq;
        } else if (m.voice && payload.media && [400,413,415,422].includes(httpStatus ?? 0)) {
          console.error(JSON.stringify({operation:"qq_voice_fallback",status:httpStatus}));
          delete payload.media; payload.msg_type=0; payload.content=m.body;
        } else break;
      }
    } catch {
      /* Preserve the delivery stage for safe retry or inspection. */
    } finally {
      const saveDelivery = stmt(
        "UPDATE deliveries SET state=?,next_try=? WHERE id=?",
        status === "retry" && m.attempts >= 2 ? "failed" : status,
        status === "retry" ? Date.now() + 5000 * (m.attempts + 1) : 0, m.id,
      );
      const writes = [saveDelivery,stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)","delivery-time/"+m.id,
        JSON.stringify({preparation:sending?Math.max(0,sending-started):Math.max(0,Date.now()-started),transport:sending?Math.max(0,Date.now()-sending):null,attempt:m.attempts+1,httpStatus,code,mode:withReference?"reply":"proactive"}))];
      const confirmed = status === "sent";
      const occasion="occasion-receipt/"+m.id;
      const episode="episode-receipt/"+m.id, followup="followup-receipt/"+m.id;
      if(confirmed) writes.push(
        stmt(`UPDATE memories SET evidence=json_insert(evidence,'$[#]',?),details=json_set(details,'$.resident',(SELECT json_extract(value,'$.quote') FROM channel_state WHERE id=?))
          WHERE id=(SELECT json_extract(value,'$.id') FROM channel_state WHERE id=?) AND kind='episode' AND hidden=0`,"chat-out-"+m.id,episode,episode),
        stmt("UPDATE memories SET category='awaiting' WHERE id=(SELECT value FROM channel_state WHERE id=?) AND kind='followup' AND hidden=0",followup));
      if(confirmed) writes.push(stmt(`UPDATE memories SET due=(SELECT json_extract(value,'$.next') FROM channel_state WHERE id=?) WHERE id=(SELECT json_extract(value,'$.id') FROM channel_state WHERE id=?) AND kind='occasion' AND hidden=0`,occasion,occasion));
      if(status!=="retry" || m.attempts>=2) writes.push(stmt("DELETE FROM channel_state WHERE id IN (?,?,?)",occasion,episode,followup));
      if (typeof sentIndex === "string" && sentIndex) {
        writes.push(stmt("UPDATE messages SET qq_index=? WHERE id=?", sentIndex, m.id));
      }
      const scope = "chat:" + await identityFor(m.peer);
      if (status !== "retry" || m.attempts >= 2) writes.push(...await qqPromiseChanges(m.id, confirmed, scope));
      if (confirmed) {
        writes.push(memory({id:"chat-out-"+m.id,scope,kind:"conversation",body:m.body || "发了一张表情。"},m.made).write,
          stmt("UPDATE memories SET resolved=1 WHERE kind='promise' AND resolved=0 AND closed_by=?","chat-out-"+m.id));
      } else if(status!=="retry" || m.attempts>=2) writes.push(stmt("UPDATE memories SET closed_by=NULL WHERE kind='promise' AND resolved=0 AND closed_by=?","chat-out-"+m.id));
      await db().batch(writes);
    }
  }
}
async function permitsQQOpener(line:ChatLine,now:number) {
  const identity=await identityFor(line.peer);
  const [friend,quiet,prefs,turn]=await Promise.all([
    one("SELECT 1 FROM channel_state WHERE id=?","friend/"+line.peer),
    one("SELECT 1 FROM channel_state WHERE id=?","chat-quiet/"+identity),contactPreferences(identity,now),
    one<{intent:string}>("SELECT json_extract(details,'$.intent') AS intent FROM reply_turns WHERE id=?",line.batch_id),
  ]);
  const reminder=turn?.intent==="reminder";
  return !!friend && !quiet && channelPreference(prefs,reminder)!=="web" && contactAllowed(prefs,now,reminder);
}
