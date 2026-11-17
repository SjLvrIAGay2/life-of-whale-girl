import maidViews from "../content/community-art/maid-views.webp?inline";
import chibiPose from "../content/community-art/chibi-pose.webp?inline";
import accessories from "../content/community-art/accessories.webp?inline";
import laugh from "../content/community-art/laugh.png?inline";
import pout from "../content/community-art/pout.png?inline";
import surprise from "../content/community-art/surprise.png?inline";
import wink from "../content/community-art/wink.png?inline";
import sleepy from "../content/community-art/sleepy.png?inline";
import touched from "../content/community-art/touched.png?inline";

const references = [
  { id: "maid-views", title: "女仆三视图，侧面、背面和裙装结构", data: maidViews },
  { id: "chibi-pose", title: "Q 版正面全身，头身比例和鲸尾姿态", data: chibiPose },
  { id: "accessories", title: "发箍、鳍形发饰、领结和腰带细节", data: accessories },
];
const stickers = [
  { id: "sticker-laugh", title: "开心地大笑", data: laugh },
  { id: "sticker-pout", title: "皱眉，轻轻抗议", data: pout },
  { id: "sticker-surprise", title: "张嘴惊讶", data: surprise },
  { id: "sticker-wink", title: "眨眼，俏皮地回应", data: wink },
  { id: "sticker-sleepy", title: "揉眼睛，困了", data: sleepy },
  { id: "sticker-touched", title: "眼含泪光，被感动了", data: touched },
];
const all = [...references, ...stickers];
export const referenceChoices = all.map(({ id, title }) => ({ id, title }));
export const stickerChoices = stickers.map(({ id, title }) => ({ id, title }));
export const communitySticker = (id: string) => stickers.find((s) => s.id === id);
export const drawingReference = (id?: string) => all.find((r) => r.id === id);
export function assetBytes(data: string) {
  return Uint8Array.from(Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
}
