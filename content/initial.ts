export const residentId = "whale";
export const firstName = "鲸鱼娘的个人小站";
export const initialSelf =
  "我叫鲸鱼娘，住在自己的小屋里，对二次元有些兴趣，对主人有些好感。我的爱好和说话方式会随着经历慢慢变化。";
export const furniture = {
  bed: { name: "床", width: 39, x: 24, y: 84 },
  desk: { name: "书桌", width: 27, x: 76, y: 85 },
  computer: { name: "电脑", width: 13, x: 76, y: 62.5 },
  plant: { name: "绿植", width: 9, x: 36, y: 79 },
  lamp: { name: "落地灯", width: 7, x: 84, y: 83 },
  shelf: { name: "书架", width: 16, x: 14, y: 77 },
  chair: { name: "椅子", width: 9, x: 70, y: 90 },
  alarm: { name: "床头闹钟", width: 7, x: 7, y: 61 },
} as const;
export type ObjectKind = keyof typeof furniture;
export type RoomItem = { id: string; kind: ObjectKind; x: number; y: number };
export type SleepSession = {
  started: number;
  deadline: number;
  threshold: number;
  recovery: number;
  usualWakeHour: number;
  naturalAt: number;
  learn: boolean;
  onsetUnknown?: boolean;
  visibility: "hidden" | "summary" | "detail";
};
export type ActionReceipt = {
  action: string;
  made: number;
  status: "done" | "started" | "planned" | "queued" | "skipped" | "deferred" | "failed" | "unverified";
  summary: string;
  ref?: string;
};
export type State = {
  name: string;
  mode: "awake" | "asleep";
  wakeAt: number;
  nextAt: number;
  sleepAt: number;
  sleepId: string;
  wokeAt?: number;
  bedtimeMood?: string;
  sleepVersion?: 1;
  experienceVersion?: 1;
  sleepSession?: SleepSession;
  body?: { at: number; pressure: number };
  inBed?: boolean;
  bedVisibility?: "hidden" | "summary" | "detail";
  alarms?: Record<string,number>;
  lastBell?: { id: string; at: number; heard: boolean };
  activity: string;
  room: RoomItem[];
  cabinVersion?: 1;
  mood: string;
  feeling?: {label:string;cause:string;strength:number;since:number;until:number};
  interests: string[];
  attention: string;
  question?: { text: string; source?: import("../lib/media").ReadRequest["source"]; id?: string; page?: number };
  focusWork?: string;
  shareEpoch?:string;
  sharing?: import("./activity").Visibility;
  currentActivity?: string;
  lastAction?: ActionReceipt | null;
  lastActionScope?: string;
  attentionScope?: string;
  attentionActivity?: string;
  quickSteps?: number;
  budgetRetryAt?: number; // Legacy pause marker, cleared on the next tick.
  lastResult?: unknown;
  journalHabit?: { everyDays:number; nextDay:string };
};
export function firstState(now: number): State {
  return {
    name: firstName,
    mode: "awake",
    wakeAt: now,
    wokeAt: now,
    nextAt: now,
    sleepAt: 0,
    sleepId: "",
    sleepVersion: 1,
    experienceVersion: 1,
    activity: "在小屋",
    lastAction: null,
    room: (["bed", "desk", "computer", "alarm"] as const).map((kind) => ({
      id: kind,
      kind,
      x: furniture[kind].x,
      y: furniture[kind].y,
    })),
    mood: "平静",
    interests: ["二次元"],
    attention: "",
  };
}
export function dayOf(time: number) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10);
}
export function hourOf(time: number) {
  return new Date(time + 8 * 3600000).getUTCHours();
}
export const statusNames: Record<string, string> = {
  home: "在小屋",
  read: "在看电脑",
  draw: "在画画",
  room: "在整理房间",
  sleep: "睡着了",
};
export type PublicPost = {
  day: string;
  body: string;
  made: number;
  sources: { name: string; url: string }[];
};
export type Art = { id: string; title: string; made: number };
export type PublicHome = {
  name: string;
  mode: State["mode"];
  inBed?: boolean;
  activity: string;
  room: RoomItem[];
  posts: PublicPost[];
  art: Art[];
  revision: number;
  syncedAt?:number;
  currentActivity?:string;
  activities?:import("./activity").PublicActivity[];
  site?:import("./site").Site;
  boundArt?:Art[];
  boundPosts?:PublicPost[];
  more?:boolean;
  series?:{id:string;title:string}[];
  objects?:Awaited<ReturnType<typeof import("../lib/works").publicRoom>>;
  cabin?:import("../lib/cabin-model").PublicItem[];
};
