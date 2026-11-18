import { numbers } from "../config/numbers.ts";
import type { State } from "../content/initial";
import type { ChatLine } from "../db";

export function shanghaiDate(ms:number) {
  return new Date(ms+numbers.defaults.shanghaiOffsetMs).toISOString().slice(0,16);
}

export type SleepInterval = {made:number;until:number;wakeCause?:string|null};

export function messageTiming(
  line:Pick<ChatLine,"made"|"handled_at">, state:Pick<State,"mode"|"wokeAt">,
  now:number, receiptMode:string|undefined, sleeps:SleepInterval[],
) {
  const readAt=line.handled_at??now;
  const sleep=sleeps.find(interval=>interval.made<=line.made && line.made<interval.until);
  // A gateway receipt can race the clock committing an already due wake.
  const afterWake=state.mode==="awake" && state.wokeAt!==undefined && state.wokeAt<=line.made && line.made<=now;
  const receivedMode=sleep?"asleep":afterWake?"awake":receiptMode??"unknown";
  const receivedLocal=shanghaiDate(line.made),readLocal=shanghaiDate(readAt);
  let afterSleep:string|undefined;
  if (line.handled_at==null && receivedMode==="asleep" && (sleep ? sleep.until<=readAt : state.mode==="awake")) {
    const wake=sleep?.wakeCause==="natural_wake"?"自然醒来":sleep?.wakeCause==="alarm_wake"?"听到闹钟醒来":"醒来";
    const waking=sleep?`你在 ${shanghaiDate(sleep.until)} ${wake}。`:"你后来醒了。";
    afterSleep=`好友在 ${receivedLocal} 留言，当时你在睡觉。${waking}你在 ${readLocal} 才读到这条留言。它只反映好友来信当时的情况。`;
  }
  return {receivedAt:receivedLocal,readAt:readLocal,delayMinutes:Math.floor(Math.max(0,readAt-line.made)/60000),receivedMode,afterSleep};
}
