import { cabinModelErrors } from "../config/texts/errors.ts";
import { builtinDefinitions } from "../config/objects";
import { z } from "zod";
import type { ObjectKind, RoomItem } from "../content/initial";
import { objectRecipe } from "./toolbox";
import { gameKinds } from "./games";

export const key = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,47}$/, "编号用小写字母开头，可含小写字母、数字、短横线或下划线，最多 48 个字符")
  .refine((k) => !Object.hasOwn(Object.prototype, k), "编号是保留字");
export const itemId = z.string().min(1).max(240);
const measure = z.number().positive().max(2000);
export const size = z.tuple([measure, measure, measure]);
export const turnAngle = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export const visibility = z.enum(["detail", "summary", "hidden"]);
const modes = ["on", "inside", "hang", "part", "installed"] as const;
export const regionSchema = z.discriminatedUnion("relation", [
  z
    .object({
      label: z.string().min(1).max(80),
      relation: z.enum(["on", "inside", "hang", "part"]),
      size,
      loadG: z.number().nonnegative(),
      capacityCm3: z.number().positive().optional(),
      opening: z.tuple([measure, measure]).optional(),
      gate: key.optional(),
    })
    .strict(),
  z
    .object({
      label: z.string().min(1).max(80),
      relation: z.literal("installed"),
      capacityMB: z.number().positive(),
    })
    .strict(),
]);
export const regionList = z.record(key, regionSchema);
const safeDataKey = z
  .string()
  .min(1)
  .max(80)
  .refine((k) => !Object.hasOwn(Object.prototype, k) && k !== "prototype");
export const data = z
  .record(safeDataKey, z.json())
  .refine((v) => JSON.stringify(v).length <= 24000, "对象状态超过 24000 字符");
export const capabilities = [
  "bili",
  "heybox",
  "browser",
  "website",
  "open",
  "close",
  "game",
  "work",
  "picture",
] as const;
export const behaviorSchema = z.union([
  z
    .object({ capability: z.enum(capabilities), game: z.enum(gameKinds).optional() })
    .strict()
    .refine((b) => !b.game || b.capability === "game", "只有游戏能力接收 game"),
  z.object({ recipe: objectRecipe, input: z.enum(["none", "text", "integer"]).default("none") }).strict(),
]);
export type Behavior = z.infer<typeof behaviorSchema>;
const baseProperties = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(320),
    color: z.string().max(48),
    size,
    massG: z.number().nonnegative().max(1e9),
    volumeCm3: z.number().positive().optional(),
    installMB: z.number().positive().max(1e9).optional(),
    rotations: z.array(turnAngle).min(1).max(4),
    consumable: z.boolean(),
  })
  .strict();
export const propertyPatch = baseProperties.partial();
export const properties = baseProperties.extend({
  description: baseProperties.shape.description.default(""),
  color: baseProperties.shape.color.default("原色"),
  rotations: baseProperties.shape.rotations.default([0, 90]),
  consumable: z.boolean().default(false),
});
export const definition = properties.extend({
  regions: regionList.default({}),
  state: data.default({}),
  actions: z.record(key, behaviorSchema).default({}),
  contents: z
    .array(
      z.object({ type: key, region: key, count: z.number().int().positive().max(256).default(1) }).strict(),
    )
    .max(32)
    .default([]),
});
export type Definition = z.infer<typeof definition>;
export type Properties = z.infer<typeof properties>;
export type Region = z.infer<typeof regionSchema>;
export type Regions = Record<string, Region>;
export type Angle = z.infer<typeof turnAngle>;
export type Location = { parent: string; region: string; x: number; y: number; rotation: Angle };
export const destination = z
  .object({
    parent: itemId,
    region: key,
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    rotation: turnAngle.optional(),
  })
  .strict()
  .refine((p) => (p.x === undefined) === (p.y === undefined), "请同时指定 x 和 y，或都留空让小屋找位置");
export type Destination = z.infer<typeof destination>;
export type Item = {
  id: string;
  type: string;
  props: Properties;
  regions: Regions;
  state: z.infer<typeof data>;
  actions: Record<string, Behavior>;
  versions: Record<string, string>;
  refs: string[];
  at: Location | null;
  visibility: z.infer<typeof visibility>;
  art?: { kind: ObjectKind; dx: number; dy: number };
  importedFurniture?: RoomItem;
  createdGame?: true;
  source?: { kind: "work" | "picture" | "game"; id: string; scope: string; title?: string };
};
export type PublicItem = {
  id: string;
  name: string;
  color: string;
  description?: string;
  size?: Properties["size"];
  marker?: { x: number; y: number };
  at?: Pick<Location, "parent" | "region"> &
    Partial<Pick<Location, "x" | "y" | "rotation">> & { label: string; relation: (typeof modes)[number] };
  closed?: boolean;
};

export const boxVolume = ([w, d, h]: Properties["size"]) => w * d * h;
export const volume = (props: Properties) => props.volumeCm3 ?? boxVolume(props.size);
export function checkDimensions(props: Properties, regions: Regions) {
  if (volume(props) > boxVolume(props.size) + 1e-8) throw Error(cabinModelErrors.excessVolume);
  for (const r of Object.values(regions))
    if (r.relation !== "installed") {
      if (r.relation === "inside" && r.size.some((n, i) => n > props.size[i]))
        throw Error(r.label + "的内部净尺寸超过物品外部尺寸");
      if (r.capacityCm3 !== undefined && r.capacityCm3 > boxVolume(r.size) + 1e-8)
        throw Error(r.label + "的容积超过区域尺寸");
    }
}

export function instantiate(id: string, type: string, def: Definition): Item {
  const { regions, state, actions, contents: _, ...props } = structuredClone(def);
  return { id, type, props, regions, state, actions, versions: {}, refs: [], at: null, visibility: "detail" };
}

export const builtins: Record<string, Definition> = Object.fromEntries(
  Object.entries(builtinDefinitions).map(([name, raw]) => [name, definition.parse(raw)]),
);
