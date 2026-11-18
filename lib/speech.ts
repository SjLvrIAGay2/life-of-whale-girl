import { services } from "../config/operator/services.ts";
import { speechErrors } from "../config/texts/errors.ts";
import { texts } from "../config/texts.ts";
import { numbers } from "../config/numbers.ts";
import { links } from "../config/links.ts";
import { env } from "cloudflare:workers";
import { limited } from "./security";
import { pcmWave } from "./wave";
import { measured } from "./telemetry";

export const maxVoiceBytes = numbers.defaults.voiceBytes;
const maxSynthBytes = 30 * 60 * numbers.defaults.voiceSampleRate * 2;
function auth() {
  if (!env.WHALE_DEEPSEEK_API_KEY) throw Error(speechErrors.credentials);
  return { Authorization: "Bearer " + env.WHALE_DEEPSEEK_API_KEY };
}
export class SpeechError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
async function request(tool: "asr" | "tts", body: BodyInit, headers: Record<string,string>) {
  const response = await fetch(links.defaults.speech + tool, {
    method: "POST", body, headers: { ...auth(), ...headers }, redirect: "error",
    signal: AbortSignal.timeout(numbers.defaults.speechTimeoutMs),
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
  if (!bytes.length || bytes.length > maxVoiceBytes) throw new SpeechError(413, speechErrors.size);
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(12, bytes.length)).toString("ascii");
  const ogg = head.startsWith("OggS");
  if (!ogg && !(head.startsWith("RIFF") && head.endsWith("WAVE")))
    throw new SpeechError(415, speechErrors.format);
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)], {type: ogg ? "audio/ogg" : "audio/wav"}), ogg ? "voice.ogg" : "voice.wav");
  return measured("asr",services.asrModel,Date.now(),async()=>{
  const result = await (await request("asr", form, {})).json<{text?:string;duration_ms?:number}>();
  if (typeof result.text !== "string" || !result.text.trim()) throw new SpeechError(422, speechErrors.inaudible);
  return result.text.trim();
  });
}
export async function synthesize(text: string) {
  return measured("tts",texts.defaults.speechVoice,Date.now(),async()=>{
  const r = await request("tts", JSON.stringify({text, voice_id:texts.defaults.speechVoice, format:"pcm", filter_markdown:true}), {"Content-Type":"application/json"});
  if (!r.body || !r.headers.get("content-type")?.includes("audio/")) throw Error(speechErrors.noAudio);
  const pcm = await limited(r.body, maxSynthBytes);
  if (pcm.byteLength < 2 || pcm.byteLength % 2) throw Error(speechErrors.incomplete);
  return pcmWave(pcm, numbers.defaults.voiceSampleRate);
  });
}
