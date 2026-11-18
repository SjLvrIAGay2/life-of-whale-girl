import { z } from "zod";
import { createHash } from "node:crypto";
import { one, saveVersion, stmt, type Setting } from "../db";
import type { State } from "../content/initial";
import type { Outcome } from "./action-result";
import {
  behaviorSchema,
  capabilities,
  data,
  definition,
  destination,
  itemId,
  key,
  properties,
  propertyPatch,
  regionList,
  visibility,
  volume,
  checkDimensions,
  type Behavior,
  type Item,
} from "./cabin-model";
import { describeBehavior, runBehavior, type ObjectHost } from "./cabin-behavior";
import { Cabin, loadCabin, syncFurniture } from "./cabin-store";
import { actionProblem } from "./diagnostics";

const opKey = { requestId: z.string().trim().min(1).max(128).default(() => crypto.randomUUID()) };
const target = { id: itemId };
const action = { ...target, action: key };
const catalog = z
  .object({
    op: z.literal("catalog"),
    query: z.string().max(100).default(""),
    type: key.optional(),
    parent: itemId.optional(),
    offset: z.number().int().nonnegative().default(0),
  })
  .strict();
const operations = z.discriminatedUnion("op", [
  catalog,
  z.object({ op: z.literal("inspect"), ...target, action: key.optional() }).strict(),
  z.object({ op: z.literal("type"), type: key }).strict(),
  z
    .object({
      op: z.literal("help"),
      command: z.string().optional(),
      capability: z.enum(capabilities).optional(),
    })
    .strict(),
  z.object({ op: z.literal("define"), ...opKey, type: key, definition }).strict(),
  z
    .object({ op: z.literal("defaults"), ...opKey, type: key, patch: z.record(z.string(), z.unknown()) })
    .strict(),
  z.object({ op: z.literal("create"), ...opKey, type: key, to: destination.optional() }).strict(),
  z
    .object({
      op: z.literal("update"),
      ...opKey,
      ...target,
      props: propertyPatch.optional(),
      state: data.optional(),
      regions: regionList.optional(),
      refs: z.array(itemId).max(100).optional(),
      visibility: visibility.optional(),
    })
    .strict(),
  z.object({ op: z.literal("find"), ...target, to: destination }).strict(),
  z.object({ op: z.literal("move"), ...opKey, ...target, to: destination }).strict(),
  z.object({ op: z.literal("stow"), ...opKey, ...target }).strict(),
  z.object({ op: z.literal("remove"), ...opKey, ...target }).strict(),
  z
    .object({
      op: z.literal("consume"),
      ...opKey,
      parent: itemId,
      region: key,
      type: key,
      count: z.number().int().min(1).max(256),
    })
    .strict(),
  z.object({ op: z.literal("call"), ...opKey, ...action, args: z.unknown().optional() }).strict(),
  z
    .object({
      op: z.literal("preview"),
      ...opKey,
      ...action,
      behavior: behaviorSchema,
      args: z.unknown().optional(),
    })
    .strict(),
  z.object({ op: z.literal("activate"), ...opKey, ...action, preview: itemId }).strict(),
  z.object({ op: z.literal("rollback"), ...opKey, ...action }).strict(),
]);
type Command = z.infer<typeof operations>;
const commands = operations.options.map((o) => o.shape.op.value);
const labels: Record<Command["op"], string> = {
  help: "查看了操作参数",
  catalog: "查看了对象目录",
  type: "查看了类型定义",
  inspect: "查看了物品",
  define: "登记了新类型",
  defaults: "更新了新实例的默认值",
  create: "生成了物品",
  update: "修改了物品",
  find: "找到了可放的位置",
  move: "移动了物品",
  stow: "收起了整件物品和内容",
  remove: "移除了物品",
  consume: "吃掉了物品",
  call: "调用了对象动作",
  preview: "试跑成功",
  activate: "启用了试跑过的动作",
  rollback: "恢复了上一个动作版本",
};
type Input = z.input<typeof operations>;
const guides = {
  catalog: { example: { op: "catalog", query: "糖" }, tip: "可按名称 query、类型 type 或容器 parent 找物品，用 nextOffset 继续翻。" },
  inspect: { example: { op: "inspect", id: "sill" }, tip: "查看位置、可用区域和动作。想改写某个动作，加上动作名 action 看它的做法。" },
  type: { example: { op: "type", type: "box" }, tip: "查看这种物品的定义，可用作新类型的起点。" },
  help: { example: { op: "help", command: "move" }, tip: "command 查操作，capability 查能力。" },
  define: { example: { op: "define", type: "mint", definition: { name: "薄荷糖", size: [1.3, 1, 1], massG: 2, consumable: true } },
    tip: "type 用小写英文开头。definition 必填 name、size（宽、深、高，厘米）、massG（克）。可加 description、color、volumeCm3、rotations、consumable、installMB、state、actions。内腔用 regions:{inside:{label,relation:'inside',size,loadG}}，预装内容用 contents:[{type,region,count}]。" },
  defaults: { example: { op: "defaults", type: "box", patch: { color: "浅蓝" } }, tip: "patch 填要改的定义项，新做的物品会采用这些值。" },
  create: { example: { op: "create", type: "box", to: { parent: "sill", region: "top" } }, tip: "填 to 可以直接摆好。省略 to 时物品先收着。" },
  update: { example: { op: "update", id: "desk", props: { color: "浅棕" } }, tip: "只改这一件。props 填属性，也可改 state、regions、refs 或 visibility。" },
  find: { example: { op: "find", id: "computer", to: { parent: "desk", region: "top" } }, tip: "询问能放下的位置。物品留在原处。" },
  move: { example: { op: "move", id: "computer", to: { parent: "desk", region: "top" } }, tip: "小屋会找空位。指定位置时在 to 填 x、y（厘米），可加 rotation（0、90、180、270 度）。放不下时物品留在原处。" },
  stow: { example: { op: "stow", id: "computer" }, tip: "连同里边的东西一起收起。" },
  remove: { example: { op: "remove", id: "物品编号" }, tip: "移除一件已清空、也没有被其他物品引用的物品。" },
  consume: { example: { op: "consume", parent: "糖盒编号", region: "inside", type: "mint", count: 2 }, tip: "一次取用这个区域里指定数量的同类食品。" },
  call: { example: { op: "call", id: "website", action: "open" }, tip: "选择物品列出的动作，需要的参数放在 args。" },
  preview: { example: { op: "preview", id: "棋盘编号", action: "review",
    behavior: { input: "integer", recipe: { description: "按手数看棋谱", steps: [{ op: "replay" }] } }, args: { input: 1 } },
    tip: "试跑只给出预期效果。behavior 可填 capability，也可填 input 和 recipe。input 选 none、text、integer。步骤可用 read（source、可选 query）、take（count）、join（separator）、caption（text）、draw（idea）、state.get（key）、state.append（key、text）、replay（按手数看棋）。用 $input 引用输入，$result 引用上一步的结果。" },
  activate: { example: { op: "activate", id: "棋盘编号", action: "review", preview: "试跑编号" }, tip: "填试跑返回的 preview，下一次使用即生效。" },
  rollback: { example: { op: "rollback", id: "棋盘编号", action: "review" }, tip: "撤回这个动作最近的一次修改。" },
} satisfies { [K in Command["op"]]: { example: Extract<Input, { op: K }>; tip: string } };

