import { sleepErrors } from "../config/texts/errors.ts";
import { texts } from "../config/texts.ts";
import { numbers } from "../config/numbers";
import { all } from "../db";
import { dayOf, furniture, type SleepSession, type State } from "../content/initial";
import { shanghaiDate } from "./friend-memory";

const minute = 60000;
const hour = 60 * minute;
const day = 24 * hour;
export const maxSleep = numbers.defaults.sleepHours * hour;
type Interval = { made: number; until: number };

function localHour(at: number) {
  return ((at + numbers.defaults.shanghaiOffsetMs) % day) / hour;
}

function awakePressure(initial: number, elapsed: number, n: typeof numbers.defaults) {
  return Math.min(n.maxWakingPressure, initial + n.wakingPressurePerHour * Math.max(0, elapsed) / hour);
}
function asleepPressure(initial: number, elapsed: number, recovery: number, recoveryHours = numbers.defaults.recoveryHours) {
  return initial * Math.exp(-recovery * Math.max(0, elapsed) / (recoveryHours * hour));
}

async function recentSleep(state: State, now: number, includeCurrent=false) {
  const rows = await all<Interval>(`SELECT made,until FROM activities WHERE made<? AND until>? AND until<=?
    AND json_extract(detail,'$.detail.kind')='sleep' ORDER BY made`, now, now-2*day, now);
  if (state.mode === "awake" && state.sleepAt > 0 && state.wakeAt > state.sleepAt && state.wakeAt <= now &&
      state.wakeAt > now - 2*day && !rows.some(row => row.made === state.sleepAt)) {
    rows.push({made:state.sleepAt,until:state.wakeAt});
  }
  if(includeCurrent && state.mode==="asleep" && state.sleepAt>0 && state.sleepAt<now)
    rows.push({made:state.sleepAt,until:now});
  const merged: Interval[] = [];
  for (const row of rows.sort((a,b)=>a.made-b.made)) {
    if (row.until <= row.made) continue;
    const previous = merged.at(-1);
    if (previous && previous.until > row.made) previous.until = Math.max(previous.until,row.until);
    else merged.push(row);
  }
  return merged;
}

function currentPressure(state: State, now: number, history: Interval[]) {
  const n=numbers.read(state.config);
  if (state.body) {
    const elapsed = now-state.body.at;
    return state.mode === "asleep" ? asleepPressure(state.body.pressure,elapsed,state.sleepSession?.recovery??1,state.sleepSession?.recoveryHours) :
      awakePressure(state.body.pressure,elapsed,n);
  }
  if (!history.length) return awakePressure(n.initialSleepPressure, now-(state.wokeAt??now),n);
  let pressure=0.98, since=history[0].made;
  for (const sleep of history) {
    pressure=asleepPressure(awakePressure(pressure,sleep.made-since,n),sleep.until-sleep.made,1);
    since=sleep.until;
  }
  return awakePressure(pressure, now-since,n);
}

// Only natural, uninterrupted main sleeps teach the clock. Scheduled or anomalous legacy intervals
// still count towards physical recovery in recentSleep.
async function usualWakeHour(now: number, n: typeof numbers.defaults) {
  const wakes = await all<{made:number}>(`SELECT made FROM memories WHERE kind='event' AND category='natural_wake'
    AND scope IN ('self','public') AND hidden=0 AND made BETWEEN ? AND ? AND json_extract(details,'$.learn')=1
    ORDER BY made DESC LIMIT ?`,now-n.wakeHistoryDays*day,now,n.wakeHistoryCount);
  const angle=(h:number)=>h*2*Math.PI/24;
  let x=Math.cos(angle(n.wakePriorHour)), y=Math.sin(angle(n.wakePriorHour));
  for (const wake of wakes) {
    x+=Math.cos(angle(localHour(wake.made)));
    y+=Math.sin(angle(localHour(wake.made)));
  }
  return (Math.atan2(y,x)*24/(2*Math.PI)+24)%24;
}

