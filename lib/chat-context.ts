import { numbers } from "../config/numbers";
import { all, type ChatLine } from "../db";
import type { State } from "../content/initial";
import { communitySticker } from "./community-art";
import { deliveredChatLine } from "./conversation";
import { messageTiming, shanghaiDate, type SleepInterval } from "./chat-timing";

const speaker = (side: ChatLine["side"]) => side === "in" ? "好友" : "鲸鱼娘";
const channel = (peer: string) => peer.startsWith("qq-") ? "QQ" : "站内私信";

function excerpt(text: string, limit: number) {
  if (text.length <= limit) return text;
  // Corrections and titles often come at the end of a long message.
  const tail = Math.floor(limit / 2);
  return text.slice(0, limit - tail - 1) + "…" + text.slice(-tail);
}

export function chatMemoryText(line: ChatLine) {
  return [line.body, line.image_count ? "〔图片〕" : ""].filter(Boolean).join(" ") || "〔引用消息〕";
}

type Quotation = { speaker?: string; text: string };
async function quotedMessages(lines: ChatLine[]) {
  const references = lines.filter(line => line.quoted_ref);
  const quotes = new Map<string, Quotation>();
  const suppressed=new Set<string>();
  if (references.length) {
    // An index is meaningful only within its QQ conversation, even for linked accounts.
    const keys = references.map(line => [line.id, line.peer, line.quoted_ref]);
    const rows = await all<ChatLine & { quoting: string }>(
      `WITH refs AS (SELECT value ->> 0 AS quoting, value ->> 1 AS peer, value ->> 2 AS ref FROM json_each(?))
       SELECT refs.quoting,m.* FROM refs JOIN messages m ON m.peer=refs.peer
       AND (m.qq_index=refs.ref OR (m.side='in' AND m.id='qq:'||refs.ref))
       WHERE m.id<>refs.quoting AND (m.withheld=1 OR ${deliveredChatLine})`, JSON.stringify(keys),
    );
    for (const row of rows) {
      if(row.withheld) {suppressed.add(row.quoting);continue;}
      const text = row.art
        ? [row.body, "〔表情〕"].filter(Boolean).join(" ")
        : chatMemoryText(row);
      quotes.set(row.quoting, { speaker: speaker(row.side), text: excerpt(text, 600) });
    }
  }
  for (const line of lines) {
    if (!quotes.has(line.id) && line.quoted_text && !suppressed.has(line.id))
      quotes.set(line.id, { text: excerpt(line.quoted_text, 600) });
  }
  return quotes;
}

export type ChatPart = {
  text?: string;
  images?: number;
  voice?: true;
  sticker?: string;
  quote?: Quotation;
  timing?: ReturnType<typeof messageTiming>;
};
function chatPart(line: ChatLine, quotes: Map<string, Quotation>, limit: number): ChatPart {
  return {
    text: line.body ? excerpt(line.body, limit) : undefined,
    images: line.image_count || undefined,
    voice: line.voice ? true : undefined,
    sticker: line.art ? communitySticker(line.art)?.title ?? "图片" : undefined,
    quote: quotes.get(line.id),
  };
}

function sameTurn(previous: ChatLine, line: ChatLine) {
  if (line.peer !== previous.peer || line.side !== previous.side) return false;
  if (line.side === "out") return !!line.batch_id && line.batch_id === previous.batch_id;
  return line.handled_at === previous.handled_at;
}

async function messageTimings(lines:ChatLine[],state:State,now:number) {
  const incoming=lines.filter(line=>line.side==="in");
  const timings=new Map<string,NonNullable<ChatPart["timing"]>>();
  if(!incoming.length) return timings;
  const [receipts,sleeps]=await Promise.all([
    all<{id:string;value:string|null}>(`SELECT m.id,COALESCE(receipt.value,interaction.value) AS value
      FROM messages m LEFT JOIN channel_state receipt ON receipt.id='message-receipt/'||m.id
      LEFT JOIN channel_state interaction ON interaction.id='interaction/'||m.id
      WHERE m.id IN (SELECT value FROM json_each(?))`,JSON.stringify(incoming.map(line=>line.id))),
    // A completed interval is evidence even when the message predates the recent-sleep window.
    all<SleepInterval>(`SELECT a.made,a.until,
      (SELECT category FROM memories WHERE scope='public' AND kind='event' AND hidden=0 AND made=a.until
        AND category IN ('natural_wake','alarm_wake') AND a.visibility='detail' AND ? LIMIT 1) AS wakeCause
      FROM activities a WHERE a.made<=? AND a.until>? AND a.until<=?
      AND json_extract(a.detail,'$.detail.kind')='sleep'`, (state.sharing??"detail")==="detail"?1:0,
      Math.max(...incoming.map(line=>line.made)),Math.min(...incoming.map(line=>line.made)),now),
  ]);
  if(state.sleepAt>0 && state.sleepAt<=now) {
    const until=state.mode==="asleep"?now+1:state.wakeAt;
    if(until>state.sleepAt && (state.mode==="asleep" || until<=now)) sleeps.push({made:state.sleepAt,until});
  }
  const modes=new Map(receipts.map(row=>[row.id,row.value?JSON.parse(row.value).receivedMode:"unknown"]));
  for (const line of incoming) timings.set(line.id,messageTiming(line,state,now,modes.get(line.id),sleeps));
  return timings;
}

