import { services } from "../config/operator/services.ts";
import { atelierErrors } from "../config/texts/errors.ts";
import { texts } from "../config/texts.ts";
import type { Overrides } from "../config/options.ts";
import { numbers } from "../config/numbers.ts";
import { links } from "../config/links.ts";
import { drawingPrompt } from "../config/prompts/drawing";
import { env } from "cloudflare:workers";
import residentReference from "../content/resident-reference.webp?inline";
import { discardModelCall, recordModelCall } from "../db";
import { assetBytes, drawingReference } from "./community-art";
import { measured, type Meter } from "./telemetry";

const drawingModel = texts.defaults.drawingModel;
const reference = new Blob(
  [assetBytes(residentReference)],
  { type: "image/webp" },
);

export async function drawImage(
  idea: string,
  style: string,
  now: number,
  revision?: { image: Uint8Array<ArrayBuffer>; instruction: string },
  referenceId?: string,
  overrides?: Overrides,
) {
  if (!env.WHALE_OPENAI_API_KEY) throw Error(atelierErrors.credentials);
  const prefs=texts.read(overrides);
  const form = new FormData();
  form.set("model", drawingModel);
  form.set("size", prefs.drawingSize);
  form.set("quality", prefs.drawingQuality);
  form.set("output_format", services.imageFormat);
  const extra = drawingReference(referenceId);
  const images = revision || extra ? "image[]" : "image";
  form.append(images, reference, "resident.webp");
  if (extra) {
    const mime = extra.data.startsWith("data:image/png;") ? "image/png" : "image/webp";
    form.append(images, new Blob([assetBytes(extra.data)], { type: mime }), extra.id + "." + mime.slice(6));
  }
  if (revision)
    form.append(
      images,
      new Blob([revision.image], { type: "image/png" }),
      "draft.png",
    );
  form.set("prompt", drawingPrompt(idea, style, extra?.title, revision?.instruction));
  const request = new Request(links.defaults.drawing, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WHALE_OPENAI_API_KEY },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(numbers.defaults.drawingTimeoutMs),
  });
  await recordModelCall(now);
  try {
    return await measured(revision?"drawing_revision":"drawing",drawingModel,now,async receipt=>{
    const res = env.WHALE_IMAGE_TRANSPORT ? await env.WHALE_IMAGE_TRANSPORT.fetch(request) : await fetch(request);
    if (!res.ok) throw Error("绘图服务暂不可用 (" + res.status + ")");
    const result = await res.json<{ data?: { b64_json?: string }[];usage?:Meter }>();
    receipt(result.usage);
    const encoded = result.data?.[0]?.b64_json;
    if (typeof encoded !== "string") throw Error(atelierErrors.noImage);
    const png = Buffer.from(encoded, "base64");
    if (png.length < 45 || png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
        png.toString("ascii", 12, 16) !== "IHDR" || png.subarray(-8, -4).toString("ascii") !== "IEND")
      throw Error(atelierErrors.invalidPng);
    return Uint8Array.from(png);
    });
  } catch (error) {
    await discardModelCall(now);
    throw error;
  }
}
