import { env } from "cloudflare:workers";
import residentReference from "../content/resident-reference.webp?inline";
import { discardModelCall, recordModelCall } from "../db";
import { assetBytes, drawingReference } from "./community-art";
import { measured, type Meter } from "./telemetry";

const drawingModel = "gpt-image-2.6-flare";
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
) {
  if (!env.WHALE_OPENAI_API_KEY) throw Error("未配置绘图模型");
  const form = new FormData();
  form.set("model", drawingModel);
  form.set("size", "1024x1024");
  form.set("quality", "medium");
  form.set("output_format", "png");
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
  const prompt = [
    "请根据创作意图画一张独立的二次元表情或小画。第一张图是鲸鱼娘的角色设定，画到她时请保留发色、头鳍和尾巴等辨识特征。让动作和神情在聊天缩略图中也清楚可辨。",
    "创作意图：" + idea,
    "绘画偏好：" + style,
  ];
  if (extra) prompt.push("第二张为社区绘图参考（" + extra.title + "），按需借鉴动作、表情或细节，角色身份以第一张为准。");
  if (revision)
    prompt.push("最后一张图是初稿。保留其余构图，只做这项修改：" + revision.instruction);
  form.set("prompt", prompt.join("\n"));
  const request = new Request("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WHALE_OPENAI_API_KEY },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(180000),
  });
  await recordModelCall(now);
  try {
    return await measured(revision?"drawing_revision":"drawing",drawingModel,now,async receipt=>{
    const res = env.WHALE_IMAGE_TRANSPORT ? await env.WHALE_IMAGE_TRANSPORT.fetch(request) : await fetch(request);
    if (!res.ok) throw Error("绘图服务暂不可用 (" + res.status + ")");
    const result = await res.json<{ data?: { b64_json?: string }[];usage?:Meter }>();
    receipt(result.usage);
    const encoded = result.data?.[0]?.b64_json;
    if (typeof encoded !== "string") throw Error("绘图服务未返回图片");
    const png = Buffer.from(encoded, "base64");
    if (png.length < 45 || png.toString("hex", 0, 8) !== "89504e470d0a1a0a" ||
        png.toString("ascii", 12, 16) !== "IHDR" || png.subarray(-8, -4).toString("ascii") !== "IEND")
      throw Error("绘图服务返回了无效的 PNG");
    return Uint8Array.from(png);
    });
  } catch (error) {
    await discardModelCall(now);
    throw error;
  }
}
