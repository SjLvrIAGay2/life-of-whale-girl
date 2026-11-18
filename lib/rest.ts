import { numbers } from "../config/numbers";
import { all, one } from "../db";
import type { State } from "../content/initial";
import { shanghaiDate } from "./friend-memory";

export const defaultRestMinutes = numbers.defaults.restMinutes;
export type RestSession = { since: number; posture: "in_bed" | "up" };

// The current activity is cleared by other actions, conversations and failed attempts.
// Keep the start of consecutive rest decisions without turning thoughts into body movements.
export async function currentRest(state: State, now: number): Promise<RestSession | undefined> {
  if (state.mode !== "awake" || !state.currentActivity) return;
  const row = await one<{made:number;detail:string}>("SELECT made,detail FROM activities WHERE id=?", state.currentActivity);
  if (!row || row.made > now) return;
  const detail = JSON.parse(row.detail).detail;
  if (detail?.kind !== "rest") return;
  const posture = state.inBed ? "in_bed" : "up";
  if (detail.rest?.posture === posture && Number.isFinite(detail.rest.since) && detail.rest.since <= row.made)
    return {since:detail.rest.since,posture};
  // Older releases stored each continuation separately. Reconstruct only adjacent, matching rests.
  let since = row.made;
  const interruption=await one<{at:number|null}>(`SELECT max(json_extract(value,'$.at')) AS at FROM channel_state
    WHERE id LIKE 'activity-decision/%' AND json_extract(value,'$.outcome.action')<>'rest'
    AND json_extract(value,'$.at')<?`,row.made);
  const older = await all<{made:number;until:number;detail:string}>(
    "SELECT made,until,detail FROM activities WHERE made<? ORDER BY made DESC,rowid DESC LIMIT 100", row.made);
  for (const prior of older) {
    const previous = JSON.parse(prior.detail).detail;
    if (previous?.kind !== "rest" || previous.description !== detail.description || Math.abs(prior.until-since)>1000 ||
        (interruption?.at!==null && interruption?.at!==undefined && prior.made<=interruption.at)) break;
    since = prior.made;
  }
  return {since,posture};
}

export function restContext(rest: RestSession | undefined, state: State, now: number) {
  return rest && {since:shanghaiDate(rest.since),elapsedMinutes:Math.floor(Math.max(0,now-rest.since)/60000),
    posture:rest.posture,nextDecisionAt:shanghaiDate(state.nextAt)};
}