export async function chatContext(peers: string[], inbox: ChatLine[],state:State,now:number) {
  const rows = await all<ChatLine>(
    `SELECT m.* FROM messages m WHERE m.withheld=0 AND m.peer IN (SELECT value FROM json_each(?))
     AND (m.side='out' OR m.handled_at IS NOT NULL) AND ${deliveredChatLine}
     ORDER BY CASE WHEN m.side='in' THEN m.handled_at ELSE m.made END DESC,m.made DESC,m.rowid DESC LIMIT 129`, JSON.stringify(peers),
  );
  const rowsBeforeWindow = rows.length === 129 ? rows.pop() : undefined;
  const turns: ChatLine[][] = [];
  for (const line of rows.reverse()) {
    const turn = turns.at(-1);
    if (turn && sameTurn(turn[turn.length - 1], line)) turn.push(line);
    else turns.push([line]);
  }
  if (rowsBeforeWindow && sameTurn(rowsBeforeWindow, turns[0][0])) turns.shift();
  const n=numbers.read(state.config);
  const window = turns.slice(-n.chatHistoryTurns);
  const lines=[...window.flat(),...inbox];
  const [quotes,timings]=await Promise.all([quotedMessages(lines),messageTimings(lines,state,now)]);
  const part=(line:ChatLine,limit:number)=>({...chatPart(line,quotes,limit),timing:timings.get(line.id)});
  const recent = window.map(turn => ({
    speaker: speaker(turn[0].side),
    channel: channel(turn[0].peer),
    time: shanghaiDate(turn[0].made),
    messages: turn.map(line => part(line,n.chatHistoryChars)),
  }));
  const unread = inbox.map(line => part(line,line.body.length));
  const recentMemoryIds = window.flat().map(line => "chat-" + line.side + "-" + line.id);
  const recentSources=window.flat().filter(l=>l.body).slice(-12).map(l=>({id:"chat-"+l.side+"-"+l.id,body:l.body,side:l.side}));
  return { recent, unread, recentMemoryIds,recentSources };
}

type ChatContext = Awaited<ReturnType<typeof chatContext>>;
export function chatRecallCue({ unread, recent }: ChatContext) {
  const latest = [...unread].reverse().flatMap(part => [part.text, part.quote?.text])
    .filter(Boolean).join("\n");
  // Give short follow-ups their immediate question and answer, including the other speaker.
  const preceding = latest.length < 80 ? recent.slice(-2).flatMap(turn => turn.messages.map(part => part.text))
    .filter(Boolean).join("\n") : "";
  return [excerpt(latest, 900), excerpt(preceding, 300)].filter(Boolean).join("\n");
}

type ChatPrompt = Pick<ChatContext, "recent"> & {
  context: unknown[];
  friendCard: { facts: unknown[]; promises: unknown[] };
};
export function fitChatPrompt(data: ChatPrompt & Record<string, unknown>, limit = numbers.defaults.chatContextChars): string {
  // Drop complete, lower-priority records. Always send the latest exchange and the whole unread turn.
  let json = JSON.stringify(data);
  const optional=[data.references,data.stickers,data.episodeSources,data.art,data.sharedMemories,data.works,data.expressionGuide]
    .filter((items):items is unknown[]=>Array.isArray(items));
  const lastIncoming=data.recent.findLastIndex(turn=>turn.speaker==="好友");
  const keepRecent=lastIncoming<0?2:Math.max(2,data.recent.length-lastIncoming);
  for (const items of [data.context,...optional,data.recent, data.friendCard.facts, data.friendCard.promises]) {
    const minimum = items === data.recent ? keepRecent : items === data.friendCard.promises ? 1 : 0;
    while (items.length > minimum && json.length > limit) {
      if (items === data.recent) items.shift();
      else items.pop();
      json = JSON.stringify(data);
    }
    if (json.length <= limit) break;
  }
  return json;
}
