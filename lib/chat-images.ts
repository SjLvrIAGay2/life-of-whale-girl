import { all, stmt, type ChatLine } from "../db";
import { downloadQQ, type QQAudio } from "./qq-voice";

export const maxImageBytes=6*1024*1024;
export const maxImages=4;
export type ChatImage={mime:string;bytes:Uint8Array};
export function imageBytes(bytes:Uint8Array):ChatImage {
  if (!bytes.length || bytes.length>maxImageBytes) throw Error("每张图片最多 6 MiB");
  const b=Buffer.from(bytes);
  let mime="";
  if (b.length>=24 && b.toString("hex",0,8)==="89504e470d0a1a0a" && b.toString("ascii",12,16)==="IHDR") mime="image/png";
  else if (b[0]===255 && b[1]===216 && b[2]===255) mime="image/jpeg";
  else if (b.toString("ascii",0,4)==="RIFF" && b.toString("ascii",8,12)==="WEBP") mime="image/webp";
  else if (/^GIF8[79]a$/.test(b.toString("ascii",0,6))) mime="image/gif";
  if (!mime) throw Error("支持 PNG、JPEG、WebP 和 GIF 图片");
  return {mime,bytes};
}
export function isQQImage(a:QQAudio) {
  return !!a && (/^image(?:\/|$)/i.test(a.content_type??"") || /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(a.filename??""));
}
export async function qqImages(input:QQAudio[]|undefined, count=maxImages) {
  if (!Array.isArray(input)) return [];
  const images=await Promise.all(input.filter(isQQImage).slice(0,count).map(async (a,part)=>{
    try { if(a.url) return {...imageBytes(await downloadQQ(a.url,maxImageBytes)),part}; } catch { /* Keep the placeholder. */ }
  }));
  return images.filter(image=>image!==undefined);
}
export function imageWrites(message:string,images:(ChatImage & {part?:number})[],quoted=false,afterInsert=false) {
  return images.map((img,i)=>stmt("INSERT OR IGNORE INTO chat_images(id,message,part,quoted,mime,bytes) SELECT ?,?,?,?,?,?"+
    (afterInsert?" WHERE changes()>0":""),
    crypto.randomUUID(),message,img.part??i,Number(quoted),img.mime,img.bytes));
}
export async function turnImages(lines:ChatLine[]) {
  if (!lines.length) return [];
  const keys=lines.map((l,i)=>({id:l.id,peer:l.peer,ref:l.quoted_ref,n:i+1}));
  const rows=await all<{n:number;quoted:number;part:number;mime:string;bytes:Uint8Array}>(`WITH inputs AS (
    SELECT value->>'id' AS id,value->>'peer' AS peer,value->>'ref' AS ref,value->>'n' AS n FROM json_each(?)
  ), available AS (
    SELECT k.n,a.quoted,a.part,a.mime,a.bytes FROM inputs k JOIN messages m ON m.id=k.id AND m.peer=k.peer AND m.withheld=0
    JOIN chat_images a ON a.message=m.id WHERE a.quoted=0 OR NOT EXISTS(SELECT 1 FROM messages q WHERE q.peer=k.peer AND (q.qq_index=k.ref OR q.id='qq:'||k.ref) AND q.withheld=1)
    UNION ALL SELECT k.n,1,a.part,a.mime,a.bytes FROM inputs k JOIN messages q ON q.peer=k.peer AND q.withheld=0
      AND (q.qq_index=k.ref OR q.id='qq:'||k.ref) JOIN chat_images a ON a.message=q.id AND a.quoted=0
      WHERE NOT EXISTS(SELECT 1 FROM chat_images own WHERE own.message=k.id AND own.quoted=1)
  ) SELECT * FROM available ORDER BY n,quoted DESC,part LIMIT 6`,JSON.stringify(keys));
  let remaining=12*1024*1024;
  return rows.filter(r=>{
    if(r.bytes.length>remaining) return false;
    remaining-=r.bytes.length;
    return true;
  }).map(r=>({message:r.n,quoted:!!r.quoted,position:r.part+1,url:"data:"+r.mime+";base64,"+Buffer.from(r.bytes).toString("base64")}));
}
