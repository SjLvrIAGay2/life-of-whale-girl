import { all, memory,one, stmt, type Memory } from "../db";
import { dayOf } from "../content/initial";
import { numberCN, promiseDue, type SourceLine } from "./friend-memory";

const trim=(v:unknown,n:number)=>typeof v==="string"?v.trim().slice(0,n):"";
export function nextAnniversary(month:number,day:number,now:number,includeToday=false) {
  if(month<1||month>12||day<1||day>31) return null;
  const year=Number(dayOf(now).slice(0,4));
  for(let y=year;y<=year+8;y++) {
    const date=String(y)+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const ms=Date.parse(date+"T09:00:00+08:00");
    if(Number.isFinite(ms) && dayOf(ms)===date && (ms>now || (includeToday && date===dayOf(now)))) return ms;
  }
  return null;
}
export function anniversaryIn(text:string,now:number) {
  const match=text.normalize("NFKC").match(/(?<![\d一二两三四五六七八九十])(?:\d{4}\s*(?:年|[-/])\s*)?([\d一二两三四五六七八九十]{1,3})\s*(?:月|[-/])\s*([\d一二两三四五六七八九十]{1,3})(?![\d一二两三四五六七八九十])(?:日|号)?/);
  if(!match) return null;
  const month=numberCN(match[1]),day=numberCN(match[2]);
  const due=nextAnniversary(month,day,now-1,true);
  return due===null?null:{due,details:JSON.stringify({month,day})};
}
export function sharedEntries(scope:string,now:number) {
  return all<Memory>(`SELECT * FROM memories WHERE scope=? AND hidden=0 AND kind IN ('episode','followup','occasion')
    AND resolved=0 AND (expires IS NULL OR expires>?) ORDER BY made DESC LIMIT 12`,scope,now);
}
export async function relationshipMood(scope:string,now:number) {
  const m=await one<Memory>("SELECT * FROM memories WHERE scope=? AND kind='relationship_mood' AND hidden=0 AND expires>? ORDER BY made DESC,rowid DESC LIMIT 1",scope,now);
  if(!m?.details || !m.expires) return undefined;
  const d=JSON.parse(m.details);
  return {label:m.body,cause:m.quote,strength:Math.round(d.strength*Math.max(0,Math.min(1,(m.expires-now)/(m.expires-m.made)))*100)/100};
}
export function sharedWrites(scope:string,raw:any,lines:SourceLine[],now:number,active:Memory[],out:SourceLine[]=[],past:{id:string;body:string;side:string}[]=[]) {
  const writes:D1PreparedStatement[]=[];
  const feeling=raw?.feeling, source=lines[Number(feeling?.source)-1],cause=trim(feeling?.quote,200),label=trim(feeling?.label,30);
  if(source && cause && source.body.includes(cause) && label && Number.isFinite(feeling.strength) && feeling.strength>=0 && feeling.strength<=1 &&
    Number.isFinite(feeling.hours) && feeling.hours>=0.1 && feeling.hours<=24)
    writes.push(memory({scope,kind:"relationship_mood",body:label,quote:cause,expires:now+feeling.hours*3600000,
      details:JSON.stringify({strength:feeling.strength}),evidence:JSON.stringify(["chat-in-"+source.id])},now).write);
  const entries=Array.isArray(raw?.shared)?raw.shared.slice(0,4):[];
  for(const item of entries) {
    const line=lines[Number(item?.source)-1], quote=trim(item?.quote,300), body=trim(item?.title,140);
    if(line?.side!=="in" || !quote || !line.body.includes(quote) || !body) continue;
    const kind=item.kind;
    if(!["episode","followup","occasion"].includes(kind)) continue;
    let due:number|null=null, details:string|null=null;
    const evidence=["chat-in-"+line.id];
    if(kind==="occasion") {
      const topic=/生日|纪念日|初次见面|第一次见面|初识/;
      let anniversary=anniversaryIn(quote,now);
      if(!anniversary || !topic.test(quote)) {
        const index=lines.indexOf(line);
        const adjacent=topic.test(quote)?lines[index+1]:lines[index-1];
        if(!adjacent || adjacent.side!=="in") continue;
        const dateText=topic.test(quote)?adjacent.body:quote;
        const topicText=topic.test(quote)?quote:adjacent.body;
        if(!topic.test(topicText) || !/^(?:是|在|就是)?[\d零一二两三四五六七八九十年月日号/\s.-]+[。！!～~呀哦啦]*$/.test(dateText.trim())) continue;
        anniversary=anniversaryIn(dateText,now);
        if(!anniversary) continue;
        evidence.push("chat-in-"+adjacent.id);
      }
      ({due,details}=anniversary);
    } else if(kind==="followup") {
      const when=trim(item.when,100);
      due=when && line.body.includes(when)?promiseDue(when,line.made,item.dueLocal):null;
      if(!due || due<=now) continue;
    } else {
      const agreed=trim(item.replyQuote,300), reply=out.find(m=>agreed && m.body.includes(agreed));
      for(const claim of Array.isArray(item.past)?item.past.slice(0,5):[]) {
        const previous=past[Number(claim?.source)-1],text=trim(claim?.quote,300);
        if(previous && text && previous.body.includes(text) && !evidence.includes(previous.id)) evidence.push(previous.id);
      }
      if(reply && !reply.peer?.startsWith("qq-")) evidence.push("chat-out-"+reply.id);
      if(reply?.peer?.startsWith("qq-")) writes.push(stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)",
        "episode-receipt/"+reply.id,JSON.stringify({id:kind+"-"+line.id,quote:agreed})));
      details=JSON.stringify({friend:quote,resident:reply && !reply.peer?.startsWith("qq-")?agreed:null});
    }
    const entry=memory({scope,kind,id:kind+"-"+line.id,body,topic:body,quote,due,details,
      expires:kind==="followup"?due!+3*86400000:null,evidence:JSON.stringify(evidence)},line.made);
    writes.push(entry.write);
  }
  for(const update of Array.isArray(raw?.closeTopics)?raw.closeTopics:[]) {
    const item=active.find(m=>m.id===update?.id && m.kind==="followup");
    const line=lines.find(l=>typeof update.quote==="string" && update.quote.trim() && l.body.includes(update.quote));
    if(item && line) writes.push(stmt("UPDATE memories SET resolved=1,closed_by=? WHERE id=? AND scope=?","chat-in-"+line.id,item.id,scope));
  }
  return writes;
}
