import { env } from "cloudflare:workers";
import { limited } from "./security";
import { pcmWave } from "./wave";
import { measured } from "./telemetry";

export const maxVoiceBytes = 8 * 1024 * 1024;
const maxSynthBytes = 30 * 60 * 24000 * 2;
function auth() {
  if (!env.WHALE_DEEPSEEK_API_KEY) throw Error("未配置语音服务");
  return { Authorization: "Bearer " + env.WHALE_DEEPSEEK_API_KEY };
}
export class SpeechError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request(tool: "asr" | "tts", body: BodyInit, headers: Record<string,string>) {
  const response = await fetch("https://api.deepseek.com/v1/tools/" + tool, {
    method: "POST", body, headers: { ...auth(), ...headers }, redirect: "error",
    signal: AbortSignal.timeout(85000),
  });
  if (!response.ok) {
    const status = response.status;
    const message = status === 429 ? "语音服务正忙，请稍后重试" : status === 413 ? "音频文件过大" :
      status === 400 && tool === "asr" ? "无法识别这段音频，请使用两分钟以内的 PCM WAV 或 Ogg Opus" : "语音服务暂时不可用";
    throw new SpeechError([400, 413, 429].includes(status) ? status : 502, message);
  }
  return response;
}
export async function transcribe(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > maxVoiceBytes) throw new SpeechError(413, "音频须在 8 MiB 以内");
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(12, bytes.length)).toString("ascii");
  const ogg = head.startsWith("OggS");
  if (!ogg && !(head.startsWith("RIFF") && head.endsWith("WAVE")))
    throw new SpeechError(415, "请选择 PCM WAV 或 Ogg Opus 音频");
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)], {type: ogg ? "audio/ogg" : "audio/wav"}), ogg ? "voice.ogg" : "voice.wav");
  return measured("asr","deepseek-asr",Date.now(),async()=>{
  const result = await (await request("asr", form, {})).json<{text?:string;duration_ms?:number}>();
  if (typeof result.text !== "string" || !result.text.trim()) throw new SpeechError(422, "没有听清，请再说一次");
  return result.text.trim();
  });
}
export async function synthesize(text: string) {
  return measured("tts","stella",Date.now(),async()=>{
  const r = await request("tts", JSON.stringify({text, voice_id:"stella", format:"pcm", filter_markdown:true}), {"Content-Type":"application/json"});
  if (!r.body || !r.headers.get("content-type")?.includes("audio/")) throw Error("语音服务未返回音频");
  const pcm = await limited(r.body, maxSynthBytes);
  if (pcm.byteLength < 2 || pcm.byteLength % 2) throw Error("语音数据不完整");
  return pcmWave(pcm, 24000);
  });
}
