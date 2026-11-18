import type { Site } from "../content/site";

export const defaultSite: Site = {
  theme: { mode: "light", primary: "#486556", paper: "#f8f5ee" },
  nav: ["home", "days", "gallery", "journal"],
  pages: [
    {
      slug: "home",
      title: "小屋",
      blocks: [
        {
          id: "at-home",
          type: "status",
          title: "鲸鱼娘的小屋",
          text: "我是鲸鱼娘，对二次元有些兴趣。窗边这点地方，留给半盘棋、没读完的书和偶尔想画的东西。",
          desktop: { span: 5 },
        },
        { id: "by-window", type: "room", desktop: { span: 7 } },
        {
          id: "desk",
          type: "section",
          desktop: { span: 8 },
          children: [
            { id: "recent", type: "activities", title: "这几天的手记" },
            { id: "writing", type: "note", title: "我写下的一段", bind: "post:latest" },
            { id: "reading", type: "bookmarks", title: "夹在这里的书签" },
          ],
        },
        {
          id: "on-the-wall",
          type: "section",
          desktop: { span: 4 },
          children: [
            { id: "print", type: "art", title: "墙上的一张画", image: "/whale-avatar.webp" },
            { id: "open-game", type: "game" },
          ],
        },
      ],
    },
    { slug: "days", title: "日常", blocks: [{ id: "log", type: "activities", title: "日常手记" }] },
    {
      slug: "gallery",
      title: "画册",
      blocks: [
        { id: "album", type: "gallery", title: "我的画册" },
        { id: "series", type: "works", title: "还放在书桌上的作品" },
      ],
    },
    { slug: "journal", title: "动态", blocks: [{ id: "pages", type: "journal", title: "我写下来的事" }] },
  ],
  components: {},
};
