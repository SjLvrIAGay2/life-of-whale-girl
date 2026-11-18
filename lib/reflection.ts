import { all, one } from "../db";
import { experienceLabel, type Experience } from "../content/activity";
import { shanghaiDate } from "./friend-memory";

export async function reflectionActivities() {
  const rows = await all<{id:string;made:number;visibility:string;detail:string}>(
    "SELECT id,made,visibility,detail FROM activities ORDER BY made DESC,rowid DESC LIMIT 10");
  return rows.map(row => {
    const {detail,remark} = JSON.parse(row.detail) as {detail:Experience;remark?:string};
    return {id:row.id,evidenceId:row.id,made:row.made,visibility:row.visibility,kind:detail.kind,
      time:shanghaiDate(row.made),description:experienceLabel(detail),
      title:detail.kind === "reading" ? detail.items[0]?.title : undefined,remark};
  });
}

export class ReflectionInputError extends Error {
  constructor(readonly field: "idea" | "evidenceId", message: string) { super(message); }
}

export async function reflectionTarget(evidenceId: string | undefined, idea: string | undefined) {
  if (!idea?.trim()) throw new ReflectionInputError("idea", "idea 还没有填写感想的原文。");
  if (!evidenceId) throw new ReflectionInputError("evidenceId", "evidenceId 还没有填写活动编号，请从 reflection.activities 选择。");
  if (await one("SELECT id FROM activities WHERE id=?", evidenceId)) return evidenceId;
  // An observation and its activity are separate records. Accept the observation only when
  // its execution time and source identify exactly one recorded reading activity.
  const memory = await one<{made:number;source:string;category:string|null}>(
    "SELECT made,source,category FROM memories WHERE id=? AND kind='observation' AND scope IN ('self','public')", evidenceId);
  if (memory) {
    const matches = await all<{id:string}>(`SELECT DISTINCT a.id FROM activities a JOIN json_each(a.detail,'$.detail.items') item
      WHERE a.made=? AND json_extract(a.detail,'$.detail.kind')='reading'
      AND json_extract(a.detail,'$.detail.level')=? AND json_extract(item.value,'$.url')=?`,
      memory.made,memory.category,memory.source);
    if (matches.length === 1) return matches[0].id;
    throw new ReflectionInputError("evidenceId", "这是阅读记忆的编号，暂时无法唯一对应到一次活动。请从 reflection.activities 选择活动编号。");
  }
  throw new ReflectionInputError("evidenceId", "没有找到 evidenceId 对应的活动。请从 reflection.activities 选择，或用 archive 查找更早的活动。");
}
