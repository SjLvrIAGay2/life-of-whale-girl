import { DatabaseSync, backup } from "node:sqlite";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export function inventory(db) {
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
  const counts={};
  for(const name of ["messages","memories","drawings","works","work_steps","chat_images","memory_rules","art_jobs","activities","play_saves","site_editions"])
    counts[name]=tables.has(name)?db.prepare("SELECT count(*) n FROM "+name).get().n:0;
  counts.friends=tables.has("channel_state")?db.prepare(`SELECT count(*) n FROM (
    SELECT CASE WHEN value LIKE 'web-%' THEN value ELSE substr(id,8) END AS identity FROM channel_state WHERE id LIKE 'friend/qq-%'
    UNION SELECT substr(id,14) FROM channel_state WHERE id LIKE 'chat-contact/%'
    UNION SELECT value FROM channel_state WHERE id='owner-peer'
    UNION SELECT DISTINCT peer FROM messages WHERE side='in' AND peer LIKE 'web-%')`).get().n:0;
  return counts;
}

export function openResident(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const recovery = join(dirname(dirname(file)), "recovery");
  if (!existsSync(file) && existsSync(recovery) && readdirSync(recovery).some(n => n.endsWith(".sqlite")))
    throw Error("Resident database missing while recovery copies exist");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000");
  // Committed state lives in the main file, including after an abrupt exit.
  const mode = db.prepare("PRAGMA journal_mode=DELETE").get().journal_mode;
  if (mode !== "delete") throw Error("Could not switch resident database to rollback journaling");
  db.exec("PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
  // The most recent verified snapshot establishes a durable revision floor.
  const saved = existsSync(recovery) && readdirSync(recovery).filter(n => n.startsWith("resident-auto-") && n.endsWith(".sqlite")).sort().at(-1);
  if (saved) {
    const floor = Number(saved.match(/-r(\d+)\.sqlite$/)?.[1]);
    const revision = db.prepare("SELECT revision FROM resident LIMIT 1").get()?.revision;
    if (!Number.isSafeInteger(revision) || revision < floor) {
      db.close();
      throw Error("Database older than a verified recovery snapshot: " + saved);
    }
  }
  return db;
}

export function residentBackups(db, file) {
  const dir = join(dirname(dirname(file)), "recovery");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const original = statSync(file, { bigint: true });
  const prefix = "resident-auto-";
  let pending, lastRevision = -1, lastAt = 0;
  function prune() {
    const names = readdirSync(dir).filter(n => /^resident-auto-\d{4}-\d\d-\d\dT[\d-]+Z-r\d+\.sqlite$/.test(n)).sort().reverse();
    const days = new Set();
    for (const [i, name] of names.entries()) {
      const day = name.slice(prefix.length, prefix.length + 10);
      const daily = !days.has(day) && days.size < 7;
      days.add(day);
      if (i >= 12 && !daily) rmSync(join(dir, name));
    }
  }
  async function snapshot(force=false) {
    const revision = db.prepare("SELECT revision FROM resident LIMIT 1").get()?.revision;
    if (revision === undefined) return;
    const current = statSync(file, { bigint: true, throwIfNoEntry: false });
    const detached = !current || current.ino !== original.ino || current.dev !== original.dev;
    if (!force && !detached && revision === lastRevision && Date.now() - lastAt < 15 * 60000) return {revision:lastRevision,time:lastAt};
    const temp = join(dir, ".snapshot-" + randomUUID() + ".tmp");
    try {
      await backup(db, temp);
      const check = new DatabaseSync(temp, { readOnly: true });
      let saved;
      try {
        if (check.prepare("PRAGMA quick_check").get().quick_check !== "ok")
          throw Error("Invalid resident backup");
        saved = check.prepare("SELECT revision FROM resident LIMIT 1").get().revision;
      } finally { check.close(); }
      chmodSync(temp, 0o600);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      renameSync(temp, join(dir, prefix + stamp + "-r" + saved + ".sqlite"));
      lastAt = Date.now();
      lastRevision = saved;
      prune();
      if (detached) throw Error("Resident database path changed; live data saved in recovery");
      return {revision:saved,time:lastAt};
    } finally { rmSync(temp, { force: true }); }
  }
  return async (force=false) => {
    if(force && pending) await pending;
    return pending ??= snapshot(force).finally(() => { pending = undefined; });
  };
}

export function restoreDrill(snapshot) {
  const scratch=mkdtempSync(join(tmpdir(),"whale-restore-"));
  let restored;
  try {
    const dest=join(scratch,"restored.sqlite");copyFileSync(snapshot,dest);
    restored=new DatabaseSync(dest);
    if(restored.prepare("PRAGMA integrity_check").get().integrity_check!=="ok" || restored.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("恢复演练发现数据不完整");
    const counts=inventory(restored);
    const revision=restored.prepare("SELECT revision FROM resident LIMIT 1").get()?.revision;
    restored.exec("BEGIN;CREATE TABLE restore_write_check(value INTEGER);ROLLBACK");
    return {status:"ok",revision,counts,time:Date.now()};
  } finally { restored?.close();rmSync(scratch,{recursive:true,force:true}); }
}
