import { modelErrors } from "../config/texts/errors.ts";
import { texts } from "../config/texts.ts";
import { modelContract } from "../config/prompts/tasks";
import { numbers } from "../config/numbers";
import { links } from "../config/links";
import { env } from "cloudflare:workers";
import { currentOverrides, discardModelCall, recordModelCall } from "../db";
import { measured, type Meter } from "./telemetry";
import { groundFriendReply } from "./chat-grounding";
import { modelContext } from "./model-context";
type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type Message = { role: "system" | "user" | "assistant"; content: string | Part[] };
export async function think(
  instruction: string,
  data: unknown,
  now = Date.now(),
  priority: "activity" | "chat" | "journal" = "activity",
  image?: string | string[],
  task: string=priority,
) {
  const key=env.WHALE_DEEPSEEK_API_KEY;
  if (!key) throw Error(modelErrors.credentials);
  // Count autonomous usage without a daily cap. Conversation is metered separately.
  const n = numbers.read(await currentOverrides());
  const counted = priority !== "chat";
  if (counted) await recordModelCall(now);
  const model=image ? texts.defaults.modelName : env.WHALE_MODEL || texts.defaults.modelName;
  return measured(task,model,now,receipt=>generate(
    instruction,
    data,
    key,
    model,image,receipt,undefined,task==="persona_replay"?"replay":priority==="chat",n,
    task==="sleep_review" || task==="friend_review" ? n.sleepReviewTokens : n.modelTokens,
  )).catch(async error => {
    if (counted) await discardModelCall(now);
    throw error;
  });
}
export async function generate(
  instruction: string,
  data: unknown,
  key: string,
  model: string,
  image?: string | string[],
  receipt?: (usage?:Meter)=>void,
  endpoint: string=links.defaults.model,
  conversation:boolean|"replay"=false,
  n=numbers.defaults,
  outputTokens=n.modelTokens,
) {
  const content = modelContext(data,conversation?n.chatContextChars:image?n.visionContextChars:n.textContextChars);
  const messages: Message[] = [
    {
      role: "system",
      content:
        instruction +
        modelContract,
    },
  ];
  const turn=conversation?JSON.parse(content):null;
  let current=content;
  if(turn) {
    const {recent=[],unread=[],visuals,interactions,...environment}=turn;
    messages.push({role:"user",content:JSON.stringify(environment)});
    for(const history of recent) messages.push({
      role:history.speaker==="鲸鱼娘"?"assistant":"user",
      content:JSON.stringify({history}),
    });
    current=JSON.stringify({unread,visuals,interactions});
  }
  messages.push({role:"user",content:image
    ? [{type:"text",text:current},...(Array.isArray(image)?image:[image]).map(url=>({type:"image_url" as const,image_url:{url}}))]
    : current});
  const deepseek=new URL(endpoint).hostname===new URL(links.defaults.model).hostname;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(key ? { Authorization: "Bearer " + key } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: !deepseek && conversation ? {type:"json_schema",json_schema:{name:"friend_reply",schema:{
        type:"object",properties:{decision:{type:"string",enum:["send","silent"]},messages:{type:"array",items:{type:"string"},maxItems:4}},
        required:["decision"],additionalProperties:true}}} : { type: "json_object" },
      ...(deepseek ? { thinking: { type: "disabled" } } : {temperature:0}),
      max_tokens: outputTokens,
      stream: false,
    }),
    signal: AbortSignal.timeout(n.modelTimeoutMs),
    redirect:"error",
  });
  if (!res.ok) throw Error("模型服务暂不可用 (" + res.status + ")");
  const result = (await res.json()) as {
    choices?: { message: { content: string } }[];
    usage?: Meter;
  };
  receipt?.(result.usage);
  const raw = result.choices?.[0]?.message.content ?? "";
  try {
    const parsed=JSON.parse(raw.replace(/^\s*```(?:json)?|```\s*$/g, ""));
    if(!turn) return parsed;
    const answer=groundFriendReply(turn,parsed);
    return {...answer,grounding:answer===parsed?undefined:answer.grounding,
      ...(conversation==="replay"?{modelAnswer:parsed}:{})};
  } catch {
    throw Error(modelErrors.invalidResponse);
  }
}
