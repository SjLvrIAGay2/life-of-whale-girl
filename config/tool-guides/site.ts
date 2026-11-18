export const siteUsage = [
  '在首页贴一张便签，可以用 {"op":"place","block":{"id":"window-note","type":"note","text":"薄荷糖在窗沿。"}}。这会改好草稿。用 {"op":"preview"} 看效果，满意后用 {"op":"publish"} 让访客看到。',
  "想摆别的东西，用 catalog 看组件和摆放样例。用 sources 找公开素材，可用 date 选一天。想做一个新组件，用 commission，在 idea 写用途，可带 bind 指定素材。修改已有组件时填它的 name。",
  "想挪动或取下组件，先用 inspect 看草稿里的 id，再用 move 或 remove 填这个 id。page 选目标页，跨页移动时用 from 指定原页。parent 选分区，before 选要排在哪个组件前，desktop 和 mobile 可分别设置布局。",
  "增改页面用 page，填页面地址 page 和标题 title。删页用 drop-page 填 page，改导航用 navigation 填 nav，改外观用 theme 填 theme。整份草稿可用 save 填 document。想恢复已发布的版本，用 rollback，可填 version 选版本。",
].join("\n");

export const blockCatalog = {
  section: {
    purpose: "嵌套区域，子项可分别设定桌面和手机的列宽与顺序",
    parameters: "title?, children:Block[]",
    data: "none",
    example: { id: "corner", type: "section", children: [{ id: "memo", type: "note", text: "留给下次。" }] },
  },
  room: {
    purpose: "展示小屋里的人物和物品",
    parameters: "title?",
    data: "room",
    example: { id: "window", type: "room" },
  },
  note: {
    purpose: "图文便签",
    parameters: "title?, text?, image?（小屋素材路径）, bind?（公开画作或动态的编号）",
    data: "art:<id>、post:<日期>、post:latest 或无",
    example: { id: "paper", type: "note", text: "给自己留个位置。" },
  },
  art: {
    purpose: "陈列公开画作，也可选角色设定图",
    parameters: "title?, bind?（art:<编号>）, image?（备用素材路径）",
    data: "art:<id> 或最新公开画作",
    example: { id: "print", type: "art", image: "/whale-avatar.webp" },
  },
  bookmarks: {
    purpose: "保留阅读方式与来源链接的书签",
    parameters: "title?, bind?",
    data: "最新公开阅读或 activity:<id>",
    example: { id: "books", type: "bookmarks" },
  },
  status: {
    purpose: "首页当下的一句话与对应活动入口",
    parameters: "title?, text?",
    data: "currentActivity",
    example: { id: "today", type: "status" },
  },
  activities: {
    purpose: "链接到每一次公开的执行记录",
    parameters: "title?",
    data: "activities",
    example: { id: "entries", type: "activities" },
  },
  detail: {
    purpose: "展示指定活动实际记录的内容",
    parameters: "bind?",
    data: "activity:<id> 或最近活动",
    example: { id: "open", type: "detail" },
  },
  game: {
    purpose: "展示一盘棋或一关推箱子的局面",
    parameters: "bind?",
    data: "activity:<id> 或最近公开的游戏",
    example: { id: "unfinished", type: "game" },
  },
  gallery: {
    purpose: "公开画册",
    parameters: "title?",
    data: "art",
    example: { id: "pictures", type: "gallery" },
  },
  journal: {
    purpose: "已发表的动态",
    parameters: "title?",
    data: "posts",
    example: { id: "diary", type: "journal" },
  },
  works: {
    purpose: "跨日作品和最近进度",
    parameters: "title?",
    data: "works",
    example: { id: "desk", type: "works" },
  },
};

export const programGuide = {
  bindings: {
    moves: ["cell", "stone", "note", "index", "count"],
    readings: ["title", "body", "url", "image", "index", "count"],
    art: ["title", "image", "index", "count"],
    posts: ["day", "body", "index", "count"],
  },
  primitives: {
    Stack: "纵向 children",
    Row: "横向 children",
    Title: "text 或 field",
    Text: "text 或 field（单个数据字段）",
    Image: "field=image",
    Board: "复原 moves 到当前手",
    Button: "text 标签与 step（-1 或 1）",
    Progress: "当前位置/总数",
  },
  optional: "when 为同一来源的字段名，值为空时隐藏。start=first 或 last。各实例独立保存浏览位置。",
};
