import { programGuide, type Part, type Program } from "../content/site";

// Offline vocabulary for cursor-based pieces. Compose fields and controls in the order requested.
// Other briefs (and free-form revisions) go to the resident's component-writing model.
const sources: [RegExp, Program["source"]][] = [
  [/棋谱|棋局|落子|那盘棋|五子棋/, "moves"],
  [/书签|藏品|照片说明|阅读/, "readings"],
  [/画册|画作|旧画/, "art"],
  [/动态|日记/, "posts"],
];
const vocabulary: [RegExp, string][] = [
  [/棋谱|棋盘|局面/, "board"],
  [/批注|注解|评语/, "note"],
  [/落点|坐标/, "cell"],
  [/执子|黑白/, "stone"],
  [/标题|名字/, "title"],
  [/插图|配图|照片|原图|画作/, "image"],
  [/正文|说明|原文/, "body"],
  [/日期/, "day"],
  [/进度条/, "progress"],
  [/手数|页码/, "index"],
];
export function composePiece(idea: string): Program | undefined {
  const source = sources.find(([word]) => word.test(idea))?.[1];
  if (!source || !/翻|上一步|上一手|前后|逐手|逐张|逐篇/.test(idea)) return;
  const fields = programGuide.bindings[source],
    parts: { i: number; node: Part }[] = [];
  for (const [word, field] of vocabulary) {
    const i = idea.search(word);
    if (i < 0) continue;
    let node: Part;
    if (field === "board" && source === "moves") node = { ui: "Board" };
    else if (field === "progress") node = { ui: "Progress" };
    else if (fields.includes(field))
      node = { ui: field === "image" ? "Image" : field === "title" ? "Title" : "Text", field, when: field };
    else continue;
    parts.push({ i, node });
  }
  if (!parts.length) return;
  const children = parts.sort((a, b) => a.i - b.i).map((p) => p.node);
  const view: Part = {
    ui: "Stack",
    children: [
      /旁边|并排/.test(idea) ? { ui: "Row", children } : { ui: "Stack", children },
      {
        ui: "Row",
        children: [
          { ui: "Button", text: source === "moves" ? "上一手" : "上一页", step: -1 },
          { ui: "Button", text: source === "moves" ? "下一手" : "下一页", step: 1 },
        ],
      },
    ],
  };
  return {
    name: source + "-" + crypto.randomUUID().slice(0, 8),
    purpose: idea.slice(0, 180),
    source,
    start: /最后|末尾/.test(idea) ? "last" : "first",
    view,
  };
}
