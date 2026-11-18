import type { Behavior } from "../../lib/cabin-model";
import { siteUsage } from "./site";

export const capabilityGuides = {
  bili: { description: "看哔哩哔哩", example: { action: "browse" }, parameters: "action 可用 browse、search、open、subtitles、frames、comments、history、watch_later。search 填 query，打开内容填 id。可选 page、offset、root、cursor。" },
  heybox: { description: "读小黑盒", example: { action: "browse" }, parameters: "action 可用 browse、search、open、comments。search 填 query，读帖子或评论填 id。翻页用 page，续读正文用 offset。" },
  browser: { description: "打开网页", example: {}, parameters: "省略 url 打开小站首页，也可填支持的哔哩哔哩或小黑盒链接。" },
  website: { description: "布置个人小站", example: { op: "catalog" }, parameters: siteUsage },
  game: { description: "玩这一局", example: { op: "look" }, parameters: "op 可用 look、move、pause、resume、restart、next。落子或移动填 move，可加 note 留下批注。" },
  open: { description: "打开", example: {} },
  close: { description: "关上", example: {} },
  work: { description: "翻看这件作品的进展", example: {} },
  picture: { description: "看这幅画", example: {} },
} satisfies Record<Extract<Behavior, { capability: string }>["capability"], { description: string; example: object; parameters?: string }>;
export const recipeInputs = {
  none: { example: {} },
  text: { parameters: "input 填一段文字", example: { input: "窗边听见了鸟鸣" } },
  integer: { parameters: "input 填非负整数", example: { input: 0 } },
};