export function naturalWakeTime(at: number, pressure: number, session: SleepSession) {
  // Drowsiness while settling fades quickly even for a short daytime nap.
  for (let when=at+minute; when<session.deadline; when+=minute) {
    const elapsed=when-at;
    const settling=(session.settlingPressure??numbers.defaults.settlingPressure)*Math.exp(-elapsed/((session.settlingMinutes??numbers.defaults.settlingMinutes)*minute));
    const threshold=session.threshold+(session.circadianVariation??numbers.defaults.circadianVariation)*Math.cos((localHour(when)-session.usualWakeHour)*2*Math.PI/24);
    if (asleepPressure(pressure,elapsed,session.recovery,session.recoveryHours)+settling<=threshold) return when;
  }
  return session.deadline;
}

export async function beginSleep(state: State, at: number, visibility: SleepSession["visibility"], legacy=false) {
  const n=numbers.read(state.config);
  const pressure=currentPressure(state,at,state.body?[]:await recentSleep(state,at));
  // A snooze continues the original episode. Spending a waking day in bed can also build a new sleep need.
  let session=state.inBed ? state.sleepSession : undefined;
  if (session && state.body && state.mode==="awake" && n.wakingPressurePerHour*(at-state.body.at)/hour>=0.25) session=undefined;
  if (session && at>=session.deadline) return false;
  if (!session) {
    session={started:at,deadline:at+n.sleepHours*hour,threshold:n.sleepThreshold+(Math.random()+Math.random()-1)*n.sleepVariation,
      recoveryHours:n.recoveryHours,settlingPressure:n.settlingPressure,settlingMinutes:n.settlingMinutes,circadianVariation:n.circadianVariation,
      recovery:n.recoveryBase+Math.random()*n.recoveryVariation,usualWakeHour:await usualWakeHour(at,n),naturalAt:0,learn:!legacy,visibility};
  } else {
    session.learn=false;
    session.onsetUnknown=undefined;
    session.recovery=Math.max(0.8,session.recovery*0.97);
    session.visibility=visibility;
  }
  session.naturalAt=naturalWakeTime(at,pressure,session);
  state.body={at,pressure};
  state.sleepSession=session;
  state.sleepAt=at;
  state.wakeAt=session.naturalAt;
  state.nextAt=state.wakeAt;
  state.mode="asleep";
  state.inBed=true;
  state.bedVisibility=visibility;
  return true;
}

export function wakeBody(state: State, at: number) {
  const session=state.sleepSession!;
  state.body={at,pressure:asleepPressure(state.body!.pressure,at-state.body!.at,session.recovery,session.recoveryHours)};
  state.wakeAt=at;
  state.wokeAt=at;
  state.mode="awake";
  state.inBed=true;
  state.bedVisibility=session.visibility;
  state.bedtimeMood=state.mood;
  const copy=texts.read(state.config);
  state.mood=moodAfterSleep(state.mood,copy.neutralMood);
  if (state.feeling && state.mood!==state.bedtimeMood)
    state.feeling=state.mood===copy.neutralMood?undefined:{...state.feeling,label:state.mood};
  state.activity=copy.inBed;
}

export function isClockUpgrade(state: State) {
  return state.sleepVersion!==1 || (state.mode==="asleep" && (!state.sleepSession || !state.body));
}

export async function upgradeSleep(state: State, now: number, visibility: SleepSession["visibility"], activityStart?:number) {
  if (state.sleepVersion!==1 && !state.room.some(o=>o.kind==="alarm") && state.room.length<18) {
    const {x,y}=furniture.alarm;
    state.room.push({id:"alarm",kind:"alarm",x,y});
  }
  state.sleepVersion=1;
  if (state.mode==="asleep" && (!state.sleepSession || !state.body)) {
    const start=state.sleepAt>0 && state.sleepAt<=now ? state.sleepAt : activityStart;
    await beginSleep(state,start??now,visibility,true);
    if (start===undefined) {
      // No witnessed onset survives. Resume awake at this observation without inventing a night of sleep.
      state.wakeAt=state.nextAt=state.sleepSession!.naturalAt=now;
      state.sleepSession!.onsetUnknown=true;
    }
    return true;
  }
  return false;
}

export function nextBell(state: State) {
  return Math.min(Infinity,...Object.values(state.alarms??{}));
}

