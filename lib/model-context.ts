// Keep JSON and evidence records intact. This is a character budget for the existing transports.
type Json = null | boolean | number | string | Json[] | { [key:string]:Json };
type Fields = { [key:string]:Json };
const object = (v:Json|undefined): v is Fields => !!v && typeof v==="object" && !Array.isArray(v);
const essential = ["lastAction","cabin","state","question","desk","sleep","time","room","availableFurniture","readingProgress","works","archive","duePlans","dayPlans","self",
  "unread","id","status","ref","work","nextCursor","nextPage"];

// Used for unusually large tool documents as well as non-activity inputs. An array element
// (a memory, a work, a scene, etc.) is copied whole or omitted. A scalar never becomes a false quotation.
function fitValue(value:Json, budget:number):Json|undefined {
  if (JSON.stringify(value).length<=budget) return value;
  if (budget<2) return;
  if (Array.isArray(value)) {
    const items:Json[]=[];
    let used=2;
    for (const item of value) {
      const cost=JSON.stringify(item).length+(items.length?1:0);
      if (used+cost<=budget) {items.push(item);used+=cost;}
    }
    return items;
  }
  if (!object(value)) return;
  const kept:Fields={};
  let remaining=budget-2;
  const keys=Object.keys(value);
  const ordered=[...essential.filter(k=>Object.hasOwn(value,k)),...keys.filter(k=>!essential.includes(k))];
  for (const [index,k] of ordered.entries()) {
    const overhead=JSON.stringify(k).length+1+(Object.keys(kept).length?1:0);
    // Reserve space for later fields when an earlier field alone would exhaust the budget.
    const room=remaining-overhead;
    if (room<1) continue;
    const full=JSON.stringify(value[k]).length;
    const allowance=full<=room/2 || index===ordered.length-1 ? room : Math.floor(room/2);
    const field=fitValue(value[k],allowance);
    if (field===undefined) continue;
    kept[k]=field;
    remaining-=overhead+JSON.stringify(field).length;
  }
  return kept;
}

export function modelContext(data:unknown, limit:number):string {
  // Conversation has its own fitter that preserves the entire incoming turn, including images.
  if (typeof data==="string") return data;
  const original=JSON.stringify(data)??"null";
  if (original.length<=limit) return original;
  const value:Json=JSON.parse(original);
  if (!object(value)) return JSON.stringify(fitValue(value,limit)??null);

  const omitted:Fields={};
  value.omittedRecords=omitted;
  const leisure=object(value.leisure)?value.leisure:{};
  const lists:[string,Json|undefined][]=[
    ["memories",value.memories],["context",value.context],["references",value.references],
    ["recent",leisure.recent],["preferences",value.preferences],["reading",leisure.reading],
    ["records",value.records],["events",value.events],["samples",value.samples],
  ];
  for (const [key,list] of lists) {
    if (!Array.isArray(list) || !list.length) continue;
    let excess=JSON.stringify(value).length-limit;
    if (excess<=0) break;
    let removed=0;
    while (excess>0 && list.length) {
      const item=list.pop()!;
      excess-=JSON.stringify(item).length+(list.length?1:0);
      if (!removed) excess+=JSON.stringify(key).length+12;
      removed++;
    }
    omitted[key]=removed;
  }
  const reduced=JSON.stringify(value);
  if (reduced.length<=limit) return reduced;

  // Seed the envelope with all essential activity fields before budgeting variable-size material.
  const core:Fields={omittedRecords:omitted,contextLimited:true};
  for (const k of essential) if (Object.hasOwn(value,k)) core[k]=value[k];
  if (JSON.stringify(core).length>limit) return JSON.stringify(fitValue(core,limit));
  for (const [k,v] of Object.entries(value)) {
    if (Object.hasOwn(core,k)) continue;
    const budget=limit-JSON.stringify(core).length-JSON.stringify(k).length-2;
    if (budget<1) continue;
    const selected=fitValue(v,budget);
    if (selected!==undefined) core[k]=selected;
  }
  return JSON.stringify(core);
}
