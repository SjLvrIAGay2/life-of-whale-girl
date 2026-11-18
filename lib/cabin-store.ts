import { all, stmt } from "../db";
import { createHash } from "node:crypto";
import { furniture, type ObjectKind, type RoomItem, type State } from "../content/initial";
import { builtins, instantiate, type Definition, type Destination, type Item } from "./cabin-model";
import { Space } from "./cabin-space";
import { playGame, type Game } from "./games";

type Row = {
  id: string;
  type: string;
  body: string;
  source: string | null;
  source_id: string | null;
  scope: string | null;
  title: string | null;
};

// Keep the domain records authoritative. Object extensions and placement survive edits to their sources.
const linkedRows = `SELECT i.*,coalesce(w.title,d.title) AS title,CASE i.source
  WHEN 'work' THEN CASE WHEN w.state<>'hidden' THEN w.scope END
  WHEN 'picture' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM work_steps s JOIN works owner ON owner.id=s.work
    WHERE s.art=d.id AND (owner.state='hidden' OR (s.level IS NOT 'reference' AND owner.scope<>d.scope)))
    AND NOT EXISTS (SELECT 1 FROM art_jobs j JOIN works owner ON owner.id=j.work WHERE j.art=d.id AND owner.state='hidden')
    AND NOT EXISTS (SELECT 1 FROM memories m WHERE m.source='/picture/'||d.id AND m.hidden=1) THEN d.scope END
  WHEN 'game' THEN CASE WHEN g.id IS NULL THEN NULL WHEN json_extract(i.body,'$.createdGame')=1 THEN 'public' WHEN ?='detail' AND EXISTS
    (SELECT 1 FROM activities a WHERE a.visibility='detail' AND json_extract(a.detail,'$.detail.save')=g.id)
    THEN 'public' ELSE 'self' END END AS scope
  FROM cabin_items i LEFT JOIN works w ON i.source='work' AND i.source_id=w.id
  LEFT JOIN drawings d ON i.source='picture' AND i.source_id=d.id
  LEFT JOIN play_saves g ON i.source='game' AND i.source_id=g.id ORDER BY i.rowid`;

