import { firstName, firstInterest } from "../config/resident-profile.ts";
import { numbers } from "../config/numbers.ts";
import { texts } from "../config/texts.ts";
import { furniture } from "../config/furniture.ts";
import type { Overrides } from "../config/options";
export const residentId = "whale";
export { firstName };
export { initialSelf } from "../config/prompts/tasks.ts";
export { furniture };
export type ObjectKind = keyof typeof furniture;
export type RoomItem = { id: string; kind: ObjectKind; x: number; y: number };
export type SleepSession = {
  started: number;
  deadline: number;
  threshold: number;
  recovery: number;
  usualWakeHour: number;
  naturalAt: number;
  recoveryHours?: number;
  settlingPressure?: number;
  settlingMinutes?: number;
  circadianVariation?: number;
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
  config?: Overrides;
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
    activity: texts.defaults.atHome,
    lastAction: null,
    room: (["bed", "desk", "computer", "alarm"] as const).map((kind) => ({
      id: kind,
      kind,
      x: furniture[kind].x,
      y: furniture[kind].y,
    })),
    mood: texts.defaults.neutralMood,
    interests: [firstInterest],
    attention: "",
  };
}
export function dayOf(time: number) {
  return new Date(time + numbers.defaults.shanghaiOffsetMs).toISOString().slice(0, 10);
}
export function hourOf(time: number) {
  return new Date(time + numbers.defaults.shanghaiOffsetMs).getUTCHours();
}
export const statusNames: Record<string, string> = {
  home: texts.defaults.atHome,
  read: "在看电脑",
  draw: "在画画",
  room: "在整理房间",
  sleep: texts.defaults.asleepStatus,
};
export type PublicPost = {
  day: string;
  body: string;
  made: number;
  sources: { name: string; url: string }[];
};
export type Art = { id: string; title: string; made: number };
export type PublicHome = {
  config?: Overrides;
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
