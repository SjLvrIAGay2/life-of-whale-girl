import { published, wording } from "../options.ts";
import { routes } from "../routes.ts";

export const residentLinks = {
  home: published({ ...wording("/", "点击品牌或返回小屋时打开的访客链接", 512), link: true }),
  feed: published({ ...wording(routes.feed, "页脚 RSS 链接", 512), link: true }),
  avatar: published({ ...wording("/whale-avatar.webp", "公开站点的品牌头像"), choices: ["/whale-avatar.webp", "/whale.svg", "/room/resident.webp"] }),
  roomDay: published({ ...wording("/room/room.webp", "小屋白天背景图"), choices: ["/room/room.webp", "/room/room-night.webp"] }),
  roomNight: published({ ...wording("/room/room-night.webp", "小屋夜间背景图"), choices: ["/room/room-night.webp", "/room/room.webp"] }),
  favicon: published({ ...wording("/whale.svg", "浏览器标签页图标"), choices:["/whale.svg","/whale-avatar.webp"] }),
};