function manual(cmd: Extract<Command, { op: "help" }>) {
  if (cmd.capability) return describeBehavior({ capability: cmd.capability });
  if (!cmd.command) return { commands, capabilities, example: guides.create.example };
  const command = commands.find((op) => op === cmd.command);
  if (!command) throw Error("找不到操作 " + cmd.command + "。可选 " + commands.join("、"));
  return guides[command];
}

function catalogPage(cabin: Cabin, cmd: z.infer<typeof catalog>) {
  const matches = (value: string) => value.toLowerCase().includes(cmd.query.toLowerCase());
  const matchesQuery = [...cabin.items.values()].filter(
    (i) =>
      cabin.usable(i) &&
      cabin.reachable(i) &&
      (!cmd.type || i.type === cmd.type) &&
      (!cmd.parent || i.at?.parent === cmd.parent) &&
      (matches(i.id) || matches(i.props.name) || matches(i.type)),
  );
  const placed: Item[] = [],
    stored: Item[] = [];
  for (const i of matchesQuery) (cabin.path(i).at(-1)?.id === "cabin" ? placed : stored).push(i);
  const items = [...placed, ...stored];
  const types = [...cabin.types].filter(
    ([id, d]) => (!cmd.type || id === cmd.type) && (matches(id) || matches(d.name)),
  );
  const end = cmd.offset + 24;
  return {
    types: types.slice(cmd.offset, end).map(([type, d]) => ({ type, name: d.name })),
    items: items
      .slice(cmd.offset, end)
      .map((i) => ({ id: i.id, type: i.type, name: i.props.name, at: i.at })),
    total: items.length,
    nextOffset: Math.max(types.length, items.length) > end ? end : undefined,
  };
}
function visibleState(item: Item) {
  const record = item.state.legacy;
  if (!item.importedFurniture && item.type === "keepsake" && record && typeof record === "object" && !Array.isArray(record) &&
      record.id === item.id && typeof record.kind === "string" && typeof record.x === "number" && typeof record.y === "number") {
    const { legacy: _, ...state } = item.state;
    return state;
  }
  return item.state;
}
function inspect(cabin: Cabin, item: Item) {
  const children = cabin.children(item.id).filter((i) => cabin.usable(i));
  const regions = Object.values(item.regions);
  return {
    id: item.id,
    type: item.type,
    props: item.props,
    volumeCm3: volume(item.props),
    canContain: regions.some((r) => r.relation === "inside"),
    canSupport: regions.some((r) => r.relation === "on"),
    canHang: regions.some((r) => r.relation === "hang"),
    totalMassG: cabin.mass(item),
    state: visibleState(item),
    at: item.at,
    refs: item.refs.filter((id) => cabin.usable(cabin.get(id))),
    path: cabin.path(item).map((i) => i.id),
    visibility: item.visibility,
    regions: item.regions,
    counts: Object.fromEntries(
      Object.keys(item.regions).flatMap((k) => {
        const r = item.regions[k];
        return "gate" in r && r.gate && item.state[r.gate] !== true
          ? []
          : [[k, children.filter((i) => i.at!.region === k).length]];
      }),
    ),
    actions: Object.fromEntries(
      Object.entries(item.actions).map(([k, b]) => [
        k,
        describeBehavior(b),
      ]),
    ),
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
type Draft = { item: string; action: string; base: string | null; behavior: string; args: string };
const versionName = (item: Item, action: string) => "cabin/" + encodeURIComponent(item.id) + "/" + action;
async function apply(
  cabin: Cabin,
  cmd: Command,
  host: ObjectHost,
  now: number,
  scope: Item["visibility"],
  writes: D1PreparedStatement[],
): Promise<unknown> {
  if (cmd.op === "help") return manual(cmd);
  if (cmd.op === "catalog") return catalogPage(cabin, cmd);
  if (cmd.op === "type" || cmd.op === "define" || cmd.op === "defaults") {
    const current = cabin.types.get(cmd.type);
    if (cmd.op === "type") {
      if (!current) throw Error("找不到类型 " + cmd.type);
      return { type: cmd.type, definition: current };
    }
    if (cmd.op === "define" && current) throw Error("类型编号已被使用 " + cmd.type);
    if (cmd.op === "defaults" && !current) throw Error("找不到类型 " + cmd.type);
    const parsed = cmd.op === "define" ? cmd.definition : definition.parse({ ...current, ...cmd.patch });
    checkDimensions(parsed, parsed.regions);
    // Check the complete contents graph and the actual fit before publishing this default.
    const trial = new Cabin(new Map(), new Map(cabin.types).set(cmd.type, parsed));
    trial.spawn(cmd.type);
    writes.push(
      stmt(
        "INSERT INTO cabin_types VALUES(?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition",
        cmd.type,
        JSON.stringify(parsed),
      ),
    );
    return { type: cmd.type, name: parsed.name };
  }
  if (cmd.op === "create") {
    if (cmd.type === "cabin") throw Error("小屋已有坐标原点");
    if (cmd.to) cabin.owned(cmd.to.parent);
    const item = cabin.spawn(cmd.type, cmd.to, undefined, scope);
    return {
      id: item.id,
      type: item.type,
      at: item.at,
      contents: cabin.children(item.id).map((i) => ({ id: i.id, type: i.type })),
    };
  }
  if (cmd.op === "consume") {
    const parent = cabin.owned(cmd.parent);
    cabin.accessible(parent);
    cabin.openRegion(parent, cmd.region);
    const items = cabin
      .children(parent.id, cmd.region)
      .filter((i) => i.type === cmd.type && i.props.consumable && cabin.usable(i));
    if (items.length < cmd.count) throw Error("可食用的同类物品只有 " + items.length + " 件");
    const taken = items.slice(0, cmd.count);
    for (const i of taken) cabin.remove(i);
    return { consumed: taken.map((i) => i.id), remaining: items.length - taken.length };
  }
  const item = cabin.owned(cmd.id);
  cabin.accessible(item);
  switch (cmd.op) {
    case "inspect": {
      if (cmd.action) {
        const behavior = item.actions[cmd.action];
        if (!behavior) throw Error(item.props.name + " 没有动作 " + cmd.action);
        return { id: item.id, action: cmd.action, behavior, ...describeBehavior(behavior) };
      }
      return inspect(cabin, item);
    }
    case "move":
    case "find": {
      cabin.owned(cmd.to.parent);
      const from = item.at;
      const at = cabin.place(item, cmd.to, cmd.op === "find");
      if (cmd.op === "move") cabin.touch(item);
      return { id: item.id, at, from };
    }
    case "update":
      if (cmd.props) item.props = properties.parse({ ...item.props, ...cmd.props });
      if (cmd.state) item.state = data.parse({ ...item.state, ...cmd.state });
      if (cmd.regions) item.regions = cmd.regions;
      if (cmd.refs) {
        for (const id of cmd.refs) cabin.owned(id);
        item.refs = cmd.refs;
      }
      if (cmd.visibility) item.visibility = cmd.visibility;
      cabin.validateEdit(item);
      cabin.touch(item);
      return inspect(cabin, item);
    case "stow":
      cabin.stow(item);
      return { id: item.id, at: null, contents: "所有部件和内容共同收起" };
    case "remove":
      cabin.remove(item);
      return { removed: item.id };
    case "call": {
      const behavior = item.actions[cmd.action];
      if (!behavior) throw Error(item.props.name + " 没有动作 " + cmd.action);
      if (item.props.installMB && !item.at) throw Error("先把软件安装到设备上");
      const exposed =
        "capability" in behavior &&
        behavior.capability === "game" &&
        cabin.publicItems().some((i) => i.id === item.id);
      const result = await runBehavior(
        item,
        behavior,
        cmd.args,
        host,
        false,
        exposed ? item.visibility : "hidden",
      );
      cabin.touch(item);
      return { id: item.id, action: cmd.action, version: item.versions[cmd.action] ?? "initial", result };
    }
    case "preview": {
      const sample = structuredClone(item);
      const result = await runBehavior(sample, cmd.behavior, cmd.args, host, true);
      const id = crypto.randomUUID();
      writes.push(
        stmt(
          "INSERT INTO cabin_previews VALUES(?,?,?,?,?,?)",
          id,
          item.id,
          cmd.action,
          item.versions[cmd.action] ?? null,
          JSON.stringify(cmd.behavior),
          JSON.stringify(cmd.args ?? {}),
        ),
      );
      return { preview: id, result, state: visibleState(sample) };
    }
    case "activate": {
      const draft = await one<Draft>("SELECT * FROM cabin_previews WHERE id=?", cmd.preview);
      if (!draft || draft.item !== item.id || draft.action !== cmd.action)
        throw Error("找不到这个对象动作的试跑记录");
      if ((item.versions[cmd.action] ?? null) !== draft.base) throw Error("动作版本已改变，请重新试跑");
      const behavior: Behavior = JSON.parse(draft.behavior);
      await runBehavior(structuredClone(item), behavior, JSON.parse(draft.args), host, true);
      const id = crypto.randomUUID(),
        before = item.actions[cmd.action] ?? null;
      writes.push(
        saveVersion(versionName(item, cmd.action), JSON.stringify({ behavior, before }), draft.base, now, id),
        stmt("DELETE FROM cabin_previews WHERE id=?", cmd.preview),
      );
      item.actions[cmd.action] = behavior;
      item.versions[cmd.action] = id;
      cabin.touch(item);
      return { id: item.id, action: cmd.action, version: id };
    }
    case "rollback": {
      const v = await one<Setting>(
        "SELECT * FROM agent_versions WHERE id=? AND name=?",
        item.versions[cmd.action] ?? "",
        versionName(item, cmd.action),
      );
      if (!v) throw Error("这个动作已经是初始版本");
      const before = JSON.parse(v.value).before as Behavior | null;
      if (before) item.actions[cmd.action] = before;
      else delete item.actions[cmd.action];
      if (v.parent) item.versions[cmd.action] = v.parent;
      else delete item.versions[cmd.action];
      cabin.touch(item);
      return { id: item.id, action: cmd.action, version: v.parent, available: !!before };
    }
  }
}

// The caller holds the resident lease. Mutations, host writes, receipt and public revision
// enter the same fenced SQLite batch. A failed attempt discards its in-memory working copy.
export async function cabinAction(
  state: State,
  raw: unknown,
  host: ObjectHost,
  now: number,
  scope: Item["visibility"],
) {
  const cmd = operations.parse(raw),
    writes: D1PreparedStatement[] = [];
  const id = "requestId" in cmd ? cmd.requestId : null;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical(cmd)))
    .digest("hex");
  if (id) {
    const old = await one<{ fingerprint: string; outcome: string }>(
      "SELECT * FROM cabin_requests WHERE id=?",
      id,
    );
    if (old) {
      if (old.fingerprint !== fingerprint) throw Error("requestId 已用于另一项请求");
      return { outcome: JSON.parse(old.outcome) as Outcome, writes };
    }
  }
  const cabin = await loadCabin(state);
  let outcome: Outcome;
  try {
    const result = await apply(cabin, cmd, host, now, scope, writes);
    let summary = labels[cmd.op] + "。";
    if (cmd.op === "consume")
      summary =
        "吃掉 " +
        cmd.count +
        " 件" +
        cabin.types.get(cmd.type)!.name +
        "，该区域还剩 " +
        (result as { remaining: number }).remaining +
        " 件。";
    if (cmd.op === "move" || cmd.op === "find") {
      const parent = cabin.get(cmd.to.parent),
        at = (result as { at: Item["at"] }).at!;
      const region = parent.regions[at.region];
      summary =
        cabin.get(cmd.id).props.name +
        (cmd.op === "move" ? "已放到" : "可以放到") +
        parent.props.name +
        "的" +
        region.label +
        (region.relation === "installed" ? "" : " (" + at.x + ", " + at.y + ") cm") +
        "。";
    }
    outcome = { status: "done", summary, result };
    if (id) {
      writes.push(...cabin.writes(now));
      syncFurniture(state, cabin);
    }
  } catch (e) {
    writes.length = 0;
    const error = actionProblem(e);
    outcome = { status: "failed", summary: error, result: { error } };
  }
  if (id)
    writes.push(stmt("INSERT INTO cabin_requests VALUES(?,?,?)", id, fingerprint, JSON.stringify(outcome)));
  return { outcome, writes };
}
export async function cabinContext(state: State) {
  const cabin = await loadCabin(state);
  const listing = catalogPage(cabin, catalog.parse({ op: "catalog" }));
  return {
    latest: state.lastAction?.action === "object" ? state.lastResult : undefined,
    types: listing.types,
    items: listing.items.map(({ id, type, name, at }) => {
      const item = cabin.get(id);
      return { id, type, name, at: at && { parent: at.parent, region: at.region },
        regions: Object.keys(item.regions), actions: Object.keys(item.actions) };
    }),
    total: listing.total,
  };
}
