import { numbers } from "../config/numbers";
import type { Overrides } from "../config/options";
import { one, stmt } from "../db";
import { readingSources, readMedia, type ReadRequest } from "./media";
import { gameCatalog, gameKinds, type Game } from "./games";
import { unreadTitles } from "./reading-progress";

type Source = ReadRequest["source"];
type Title = {id:string; title:string};
type Feed = {checked:number; fetched:number; page:number; status:string; items:Title[]; skipped?:string[]; atEnd?:boolean; choices?:number};
export type DeskTitle = {title:string; listedAt:number; action:"read"; media:{source:Source; action:"open"; id:string}};
const hour = 3600000;

function feedPageSize(source:Source, n:typeof numbers.defaults) {
  // Heybox may return ten posts for a larger request. Use its native window to keep offsets aligned.
  return source==="bili" ? n.biliListCount : Math.min(n.heyFeedCount,numbers.defaults.heyFeedCount);
}

async function availableTitles(source:Source, feed:Feed) {
  const excluded = new Set(feed.skipped);
  const candidates = feed.items.filter(item => {
    if (excluded.has(item.id)) return false;
    excluded.add(item.id);
    return true;
  });
  return candidates.length ? unreadTitles(source, candidates) : [];
}

function pickTitles(items:Title[], interests:string[], count:number) {
  const normalize = (text:string) => text.normalize("NFKC").toLowerCase();
  const terms = interests.flatMap(topic => normalize(topic).match(/[\p{L}\p{N}]+/gu) ?? []);
  const matches:Title[] = [], others:Title[] = [];
  for (const item of items) {
    const title = normalize(item.title);
    if (terms.some(term => title.includes(term))) matches.push(item);
    else others.push(item);
  }
  const preferred = matches.splice(0, Math.ceil(count/2));
  return [...preferred, ...others, ...matches].slice(0, count);
}

// This is a small public display. Fetching its labels never enters the resident's
// history, model usage, reading bookmarks or public stream of activities.
async function displayTitles(source:Source, now:number, n:typeof numbers.defaults, interests:string[], overrides?:Overrides):Promise<DeskTitle[]> {
  const key="discovery/"+source;
  const saved=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?",key);
  let feed:Feed=saved ? JSON.parse(saved.value) : {checked:0,fetched:0,page:0,status:"",items:[]};
  let available = await availableTitles(source, feed);
  const pageSize=feedPageSize(source,n);
  const loaded=["ok","no_unread"].includes(feed.status);
  const ttl=loaded ? n.discoveryHours*hour : n.discoveryRetryMinutes*60000;
  const due=!saved || now<feed.checked || now-feed.checked>=ttl;
  const wider=loaded && available.length<n.discoveryChoices && n.discoveryChoices>(feed.choices??pageSize);
  if (due || wider || (feed.status==="ok" && !available.length)) {
    const pageOverrides=source==="heybox" && pageSize!==n.heyFeedCount ? {...overrides,"numbers.heyFeedCount":pageSize} : overrides;
    const signal=AbortSignal.timeout(4500);
    const request:typeof fetch=(url,options)=>fetch(url,{...options,signal});
    const retryPartial=!loaded && available.length<n.discoveryChoices && now>=feed.fetched && now-feed.fetched<n.discoveryHours*hour;
    let batch:Title[]=(!due && wider) || retryPartial ? available : [];
    const listedAt=batch.length ? feed.fetched : now;
    const pagesNeeded=Math.ceil((n.discoveryChoices-batch.length)/pageSize);
    const pageLimit=n.discoveryChoices>pageSize ? n.discoveryPages : 1;
    let page=feed.page>=n.discoveryPages || feed.atEnd || feed.status==="no_results" ? 1 : feed.page+1;
    for (let attempt=1; attempt<=pageLimit; attempt++) {
      const result=await readMedia({source,action:"browse",page},{overrides:pageOverrides,request});
      if (result.status!=="ok") {
        if (attempt>1 && result.status==="no_results") feed.atEnd=true;
        else feed.status=result.status;
        break;
      }
      const before=batch.length;
      const items=result.items.filter(i=>i.title && i.id).map(({id,title})=>({id,title}));
      batch=await availableTitles(source,{...feed,items:[...batch,...items]});
      available=batch;
      feed={...feed,fetched:listedAt,page,atEnd:result.atEnd,status:batch.length?"ok":"no_unread",items:batch};
      if (batch.length>=n.discoveryChoices || result.atEnd || (attempt>=pagesNeeded && batch.length===before)) break;
      page=page>=n.discoveryPages ? 1 : page+1;
    }
    feed.checked=now;
    feed.choices=n.discoveryChoices;
    await stmt("INSERT OR REPLACE INTO channel_state(id,value) VALUES(?,?)",key,JSON.stringify(feed)).run();
  }
  if (!feed.items.length || now<feed.fetched || now-feed.fetched>n.discoveryMaxAgeHours*hour) return [];
  return pickTitles(available, interests, n.discoveryChoices).map(item => ({
    title:item.title, listedAt:feed.fetched, action:"read", media:{source,action:"open",id:item.id},
  }));
}

export async function changeTitles(target:{source:Source;id?:string}, shown:DeskTitle[], writes:D1PreparedStatement[], overrides?:Overrides) {
  const key="discovery/"+target.source;
  const saved=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?",key);
  if (!saved) return false;
  const feed:Feed=JSON.parse(saved.value);
  const selected=shown.filter(({media})=>media.source===target.source && (target.id===undefined || media.id===target.id));
  if (!selected.length && (target.id!==undefined || feed.status!=="no_unread")) return false;
  const n=numbers.read(overrides);
  const pageSize=feedPageSize(target.source,n);
  const historySize=Math.max(feed.items.length,n.discoveryPages*pageSize);
  feed.skipped=[...new Set([...(feed.skipped??[]),...selected.map(({media})=>media.id)])].slice(-historySize);
  // A whole-batch change can keep the unused tail of a page and fill the rest from the next pages.
  if (target.id===undefined && n.discoveryChoices>pageSize) feed.choices=0;
  if (feed.status==="no_unread") feed.status="ok";
  writes.push(stmt("UPDATE channel_state SET value=? WHERE id=?",JSON.stringify(feed),key));
  return true;
}

export async function discoveryDesk(now:number, saves:{id:string;kind:Game["kind"];result:string;paused:boolean}[], overrides?: Overrides, interests:string[] = []) {
  const n=numbers.read(overrides);
  const displays=await Promise.all(readingSources.map(source=>displayTitles(source,now,n,interests,overrides)));
  const titles:DeskTitle[]=[];
  for (let index=0; index<n.discoveryChoices; index++) {
    for (const source of displays) if (source[index]) titles.push(source[index]);
  }
  const games=gameKinds.map(game=>{
    const saved=saves.find(s=>s.kind===game && !s.result);
    return {title:gameCatalog[game].title,action:"play",play:{game,op:"start"},
      saved:saved?{game,id:saved.id,op:saved.paused?"resume":"look"}:undefined};
  });
  return {titles,change:readingSources.map(source=>({action:"change_titles",target:{source}})),games};
}
