import { one, stmt } from "../db";
import { readMedia, type ReadRequest } from "./media";
import { gameCatalog, gameKinds, type Game } from "./games";
import { unreadTitles } from "./reading-progress";

type Source = ReadRequest["source"];
type Title = {id:string; title:string};
type Feed = {checked:number; fetched:number; page:number; status:string; items:Title[]};
const hour = 3600000;

// This is a small public display. Fetching its labels never enters the resident's
// history, model usage, reading bookmarks or public stream of activities.
async function displayTitles(source:Source, now:number) {
  const key="discovery/"+source;
  const saved=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?",key);
  let feed:Feed=saved ? JSON.parse(saved.value) : {checked:0,fetched:0,page:0,status:"",items:[]};
  const ttl=feed.status==="ok" ? 4*hour : hour/3;
  if (!saved || now<feed.checked || now-feed.checked>=ttl) {
    const page=feed.page >= 10 || feed.status==="no_results" ? 1 : feed.page+1;
    const result=await readMedia({source,action:"browse",page},{
      request:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(4500)}),
    });
    if(result.status==="ok") {
      const items=result.items.filter(i=>i.title && i.id);
      feed={checked:now,fetched:now,page,status:"ok",items:items.map(({id,title})=>({id,title}))};
    } else feed={...feed,checked:now,status:result.status};
    await stmt("INSERT OR REPLACE INTO channel_state(id,value) VALUES(?,?)",key,JSON.stringify(feed)).run();
  }
  if (!feed.items.length || now<feed.fetched || now-feed.fetched>72*hour) return [];
  const [item]=await unreadTitles(source,feed.items);
  return item ? [{title:item.title,listedAt:feed.fetched,action:"read" as const,media:{source,action:"open",id:item.id} satisfies ReadRequest}] : [];
}

export async function discoveryDesk(now:number, saves:{id:string;kind:Game["kind"];result:string;paused:boolean}[]) {
  const displays=await Promise.all([displayTitles("bili",now),displayTitles("heybox",now)]);
  const games=gameKinds.map(game=>{
    const saved=saves.find(s=>s.kind===game && !s.result);
    return {title:gameCatalog[game].title,action:"play",play:{game,op:"start"},
      saved:saved?{game,id:saved.id,op:saved.paused?"resume":"look"}:undefined};
  });
  return {titles:displays.flat(),games};
}
