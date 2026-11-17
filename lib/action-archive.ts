import { all } from "../db";
import { experienceLabel, type Experience } from "../content/activity";
import { dayOf } from "../content/initial";

export async function browseActivityArchive(kind:"activity"|"dream", query:string, date:string|undefined, offset:number) {
  const start=date ? Date.parse(date+"T00:00:00+08:00") : 0;
  const end=date ? start+86400000 : Number.MAX_SAFE_INTEGER;
  const rows=kind==="dream" ?
    await all<{id:string;made:number;label:string;visibility:string}>(
      "SELECT id,made,body AS label,'hidden' AS visibility FROM memories WHERE scope='self' AND kind='dream' AND hidden=0 AND made>=? AND made<? AND instr(body,?)>0 ORDER BY made DESC,rowid DESC LIMIT 9 OFFSET ?",start,end,query,offset) :
    (await all<{id:string;made:number;detail:string;visibility:string}>(
      "SELECT id,made,visibility,detail FROM activities WHERE made>=? AND made<? AND instr(detail,?)>0 ORDER BY made DESC,rowid DESC LIMIT 9 OFFSET ?",start,end,query,offset))
      .map(({detail,...row})=>{
        const item:Experience=JSON.parse(detail).detail;
        return {...row,label:experienceLabel(item)+(item.kind==="reading" && item.items[0]?" · "+item.items[0].title:"")};
      });
  return {items:rows.slice(0,8).map(r=>({evidenceId:r.id,date:dayOf(r.made),description:r.label.slice(0,240),visibility:r.visibility})),
    nextOffset:rows.length>8?offset+8:undefined};
}
