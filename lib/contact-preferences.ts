import { numbers } from "../config/numbers.ts";
import { contactPreferencesErrors } from "../config/texts/errors.ts";
import { z } from "zod";
import { db, one, stmt } from "../db";
import { dayOf } from "../content/initial";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const date = z.string().regex(/^\d{4}-\d\d-\d\d$/).refine(s=>{
  const d=new Date(s+"T00:00:00Z"); return Number.isFinite(d.getTime()) && d.toISOString().startsWith(s);
});
const settings = z.object({
  quietStart: time.nullable(), quietEnd: time.nullable(), quietThrough: date.nullable(),
  quietHoursThrough:date.nullable(), reminderChannel:z.enum(["same","recent","web","qq"]),
  textStart:time.nullable(),textEnd:time.nullable(),
  purpose: z.enum(["all","commitments"]), channel: z.enum(["recent","web","qq"]),
  voice: z.enum(["auto","text","voice"]), register: z.string().trim().max(120),
});
export type ContactPreferences = z.infer<typeof settings>;
export const defaults:ContactPreferences = {quietStart:null,quietEnd:null,quietThrough:null,quietHoursThrough:null,
  purpose:"all",channel:"recent",reminderChannel:"same",voice:"auto",textStart:null,textEnd:null,register:""};
export async function contactPreferences(identity:string, now=Date.now()) {
  const row=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?","contact-prefs/"+identity);
  const prefs={...defaults,...(row ? settings.partial().parse(JSON.parse(row.value)) : {})};
  if (prefs.quietThrough && prefs.quietThrough<dayOf(now)) prefs.quietThrough=null;
  if(prefs.quietHoursThrough && prefs.quietHoursThrough<dayOf(now)) {prefs.quietStart=null;prefs.quietEnd=null;prefs.quietHoursThrough=null;}
  return prefs;
}
export async function setContactPreferences(identity:string, raw:unknown) {
  const change=settings.partial().extend({proactive:z.boolean().optional()}).strict().parse(raw);
  const {proactive,...partial}=change;
  const prefs={...await contactPreferences(identity),...partial};
  if (!!prefs.quietStart!==!!prefs.quietEnd || (prefs.quietStart && prefs.quietStart===prefs.quietEnd))
    throw Error(contactPreferencesErrors.quietHours);
  if(!!prefs.textStart!==!!prefs.textEnd || (prefs.textStart && prefs.textStart===prefs.textEnd))
    throw Error(contactPreferencesErrors.textHours);
  const writes=[];
  if (Object.keys(partial).length) writes.push(stmt("INSERT INTO channel_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=json_patch(channel_state.value,excluded.value)",
    "contact-prefs/"+identity,JSON.stringify(partial)));
  if (proactive!==undefined) writes.push(proactive ? stmt("DELETE FROM channel_state WHERE id=?","chat-quiet/"+identity)
    : stmt("INSERT OR REPLACE INTO channel_state VALUES(?,'1')","chat-quiet/"+identity));
  if(proactive!==undefined) writes.push(stmt("INSERT INTO reply_turns VALUES(?,?,?,?,?)",crypto.randomUUID(),
    "chat:"+identity,Date.now(),"contact_preference",JSON.stringify({reason:proactive?"已允许主动联系":"好友关闭了主动联系"})));
  if (!writes.length) throw Error(contactPreferencesErrors.noChange);
  await db().batch(writes);
  return Object.keys(partial).length ? {...prefs,proactive} : {proactive};
}
export function contactAllowed(prefs:ContactPreferences, now:number, due:boolean) {
  if (prefs.quietThrough && prefs.quietThrough>=dayOf(now)) return false;
  if (!due && prefs.purpose==="commitments") return false;
  return !inPeriod(prefs.quietStart,prefs.quietEnd,now);
}
function inPeriod(start:string|null,end:string|null,now:number) {
  if(!start || !end) return false;
  const clock=new Date(now+numbers.defaults.shanghaiOffsetMs).toISOString().slice(11,16);
  return start<end ? start<=clock && clock<end : clock>=start || clock<end;
}
export function voicePreference(prefs:ContactPreferences,now:number) {
  return inPeriod(prefs.textStart,prefs.textEnd,now)?"text":prefs.voice;
}
export function channelPreference(prefs:ContactPreferences,due:boolean) {
  return due && prefs.reminderChannel!=="same"?prefs.reminderChannel:prefs.channel;
}
export function qqPreferences(body:string) {
  const exact:Record<string,unknown>={"关闭主动聊天":{proactive:false},"开启主动聊天":{proactive:true},
    "只发文字":{voice:"text"},"优先语音":{voice:"voice"},"语音随意":{voice:"auto"},"恢复说话方式":{register:""},
    "只发约定提醒":{purpose:"commitments"},"允许闲聊":{purpose:"all"},
    "优先QQ联系":{channel:"qq"},"最近渠道联系":{channel:"recent"},
    "解除免打扰":{quietStart:null,quietEnd:null,quietThrough:null,quietHoursThrough:null},
    "提醒走QQ":{reminderChannel:"qq"},"提醒跟随闲聊":{reminderChannel:"same"},
    "清除文字时段":{textStart:null,textEnd:null}};
  const hours=body.match(/^免打扰\s+(\d\d:\d\d)\s*[-至]\s*(\d\d:\d\d)(?:\s+到\s*(\d{4}-\d\d-\d\d))?$/);
  const textOnly=body.match(/^纯文字\s+(\d\d:\d\d)\s*[-至]\s*(\d\d:\d\d)$/);
  const until=body.match(/^免打扰至\s*(\d{4}-\d\d-\d\d)$/);
  const register=body.match(/^说话方式\s+(.{1,120})$/);
  return exact[body] ?? (hours?{quietStart:hours[1],quietEnd:hours[2],quietHoursThrough:hours[3]??null}:until?{quietThrough:until[1]}:
    textOnly?{textStart:textOnly[1],textEnd:textOnly[2]}:register?{register:register[1]}:null);
}