export class Cabin extends Space {
  private changed = new Set<string>();
  private removed = new Set<string>();
  private newGames = new Map<string, Game>();
  constructor(
    items: Map<string, Item>,
    readonly types: Map<string, Definition>,
  ) {
    super(items);
  }
  touch(item: Item) {
    this.changed.add(item.id);
  }
  usable(item: Item) {
    return this.path(item).every((i) => !i.source || ["self", "public"].includes(i.source.scope));
  }
  owned(id: string) {
    const item = this.get(id);
    if (!this.usable(item)) throw Error("这件物品不在自己的可查看范围内");
    return item;
  }
  add(id: string, type: string, def = this.types.get(type)) {
    if (!def) throw Error("目录中没有类型 " + type);
    if (this.items.has(id)) throw Error("对象编号已经存在 " + id);
    const item = instantiate(id, type, def);
    this.items.set(id, item);
    this.touch(item);
    return item;
  }
  spawn(
    type: string,
    at?: Destination,
    id: string = crypto.randomUUID(),
    visibility: Item["visibility"] = "detail",
  ) {
    const item = this.makeItem(type, id, visibility, [], { count: 0 });
    if (at) this.place(item, at);
    return item;
  }
  private makeItem(
    type: string,
    id: string,
    visibility: Item["visibility"],
    ancestors: string[],
    budget: { count: number },
  ): Item {
    if (ancestors.includes(type)) throw Error("预装内容循环引用了类型 " + type);
    if (++budget.count > 512) throw Error("一次生成的对象超过 512 件");
    const def = this.types.get(type);
    if (!def) throw Error("目录中没有类型 " + type);
    const game = Object.values(def.actions).find((b) => "capability" in b && b.capability === "game");
    const item = this.add(game ? "game/" + id : id, type, def);
    if (game && "capability" in game) {
      this.newGames.set(id, playGame(undefined, { op: "start", game: game.game ?? "gomoku" }));
      item.source = { kind: "game", id, scope: "public" };
      item.createdGame = true;
    }
    item.visibility = visibility;
    if (Object.hasOwn(furniture, type))
      item.art = { kind: type as ObjectKind, dx: item.props.size[0] / 20, dy: item.props.size[1] / 20 };
    this.fill(item, def.contents, [...ancestors, type], budget);
    return item;
  }
  fill(item: Item, contents: Definition["contents"], ancestors = [item.type], budget = { count: 1 }) {
    if (!contents.length) return;
    // Assemble the declared contents before closing the newly made container.
    const initialState = item.state;
    item.state = { ...initialState };
    for (const r of Object.values(item.regions)) if ("gate" in r && r.gate) item.state[r.gate] = true;
    let index = 0;
    for (const recipe of contents)
      for (let i = 0; i < recipe.count; i++) {
        const id =
          "item-" +
          createHash("sha256")
            .update(JSON.stringify([item.id, index++]))
            .digest("hex")
            .slice(0, 32);
        const child = this.makeItem(recipe.type, id, item.visibility, ancestors, budget);
        this.place(child, { parent: item.id, region: recipe.region });
      }
    item.state = initialState;
    this.touch(item);
  }
  remove(item: Item) {
    if (item.id === "cabin") throw Error("小屋地面是坐标原点");
    if (item.source) throw Error("要保留这件物品的记录，请用 stow 收起");
    if (this.children(item.id).length) throw Error("物品中还有内容；可整体收起，或先移出里面的物品");
    if ([...this.items.values()].some((i) => i.refs.includes(item.id)))
      throw Error("另一个对象仍引用这件物品");
    this.relocate(item, null);
    this.items.delete(item.id);
    this.changed.delete(item.id);
    this.removed.add(item.id);
  }
  stow(item: Item) {
    if (item.id === "cabin") throw Error("小屋地面是坐标原点");
    this.accessible(item);
    this.relocate(item, null);
    this.touch(item);
  }
  writes(now = Date.now()) {
    const writes = [...this.newGames].map(([id, game]) =>
      stmt(
        "INSERT INTO play_saves(id,kind,updated,position) VALUES(?,?,?,?)",
        id,
        game.kind,
        now,
        JSON.stringify(game),
      ),
    );
    writes.push(...[...this.removed].map((id) => stmt("DELETE FROM cabin_items WHERE id=?", id)));
    for (const id of this.changed) {
      const { source, ...item } = this.get(id);
      if (source?.title === item.props.name) item.props = { ...item.props, name: builtins[item.type].name };
      writes.push(
        stmt(
          "INSERT INTO cabin_items(id,type,body,source,source_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,type=excluded.type",
          id,
          item.type,
          JSON.stringify(item),
          source?.kind ?? null,
          source?.id ?? null,
        ),
      );
    }
    return writes;
  }
  addFurniture(entry: RoomItem) {
    const known = Object.hasOwn(furniture, entry.kind);
    const item = this.spawn(known ? entry.kind : "keepsake", undefined, entry.id);
    if (!known) {
      const legacy = entry as RoomItem & { name?: string };
      item.props.name = legacy.name || entry.kind || entry.id;
      item.importedFurniture = { ...entry };
    }
    const desk =
      entry.kind === "computer" &&
      [...this.items.values()].find(
        (i) => i.art?.kind === "desk" && i.at && Math.abs(this.worldXY(i)[0] / 10 + i.art.dx - entry.x) < 12,
      );
    const [w, d] = item.props.size;
    const where = desk
      ? { parent: desk.id, region: "top" }
      : {
          parent: "cabin",
          region: "floor",
          x: Math.max(0, Math.min(1000 - w, Math.round(entry.x * 10 - w / 2))),
          y: Math.max(0, Math.min(1000 - d, Math.round(entry.y * 10 - d / 2))),
        };
    try {
      this.place(item, where);
    } catch {
      this.place(item, { parent: "cabin", region: "floor" });
    }
    const [x, y] = this.worldXY(item);
    if (known) item.art = { kind: entry.kind, dx: entry.x - x / 10, dy: entry.y - y / 10 };
    return item;
  }
  seed(room: RoomItem[]) {
    this.add("cabin", "cabin");
    this.spawn("sill", { parent: "cabin", region: "floor", x: 370, y: 280 }, "sill");
    // Desks must exist before matching the older desktop computer artwork.
    for (const entry of [
      ...room.filter((i) => i.kind !== "computer"),
      ...room.filter((i) => i.kind === "computer"),
    ])
      this.addFurniture(entry);
    const computer = [...this.items.values()].find((i) => i.art?.kind === "computer");
    this.spawn("website", computer ? { parent: computer.id, region: "apps" } : undefined, "website");
  }
}

