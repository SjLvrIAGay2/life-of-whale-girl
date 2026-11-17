import { all, type ChatLine } from "../db";
import { communitySticker } from "./community-art";
import { deliveredChatLine } from "./conversation";
import { shanghaiDate } from "./friend-memory";

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

type ChatPart = {
  text?: string;
  images?: number;
  voice?: true;
  sticker?: string;
  quote?: Quotation;
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

export async function chatContext(peers: string[], inbox: ChatLine[]) {
  const rows = await all<ChatLine>(
    `SELECT m.* FROM messages m WHERE m.withheld=0 AND m.peer IN (SELECT value FROM json_each(?))
     AND (m.side='out' OR m.handled_at IS NOT NULL) AND ${deliveredChatLine}
     ORDER BY m.made DESC,m.rowid DESC LIMIT 129`, JSON.stringify(peers),
  );
  const rowsBeforeWindow = rows.length === 129 ? rows.pop() : undefined;
  const turns: ChatLine[][] = [];
  for (const line of rows.reverse()) {
    const turn = turns.at(-1);
    if (turn && sameTurn(turn[turn.length - 1], line)) turn.push(line);
    else turns.push([line]);
  }
  if (rowsBeforeWindow && sameTurn(rowsBeforeWindow, turns[0][0])) turns.shift();
  const window = turns.slice(-16);
  const quotes = await quotedMessages([...window.flat(), ...inbox]);
  const recent = window.map(turn => ({
    speaker: speaker(turn[0].side),
    channel: channel(turn[0].peer),
    time: shanghaiDate(turn[0].made),
    messages: turn.map(line => chatPart(line, quotes, 640)),
  }));
  const unread = inbox.map(line => chatPart(line, quotes, line.body.length));
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
export function fitChatPrompt(data: ChatPrompt & Record<string, unknown>): string {
  // Drop complete, lower-priority records. Always send the latest exchange and the whole unread turn.
  let json = JSON.stringify(data);
  const limit = 24000;
  const optional=[data.references,data.stickers,data.episodeSources,data.art,data.sharedMemories,data.works,data.expressionGuide]
    .filter((items):items is unknown[]=>Array.isArray(items));
  for (const items of [data.context,...optional,data.recent, data.friendCard.facts, data.friendCard.promises]) {
    const minimum = items === data.recent ? 2 : items === data.friendCard.promises ? 1 : 0;
    while (items.length > minimum && json.length > limit) {
      if (items === data.recent) items.shift();
      else items.pop();
      json = JSON.stringify(data);
    }
    if (json.length <= limit) break;
  }
  return json;
}
