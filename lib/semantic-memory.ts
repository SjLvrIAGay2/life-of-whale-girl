import { numbers } from "../config/numbers.ts";
import { env } from "cloudflare:workers";
import { all, db, currentOverrides, stmt, type Memory } from "../db";

let indexing: Promise<number> | undefined;
export function indexMemories() {
  if (indexing) return indexing;
  indexing = indexBatch().finally(() => { indexing = undefined; });
  return indexing;
}
async function indexBatch() {
  const encoder = env.WHALE_MEMORY_EMBED;
  if (!encoder) return 0;
  const n=numbers.read(await currentOverrides());
  const rows = await all<{id:string;body:string}>(`SELECT m.id,m.body FROM memories m
    LEFT JOIN memory_vectors v ON v.id=m.id AND v.model=?
    WHERE v.id IS NULL AND m.hidden=0 AND m.kind NOT IN ('access','working','profile','habit_sample','source_quote') ORDER BY m.rowid LIMIT ?`, encoder.model,n.indexRecords);
  if (!rows.length) return 0;
  const vectors:Float32Array[]=[];
  for(let i=0;i<rows.length;i+=n.embeddingBatch)
    vectors.push(...await encoder.encode(rows.slice(i,i+n.embeddingBatch).map(row=>row.body.slice(0,n.indexedChars))));
  await db().batch(rows.map((row,i) => stmt(
    "INSERT OR REPLACE INTO memory_vectors SELECT id,?,? FROM memories WHERE hidden=0 AND id=? AND body=?",
    encoder.model, new Uint8Array(vectors[i].buffer,vectors[i].byteOffset,vectors[i].byteLength), row.id, row.body,
  )));
  return rows.length;
}
export async function semanticHits(scopes: string[], cue: string, excludeIds: string[] = []) {
  const encoder = env.WHALE_MEMORY_EMBED;
  if (!encoder || !cue.trim() || !scopes.length) return [];
  const n=numbers.read(await currentOverrides());
  const [query] = await encoder.encode([cue.slice(0,n.queryChars)],true);
  const candidates: {id:string;score:number}[] = [];
  const scopeSQL = scopes.map(() => "?").join(",");
  const excluded = new Set(excludeIds);
  let cursor = 0;
  for (;;) {
    const rows = await all<{cursor:number;id:string;vector:Uint8Array}>(`SELECT m.rowid AS cursor,m.id,v.vector
      FROM memories m JOIN memory_vectors v ON v.id=m.id WHERE m.rowid>? AND v.model=?
      AND m.scope IN (${scopeSQL}) AND m.hidden=0 AND m.kind NOT IN ('profile','habit_sample') AND (m.kind<>'promise' OR m.resolved=0)
      ORDER BY m.rowid LIMIT 160`, cursor, encoder.model,...scopes);
    for (const row of rows) {
      if (excluded.has(row.id)) continue;
      const bytes = Uint8Array.from(row.vector);
      if (bytes.length !== query.byteLength) continue;
      const values = new Float32Array(bytes.buffer);
      let score = 0;
      for (let i=0;i<values.length;i++) score += query[i] * values[i];
      candidates.push({id:row.id,score});
    }
    candidates.sort((a,b)=>b.score-a.score);
    candidates.splice(n.memoryCount);
    if (rows.length < 160) break;
    cursor = rows[rows.length-1].cursor;
  }
  if (!candidates.length) return [];
  const memories = await all<Memory>("SELECT * FROM memories WHERE id IN ("+
    candidates.map(()=>"?").join(",")+") AND scope IN ("+scopeSQL+")", ...candidates.map(c=>c.id), ...scopes);
  const byId = new Map(memories.map(m=>[m.id,m]));
  return candidates.flatMap(c => { const m=byId.get(c.id); return m ? [{memory:m,score:c.score}] : []; });
}
