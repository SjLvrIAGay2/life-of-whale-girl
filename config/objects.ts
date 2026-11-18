import type { z } from "zod";
import type { capabilities, definition, Properties, Region } from "../lib/cabin-model";

type Raw = z.input<typeof definition>;
type Size = Properties["size"];
const surface = (label: string, shape: Size, loadG: number): Region => ({
  label,
  relation: "on",
  size: shape,
  loadG,
});
const apps: Region = { label: "软件安装位", relation: "installed", capacityMB: 8192 };
const software = (name: string, installMB: number, capability: (typeof capabilities)[number]) =>
  ({ name, size: [1, 1, 1], massG: 0, installMB, actions: { open: { capability } } } satisfies Raw);
export const builtinDefinitions: Record<string, Raw> = {
  cabin: {
    name: "小屋",
    size: [1000, 1000, 300],
    massG: 0,
    regions: {
      floor: surface("地面", [1000, 1000, 300], 1e9),
      wall: { label: "墙面", relation: "hang", size: [1000, 280, 80], loadG: 50000 },
    },
  },
  sill: {
    name: "窗沿",
    size: [100, 24, 4],
    massG: 3000,
    regions: { top: surface("窗沿台面", [100, 24, 150], 12000) },
  },
  desk: {
    name: "书桌",
    size: [120, 62, 76],
    massG: 19000,
    regions: {
      top: surface("桌面", [120, 62, 190], 40000),
      fitting: { label: "抽屉槽", relation: "part", size: [50, 40, 16], loadG: 12000 },
    },
    contents: [{ type: "drawer", region: "fitting" }],
  },
  drawer: {
    name: "抽屉",
    size: [48, 38, 14],
    massG: 1500,
    regions: {
      inside: {
        label: "抽屉内腔",
        relation: "inside",
        size: [45, 35, 12],
        loadG: 7000,
        gate: "open",
        opening: [45, 11],
      },
    },
    state: { open: true },
    actions: { open: { capability: "open" }, close: { capability: "close" } },
  },
  computer: { name: "电脑", size: [45, 22, 35], massG: 4500, regions: { apps } },
  bed: {
    name: "床",
    size: [190, 95, 50],
    massG: 25000,
    regions: { top: surface("床面", [190, 95, 200], 160000) },
  },
  plant: { name: "绿植", size: [18, 18, 40], massG: 2000 },
  lamp: { name: "落地灯", size: [24, 24, 125], massG: 4100 },
  shelf: {
    name: "书架",
    size: [68, 30, 145],
    massG: 14000,
    regions: { shelf: surface("搁板", [65, 28, 40], 15000) },
  },
  chair: {
    name: "椅子",
    size: [42, 40, 75],
    massG: 6200,
    regions: { seat: surface("椅面", [40, 38, 80], 90000) },
  },
  alarm: { name: "床头闹钟", size: [10, 6, 10], massG: 180 },
  box: {
    name: "盒子",
    size: [20, 12, 7],
    massG: 120,
    regions: {
      inside: { label: "内腔", relation: "inside", size: [18, 10, 6], loadG: 1200, opening: [18, 6] },
      top: surface("盒盖顶面", [20, 12, 30], 600),
    },
  },
  phone: {
    name: "手机",
    size: [15, 7, 0.9],
    massG: 180,
    regions: { apps },
    contents: [
      { type: "bili", region: "apps" },
      { type: "heybox", region: "apps" },
      { type: "browser", region: "apps" },
    ],
  },
  bili: software("哔哩哔哩", 360, "bili"),
  heybox: software("小黑盒", 180, "heybox"),
  browser: software("浏览器", 120, "browser"),
  website: software("小屋网站", 1, "website"),
  board: {
    name: "五子棋盘",
    size: [25, 25, 2],
    massG: 380,
    actions: { play: { capability: "game" } },
  },
  puzzle: {
    name: "推箱子",
    size: [16, 12, 2],
    massG: 150,
    actions: { play: { capability: "game", game: "sokoban" } },
  },
  work: { name: "作品", size: [21, 15, 1], massG: 80, actions: { open: { capability: "work" } } },
  picture: {
    name: "画作",
    size: [20, 15, 0.1],
    massG: 5,
    actions: { open: { capability: "picture" } },
  },
  keepsake: { name: "纪念物", size: [1, 1, 1], massG: 0 },
};