export type AlarmCommand = {op:"set"|"off"|"snooze"; id?:string; time?:string; minutes?:number};
export function setAlarm(state: State, command: AlarmCommand, now: number) {
  const clocks=state.room.filter(o=>o.kind==="alarm");
  const id=command.id ?? (clocks.find(o=>o.id===state.lastBell?.id)??clocks[0])?.id;
  if (!id || !clocks.some(o=>o.id===id)) throw Error(sleepErrors.missingAlarm);
  state.alarms??={};
  if (command.op==="off") {
    delete state.alarms[id];
    return "关掉了闹钟。";
  }
  let due:number;
  if (command.minutes!==undefined) due=now+command.minutes*minute;
  else if (command.op==="snooze") due=now+numbers.read(state.config).snoozeMinutes*minute;
  else {
    const value=command.time??"";
    const timeOnly=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    const stamp=timeOnly ? dayOf(now)+"T"+value : value.replace(" ","T");
    due=Date.parse(stamp+":00+08:00");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(stamp) || !Number.isFinite(due) || shanghaiDate(due)!==stamp)
      throw Error(sleepErrors.localTime);
    if (timeOnly && due<=now) due+=day;
  }
  if (!Number.isSafeInteger(due) || due<=now || !Number.isFinite(new Date(due).getTime())) throw Error(sleepErrors.futureTime);
  state.alarms[id]=due;
  return "闹钟定在了上海时间 "+shanghaiDate(due).replace("T"," ")+"。";
}

export async function sleepContext(state: State, now: number, scope?: string) {
  const rows=await recentSleep(state,now,true);
  const last=rows.filter(r=>state.mode!=="asleep" || r.until<=state.sleepAt).at(-1);
  const slept=rows.reduce((sum,r)=>sum+Math.max(0,r.until-Math.max(now-day,r.made)),0);
  const pressure=currentPressure(state,now,rows);
  const bell=state.lastBell;
  const interactions=state.sleepSession ? await all<{made:number;reaction:string}>(`SELECT made,json_extract(details,'$.sleepInteraction.choice') AS reaction
    FROM reply_turns WHERE status IN ('queued','silent') AND made<=?
    AND json_extract(details,'$.sleepInteraction.sessionStarted')=? AND (? IS NULL OR scope=?) ORDER BY made DESC,rowid DESC LIMIT 4`,
    now,state.sleepSession.started,scope??null,scope??null) : [];
  return {
    localTime:shanghaiDate(now), timezone:texts.defaults.timezone,mode:state.mode,
    feeling:pressure>1.12?"眼皮很沉":pressure>0.85?"有些犯困":pressure>0.55?"还算精神":"感觉休息得不错",
    inBed:!!state.inBed, lastSleep:last?{from:shanghaiDate(last.made),to:shanghaiDate(last.until),minutes:Math.round((last.until-last.made)/minute)}:null,
    currentSleep:state.mode==="asleep" ? {from:shanghaiDate(state.sleepAt),minutes:Math.floor(Math.max(0,now-state.sleepAt)/minute)} : undefined,
    awakeMinutes:state.mode==="asleep"?0:state.wokeAt===undefined?null:Math.floor(Math.max(0,now-state.wokeAt)/minute),
    sleptMinutes24h:Math.round(slept/minute),
    recentInteractions:interactions.map(i=>({time:shanghaiDate(i.made),reaction:i.reaction})),
    bell:bell && now-bell.at<day ? {time:shanghaiDate(bell.at),heard:bell.heard,id:bell.id}:undefined,
  };
}

export function moodAfterSleep(label: string, neutral = texts.defaults.neutralMood) {
  const fatigue = /困倦|困意|犯困|很困|好困|想睡|疲[惫倦劳乏]|乏力|有点累|累了|好累|眼.{0,3}涩|睁不开眼|没睡够|^[困累乏]$/;
  if (!fatigue.test(label)) return label;
  return label.split(/但是|不过|但|却|[，,、；;]/).map(part => part.trim())
    .filter(part => part && !fatigue.test(part)).join("，") || neutral;
}
