export function archivePage(home, params) {
  const type=params.get("archive"),day=params.get("day")||"",month=params.get("month")||"",query=(params.get("q")||"").trim().slice(0,90).toLocaleLowerCase(),
    series=params.get("series"), offset=Math.max(0,Number.parseInt(params.get("offset")||"0",10)||0);
  const work=series && (home.series??home.objects?.works??[]).find(w=>w.id===series);
  const steps=work?(home.history??[]).filter(s=>s.work===work.id):[];
  const artIds=new Set(steps.map(s=>s.art).filter(Boolean));
  const refs=new Set(steps.map(s=>s.evidence).filter(Boolean));
  const {history,series:allSeries,cursors,activityArchive,...published}=home;
  const activities=activityArchive??home.activities??[];
  if(type==="activities") return {...published,activities:activities.slice(offset,offset+24),more:activities.length>offset+24,
    posts:home.posts.slice(0,4),art:home.art.slice(0,6)};
  const target=params.get("activity");
  if(target && !published.activities?.some(a=>a.id===target)) {
    const item=activities.find(a=>a.id===target);
    if(item) published.activities=[...(published.activities??[]),item];
  }
  if(type!=="journal" && type!=="gallery") return {...published,posts:home.posts.slice(0,4),art:home.art.slice(0,6)};
  const rows=(type==="journal"?home.posts:home.art).filter(item=>{
    const d=item.day??new Date(item.made+28800000).toISOString().slice(0,10);
    if((day && day!==d) || (month && !d.startsWith(month))) return false;
    if(series && !(type==="gallery"?artIds.has(item.id):(item.evidence??[]).some(id=>refs.has(id)))) return false;
    return !query || [item.title,item.body,...(item.sources??[]).map(s=>s.name)].some(t=>t?.toLocaleLowerCase().includes(query));
  });
  return {...published,series:(allSeries??home.objects?.works??[]).map(w=>({id:w.id,title:w.title})),
    posts:type==="journal"?rows.slice(offset,offset+24):home.posts.slice(0,4),art:type==="gallery"?rows.slice(offset,offset+24):home.art.slice(0,6),more:rows.length>offset+24};
}
export function rss(home,origin) {
  const xml=v=>String(v).replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c]));
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>'+xml(home.name)+'</title><link>'+xml(origin)+'</link><description>鲸鱼娘的写下的动态</description>'+
    home.posts.slice(0,30).map(p=>{const link=xml(origin+"/journal/"+p.day);return '<item><title>'+xml(p.day)+'</title><description>'+xml(p.body)+'</description><link>'+link+'</link><guid>'+link+'</guid><pubDate>'+new Date(p.made).toUTCString()+'</pubDate></item>';}).join("")+'</channel></rss>';
}
export function publicSummary(home) {
  if(!home.objects) return home;
  const objects={...home.objects,works:home.objects.works.map(w=>({...w,steps:w.steps.slice(0,2)}))};
  return {...home,objects};
}
