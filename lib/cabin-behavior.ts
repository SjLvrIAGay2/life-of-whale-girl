import { env } from "cloudflare:workers";
import { cabinBehaviorErrors } from "../config/texts/errors.ts";
import { links } from "../config/links.ts";
import { z } from "zod";
import { one, publicHome } from "../db";
import { historyCursor, readActions, sharedLink, type Observation, type ReadRequest } from "./media";
import { positionAt, type Game } from "./games";
import { studioSchema } from "./studio";
import { workHistory } from "./works";
import { previewParts, runObjectRecipe } from "./toolbox";
import { data, type Behavior, type Item } from "./cabin-model";
import { readingOutcome, sourceNames } from "../content/activity";
import { capabilityGuides, recipeInputs } from "../config/tool-guides/capabilities";

const mediaArgs = z
  .object({
    action: z.enum(readActions).default("browse"),
    id: z.string().max(560).optional(),
    query: z.string().max(70).optional(),
    page: z.number().int().min(1).max(10000).optional(),
    offset: z.number().int().min(0).max(50000).optional(),
    root: z.string().max(22).optional(),
    cursor: historyCursor.optional(),
  })
  .strict();
const browserArgs = z.object({ url: z.string().max(560).optional() }).strict();
const heyboxArgs = mediaArgs.extend({
  action: z.enum(["browse", "open", "comments", "search"]).default("browse"),
});
const gameArgs = z
  .object({
    op: z.enum(["look", "move", "pause", "resume", "restart", "next"]).default("look"),
    move: z.string().max(12).optional(),
    note: z.string().max(180).optional(),
  })
  .strict();
const empty = z.object({}).strict();
const websiteArgs = studioSchema.extend({ op: studioSchema.shape.op.default("catalog") });
const inputs = {
  none: empty,
  text: z.object({ input: z.string().trim().min(1).max(400) }).strict(),
  integer: z.object({ input: z.number().int().nonnegative() }).strict(),
};
const mediaInputs = { bili: mediaArgs, heybox: heyboxArgs };


export function describeBehavior(b: Behavior) {
  return "recipe" in b
    ? { description: b.recipe.description, ...recipeInputs[b.input] }
    : capabilityGuides[b.capability];
}
export type ObjectHost = {
  read: (query: ReadRequest) => Promise<Observation>;
  draw: (idea: string) => Promise<string>;
  website: (args: z.infer<typeof studioSchema>) => Promise<unknown>;
  game: (
    save: string,
    kind: Game["kind"],
    args: z.infer<typeof gameArgs>,
    visibility: Item["visibility"],
  ) => Promise<unknown>;
};
const noArgs: Record<string, unknown> = {};
export async function runBehavior(
  item: Item,
  b: Behavior,
  args: unknown,
  host: ObjectHost,
  preview = false,
  sharing: Item["visibility"] = "hidden",
): Promise<unknown> {
  const read = async (query: ReadRequest) => {
    if (preview) return { status: "preview", items: [{ title: "阅读预览" }] };
    const observation = await host.read(query);
    if (observation.status !== "ok")
      throw Error("在" + sourceNames[query.source] + readingOutcome({ ...query, ...observation }) + "。");
    return observation;
  };
  if ("recipe" in b) {
    const parsed = inputs[b.input].parse(args ?? noArgs);
    const input = "input" in parsed ? String(parsed.input) : "";
    const needsGame = b.recipe.steps.some((step) => step.op === "replay");
    const saved =
      needsGame &&
      item.source?.kind === "game" &&
      (await one<{ position: string }>("SELECT position FROM play_saves WHERE id=?", item.source.id));
    const game: Game | undefined = saved ? JSON.parse(saved.position) : undefined;
    const result = await runObjectRecipe(b.recipe, input, {
      ...(preview
        ? previewParts
        : {
            read: async (source: "bili" | "heybox", query?: string) =>
              (await read({ source, action: query ? "search" : "browse", query })).items.map((i) => i.title),
            draw: host.draw,
          }),
      get: (key) => {
        const v = item.state[key];
        if (v === undefined) throw Error("对象没有状态字段 " + key);
        return (Array.isArray(v) ? v : [v]).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
      },
      append: (key, text) => {
        const values = item.state[key];
        if (!Array.isArray(values)) throw Error("状态字段 " + key + " 不是列表");
        values.push(text);
        data.parse(item.state);
        return [text];
      },
      replay: (value) => {
        if (!game || game.kind !== "gomoku") throw Error(cabinBehaviorErrors.missingMoves);
        const ply = Number(value || game.moves.length);
        if (!Number.isSafeInteger(ply) || ply < 0 || ply > game.moves.length)
          throw Error("手数应在 0 到 " + game.moves.length + " 之间");
        const move = game.moves[ply - 1];
        return [
          move ? "第 " + ply + " 手 · " + move.stone + " " + move.cell : "开局",
          ...positionAt(game.moves, ply),
        ];
      },
    });
    return { output: result };
  }
  const capability = b.capability;
  if (capability === "bili" || capability === "heybox")
    return read({ source: capability, ...mediaInputs[capability].parse(args ?? {}) });
  if (capability === "website") {
    const command = websiteArgs.parse(args ?? {});
    return preview ? { preview: true, op: command.op } : host.website(command);
  }
  if (capability === "browser") {
    const { url } = browserArgs.parse(args ?? {});
    const homeUrl = new URL("/", env.WHALE_ORIGIN || links.defaults.siteOrigin).href;
    if (url && url !== "/" && url !== homeUrl && url !== homeUrl.slice(0, -1)) {
      const link = sharedLink(url);
      if (!link) throw Error(cabinBehaviorErrors.invalidUrl);
      return read(link);
    }
    if (preview) return { preview: true, url: homeUrl };
    const home = await publicHome();
    return {
      url: homeUrl,
      title: home.name,
      activity: home.activity,
      revision: home.revision,
      posts: home.posts.map((p) => ({ day: p.day, body: p.body.slice(0, 320) })),
    };
  }
  if (capability === "game") {
    const command = gameArgs.parse(args ?? {});
    if (item.source?.kind !== "game") throw Error(cabinBehaviorErrors.noGame);
    const saved = await one<{ kind: Game["kind"] }>("SELECT kind FROM play_saves WHERE id=?", item.source.id);
    if (!saved) throw Error(cabinBehaviorErrors.missingGame);
    return preview
      ? { preview: true, save: item.source.id }
      : host.game(item.source.id, saved.kind, command, sharing);
  }
  empty.parse(args ?? {});
  if (capability === "open" || capability === "close") {
    const gates = Object.values(item.regions).flatMap((r) => ("gate" in r && r.gate ? [r.gate] : []));
    if (!gates.length) throw Error(cabinBehaviorErrors.noHinge);
    for (const gate of gates) item.state[gate] = capability === "open";
    return { open: capability === "open" };
  }
  if (item.source?.kind !== capability) throw Error(capability === "work" ? "这件物品还没有对应的作品" : "这件物品还没有对应的画作");
  if (capability === "work")
    return {
      work: item.source.id,
      title: item.props.name,
      steps: await workHistory(item.source.scope, item.source.id),
    };
  return {
    art: item.source.id,
    title: item.props.name,
    url: "/picture/" + encodeURIComponent(item.source.id),
  };
}
