import { env } from "cloudflare:workers";
import { limited } from "./security";
import { maxVoiceBytes, transcribe } from "./speech";

export type QQAudio = { content_type?: string; filename?: string; url?: string; voice_wav_url?: string; asr_refer_text?: string };
export function isQQVoice(a: QQAudio) {
  return !!a && (!!a.voice_wav_url || !!a.asr_refer_text || /^(?:audio\/|voice)/i.test(a.content_type || "") || /\.(?:silk|slk|wav|ogg)$/i.test(a.filename || ""));
}
export async function downloadQQ(link: string, limit: number) {
  const url = new URL(link.startsWith("//") ? "https:" + link : link);
  if (!["https:", "http:"].includes(url.protocol) || url.port || url.username || url.password ||
      !/(?:^|\.)(?:qq\.com(?:\.cn)?|qqbot\.cn|qpic\.cn|gtimg\.cn|gtimg\.com)$/i.test(url.hostname))
    throw Error("无效的 QQ 附件地址");
  url.protocol = "https:";
  const r = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!r.ok || !r.body) throw Error("QQ 语音下载失败");
  if (Number(r.headers.get("content-length")) > limit) throw Error("QQ 附件过大");
  return limited(r.body, limit);
}
export async function hearQQVoice(a: QQAudio) {
  let audio;
  for (const link of new Set([a.voice_wav_url, a.url])) {
    if (!link) continue;
    try {
      const bytes = await downloadQQ(link,maxVoiceBytes);
      const sig = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
      audio = sig.includes("#!SILK_V3")
        ? await env.WHALE_QQ_VOICE?.toWave(bytes)
        : bytes;
      if (audio) return await transcribe(audio);
    } catch { /* QQ can also provide the original attachment and its own transcript. */ }
  }
  return typeof a.asr_refer_text === "string" ? a.asr_refer_text.trim() : "";
}