export async function loadCabin(state: State) {
  const [rows, definitions] = await Promise.all([
    all<Row>(linkedRows, state.sharing ?? "detail"),
    all<{ id: string; definition: string }>("SELECT * FROM cabin_types ORDER BY id"),
  ]);
  const types = new Map(Object.entries(builtins));
  for (const row of definitions) types.set(row.id, JSON.parse(row.definition));
  const items = new Map<string, Item>();
  const pending: { item: Item; contents: Definition["contents"] }[] = [];
  for (const r of rows) {
    const saved = JSON.parse(r.body);
    const initial: Definition = saved.initial ?? builtins[r.type];
    const item: Item = saved.props ? saved : instantiate(r.id, r.type, initial);
    if (!saved.props && initial.contents.length) pending.push({ item, contents: initial.contents });
    if (r.source) {
      item.source = {
        kind: r.source as "work" | "game" | "picture",
        id: r.source_id!,
        scope: r.scope ?? "inaccessible",
        title: r.title ?? undefined,
      };
      if (r.title && item.props.name === builtins[r.type].name) item.props.name = r.title;
    }
    items.set(item.id, item);
  }
  const cabin = new Cabin(items, types);
  for (const { item, contents } of pending) cabin.fill(item, contents);
  if (!items.has("cabin")) cabin.seed(state.room);
  return cabin;
}

export async function initializeCabin(state: State) {
  if (state.sleepVersion !== 1 && !state.room.some((i) => i.kind === "alarm") && state.room.length < 18) {
    const { x, y } = furniture.alarm;
    state.room.push({ id: "alarm", kind: "alarm", x, y });
  }
  const cabin = await loadCabin(state);
  state.cabinVersion = 1;
  return cabin.writes();
}

export type LegacyMove = {
  operation: "add" | "move" | "remove";
  kind?: ObjectKind;
  id?: string;
  x?: number;
  y?: number;
};
export async function arrangeFurniture(state: State, move: LegacyMove) {
  const cabin = await loadCabin(state);
  const kind = move.kind;
  const scene = cabin.scene();
  let item: Item;
  if (move.operation === "add") {
    if (!kind) throw Error("添置家具需要指定种类");
    if (scene.length >= 18) throw Error("小屋已满");
    const id = cabin.items.has(kind) ? kind + "-" + crypto.randomUUID().slice(0, 6) : kind;
    item = cabin.addFurniture({
      id,
      kind,
      x: clampX(kind, move.x ?? furniture[kind].x),
      y: move.y ?? furniture[kind].y,
    });
  } else {
    const entry =
      move.id !== undefined
        ? scene.find((i) => i.id === move.id && (!kind || i.kind === kind))
        : (scene.find((i) => i.id === kind) ?? scene.find((i) => i.kind === kind));
    if (!entry) throw Error("屋里找不到这个物件，请选小屋里现有的编号");
    item = cabin.get(entry.id);
    cabin.accessible(item);
    if (move.operation === "remove") cabin.stow(item);
    else {
      const x = move.x === undefined ? entry.x : clampX(entry.kind, move.x),
        y = move.y ?? entry.y;
      const [w, d] = item.props.size;
      const desk =
        entry.kind === "computer" &&
        scene.find((o) => o.kind === "desk" && Math.abs(o.x - x) < 12 && Math.abs(o.y - y) < 30);
      if (desk) cabin.place(item, { parent: desk.id, region: "top" });
      else
        cabin.place(item, {
          parent: "cabin",
          region: "floor",
          x: Math.max(0, Math.min(1000 - w, Math.round(x * 10 - w / 2))),
          y: Math.max(0, Math.min(1000 - d, Math.round(y * 10 - d / 2))),
        });
      const [wx, wy] = cabin.worldXY(item);
      item.art = { kind: entry.kind, dx: x - wx / 10, dy: y - wy / 10 };
    }
    cabin.touch(item);
  }
  syncFurniture(state, cabin);
  return {
    summary: { add: "添置了", remove: "收起了", move: "移动了" }[move.operation] + item.props.name,
    writes: cabin.writes(),
  };
}
function clampX(kind: ObjectKind, x: number) {
  const half = furniture[kind].width / 2;
  return Math.max(half, Math.min(100 - half, x));
}
export function syncFurniture(state: State, cabin: Cabin) {
  state.room = cabin.scene();
  state.cabinVersion = 1;
  if (state.alarms)
    for (const id of Object.keys(state.alarms))
      if (!state.room.some((o) => o.id === id && o.kind === "alarm")) delete state.alarms[id];
}
