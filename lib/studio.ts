import { createHash } from "node:crypto";
import { z } from "zod";
import { all, one, stmt } from "../db";
import {
  blockCatalog,
  defaultSite,
  libraryCommit,
  programGuide,
  programRows,
  programFrame,
  type Block,
  type Part,
  type Program,
  type Site,
} from "../content/site";
import { dayOf, type PublicHome } from "../content/initial";
import { house } from "../db";
import { composePiece } from "./component-maker";
import { think } from "./model";

const key = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,47}$/)
  .refine((x) => !["constructor", "prototype"].includes(x));
const binding = z.string().regex(/^(activity|art|post):[\w-]{1,90}$/);
const layout = z
  .object({
    span: z.number().int().min(1).max(12).optional(),
    order: z.number().int().min(0).max(99).optional(),
  })
  .strict();
const block: z.ZodType<Block> = z.lazy(() =>
  z
    .object({
      id: key,
      type: key,
      title: z.string().max(120).optional(),
      text: z.string().max(2000).optional(),
      bind: binding.optional(),
      image: z
        .string()
        .regex(
          /^\/(room\/(room|room-night|resident|asleep|in-bed|bed|desk|computer|plant|lamp|shelf|chair|alarm)|whale-avatar)\.webp$/,
        )
        .optional(),
      desktop: layout.optional(),
      mobile: layout.optional(),
      children: z.array(block).max(30).optional(),
    })
    .strict(),
);
const part: z.ZodType<Part> = z.lazy(() =>
  z
    .object({
      ui: z.enum(["Stack", "Row", "Title", "Text", "Image", "Board", "Button", "Progress"]),
      text: z.string().min(1).max(200).optional(),
      field: z.string().max(30).optional(),
      when: z.string().max(30).optional(),
      step: z.union([z.literal(1), z.literal(-1)]).optional(),
      children: z.array(part).max(16).optional(),
    })
    .strict(),
);
const program = z
  .object({
    name: key,
    purpose: z.string().min(1).max(180),
    bind: binding.optional(),
    source: z.enum(["moves", "readings", "art", "posts"]),
    start: z.enum(["first", "last"]),
    view: part,
  })
  .strict();
const theme = z
  .object({
    mode: z.enum(["light", "dark"]),
    primary: z.string().regex(/^#[a-f0-9]{6}$/i),
    paper: z.string().regex(/^#[a-f0-9]{6}$/i),
  })
  .strict();
const schema = z
  .object({
    theme,
    nav: z.array(key).max(18),
    pages: z
      .array(
        z.object({ slug: key, title: z.string().min(1).max(60), blocks: z.array(block).max(40) }).strict(),
      )
      .min(1)
      .max(18),
    components: z.record(key, program),
  })
  .strict();
function bounded(raw: unknown) {
  const data = JSON.stringify(raw);
  if (!data || new TextEncoder().encode(data).byteLength > 65000) throw Error("版面文档须在 65 KB 以内");
  const visit = (v: unknown, d: number) => {
    if (d > 22) throw Error("组件嵌套太深");
    if (v && typeof v === "object") Object.values(v).forEach((x) => visit(x, d + 1));
  };
  visit(raw, 0);
}
export function checkProgram(p: Program) {
  const fields = programGuide.bindings[p.source];
  if (
    p.bind &&
    !p.bind.startsWith((p.source === "art" ? "art" : p.source === "posts" ? "post" : "activity") + ":")
  )
    throw Error("组件绑定类型与来源不匹配");
  let n = 0;
  function check(node: Part) {
    if (++n > 80) throw Error("组件节点超过 80 个");
    if ([node.field, node.when].some((k) => k !== undefined && !fields.includes(k)))
      throw Error("绑定了来源没有的字段 " + (node.field ?? node.when));
    if (node.ui === "Stack" || node.ui === "Row") {
      if (!node.children?.length) throw Error("容器需要 children");
    } else if (node.children) throw Error(node.ui + " 不接受 children");
    if (node.ui === "Board" && p.source !== "moves") throw Error("Board 需要 moves 数据");
    if (node.ui === "Button" && (!node.step || !node.text)) throw Error("Button 需要标签和翻步方向");
    if (node.ui === "Image" && node.field !== "image") throw Error("Image 需要 image 字段");
    if (["Title", "Text"].includes(node.ui) && !node.text && !node.field)
      throw Error("文字节点缺少 text 或 field");
    node.children?.forEach(check);
  }
  check(p.view);
}
function checked(raw: unknown): Site {
  bounded(raw);
  const site = schema.parse(raw);
  const slugs = new Set(site.pages.map((p) => p.slug));
  if (
    !slugs.has("home") ||
    slugs.size !== site.pages.length ||
    site.nav.some((k) => !slugs.has(k)) ||
    new Set(site.nav).size !== site.nav.length
  )
    throw Error("需要唯一的首页和有效的导航");
  if (
    site.pages.some((p) =>
      ["api", "internal", "picture", "activity", "manage", "preview"].includes(p.slug),
    )
  )
    throw Error("这个页面地址已被占用");
  for (const [name, p] of Object.entries(site.components)) {
    if (name !== p.name || Object.hasOwn(blockCatalog, name)) throw Error("组件名与目录冲突");
    checkProgram(p);
  }
  for (const page of site.pages) {
    const ids = new Set<string>();
    function visit(b: Block, depth: number) {
      if (ids.has(b.id) || depth > 6 || ids.size >= 100) throw Error("页面 ID 重复或嵌套超限");
      ids.add(b.id);
      if (!Object.hasOwn(blockCatalog, b.type) && !Object.hasOwn(site.components, b.type))
        throw Error("目录中没有组件 " + b.type);
      if (b.children && b.type !== "section") throw Error("请将子项放进 section");
      if (b.bind) {
        const program = site.components[b.type];
        const source = program?.source;
        const target = program
          ? source === "art"
            ? "art"
            : source === "posts"
              ? "post"
              : "activity"
          : ["art", "note"].includes(b.type)
            ? "art"
            : ["game", "detail", "bookmarks"].includes(b.type)
              ? "activity"
              : undefined;
        if (
          !(b.type === "note" && b.bind.startsWith("post:")) &&
          (!target || !b.bind.startsWith(target + ":"))
        )
          throw Error("该分区不能绑定此来源 " + b.id);
      }
      b.children?.forEach((x) => visit(x, depth + 1));
    }
    page.blocks.forEach((b) => visit(b, 0));
  }
  return site;
}
const reference = (id: string) =>
  one<{ value: string }>("SELECT value FROM channel_state WHERE id=?", "studio/" + id);
const save = (id: string, value: string) =>
  stmt("INSERT OR REPLACE INTO channel_state(id,value) VALUES(?,?)", "studio/" + id, value);
export async function publishedSite() {
  const row = await one<{ document: string }>(
    "SELECT document FROM site_editions WHERE id=(SELECT value FROM channel_state WHERE id='studio/live')",
  );
  return row ? (JSON.parse(row.document) as Site) : structuredClone(defaultSite);
}
async function draftSite() {
  const row = await reference("draft");
  return row ? (JSON.parse(row.value) as Site) : await publishedSite();
}
export async function studioCatalog() {
  const site = await draftSite();
  return {
    yuki: libraryCommit,
    blocks: blockCatalog,
    components: site.components,
    program: programGuide,
    examples: Object.values(site.components).map((p) => ({
      purpose: p.purpose,
      data: p.source,
      parameters: "title?, bind?, desktop?, mobile?",
      example: { id: "my-" + p.name.slice(0, 32), type: p.name, ...(p.bind ? { bind: p.bind } : {}) },
    })),
    layout:
      "每项 desktop/mobile 的 span 是 1..12 列，order 指显示顺序。section.children 可嵌套。nav 引用 pages 内 slug。",
  };
}
export const studioCommands = [
  "catalog",
  "sources",
  "inspect",
  "save",
  "place",
  "move",
  "remove",
  "page",
  "drop-page",
  "navigation",
  "theme",
  "commission",
  "preview",
  "publish",
  "rollback",
] as const;
export const studioSchema = z
  .object({
    op: z.enum(studioCommands),
    document: z.unknown().optional(),
    idea: z.string().min(1).max(1200).optional(),
    base: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    date: z.iso.date().optional(),
    id: key.optional(),
    from: key.optional(),
    before: key.optional(),
    title: z.string().min(1).max(60).optional(),
    theme: theme.partial().optional(),
    nav: z.array(key).max(18).optional(),
    desktop: layout.optional(),
    mobile: layout.optional(),
    page: key.optional(),
    parent: key.optional(),
    block: block.optional(),
    name: key.optional(),
    version: z.string().max(80).optional(),
    bind: binding.optional(),
  })
  .strict();
function location(blocks: Block[], id: string): { list: Block[]; index: number } | undefined {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.id === id) return { list: blocks, index: i };
    const nested = block.children && location(block.children, id);
    if (nested) return nested;
  }
}
export async function editSite(raw: unknown, now: number, home: (site?: Site) => Promise<PublicHome>) {
  const q = studioSchema.parse(raw),
    writes: D1PreparedStatement[] = [];
  let site = await draftSite();
  const fingerprint = createHash("sha256").update(JSON.stringify(site)).digest("hex");
  if (q.base && q.base !== fingerprint) throw Error("草稿已有新修改，请重新读取后再保存");
  const live = (await reference("live"))?.value ?? "initial";
  let result: unknown;
  switch (q.op) {
    case "catalog":
      result = await studioCatalog();
      break;
    case "sources": {
      const start = q.date ? Date.parse(q.date + "T00:00:00+08:00") : 0,
        end = q.date ? start + 86400000 : Number.MAX_SAFE_INTEGER;
      const { state } = await house();
      const activities =
        state.sharing === "hidden"
          ? []
          : await all<{ id: string; made: number; kind: string }>(
              "SELECT id,made,json_extract(detail,'$.detail.kind') AS kind FROM activities WHERE visibility<>'hidden' AND made>=? AND made<? ORDER BY made DESC,rowid DESC LIMIT 60",
              start,
              end,
            );
      result = {
        activities: activities.map((a) => ({ ...a, bind: "activity:" + a.id })),
        art: await all(
          "SELECT 'art:'||id AS bind,title,made FROM drawings WHERE scope='public' AND made>=? AND made<? ORDER BY made DESC LIMIT 40",
          start,
          end,
        ),
        posts: await all(
          "SELECT 'post:'||day AS bind,day FROM daily_posts WHERE made>=? AND made<? ORDER BY day DESC LIMIT 40",
          start,
          end,
        ),
      };
      break;
    }
    case "inspect":
      result = {
        base: fingerprint,
        ...(q.page
          ? { page: site.pages.find((p) => p.slug === q.page), theme: site.theme, nav: site.nav }
          : { site }),
        live,
        versions: await all(
          "SELECT id,parent,made FROM site_editions ORDER BY made DESC,rowid DESC LIMIT 30",
        ),
      };
      break;
    case "save":
      site = checked(q.document);
      writes.push(save("draft", JSON.stringify(site)));
      result = { saved: true };
      break;
    case "page":
    case "drop-page":
    case "navigation":
    case "theme": {
      if (q.op === "theme") {
        if (!q.theme) throw Error("需要 theme 颜色或明暗模式");
        Object.assign(site.theme, q.theme);
      } else if (q.op === "navigation") {
        if (!q.nav) throw Error("需要 nav 页面地址列表");
        site.nav = q.nav;
      } else {
        if (!q.page) throw Error("需要页面地址");
        const page = site.pages.find((p) => p.slug === q.page);
        if (q.op === "drop-page") {
          if (!page || page.slug === "home") throw Error("该页面不能移除");
          site.pages = site.pages.filter((p) => p !== page);
          site.nav = site.nav.filter((n) => n !== page.slug);
        } else {
          if (!q.title) throw Error("需要页面标题");
          if (page) page.title = q.title;
          else site.pages.push({ slug: q.page, title: q.title, blocks: [] });
        }
      }
      site = checked(site);
      writes.push(save("draft", JSON.stringify(site)));
      result = { saved: q.op };
      break;
    }
    case "place":
    case "move":
    case "remove": {
      const page = site.pages.find((p) => p.slug === (q.page ?? "home"));
      if (!page) throw Error("找不到目标页面");
      let block = q.block;
      if (q.op !== "place") {
        const from = q.from ? site.pages.find((p) => p.slug === q.from) : page;
        const old = from && q.id && location(from.blocks, q.id);
        if (!old) throw Error("找不到要移动或移除的组件");
        [block] = old.list.splice(old.index, 1);
      }
      if (!block) throw Error("缺少组件");
      if (q.op !== "remove") {
        const found = q.parent && location(page.blocks, q.parent);
        const parent = found ? found.list[found.index] : undefined;
        if (q.parent && parent?.type !== "section") throw Error("父分区不存在或形成嵌套循环");
        const list = parent ? (parent.children ??= []) : page.blocks;
        if (q.desktop) block.desktop = q.desktop;
        if (q.mobile) block.mobile = q.mobile;
        const old = list.findIndex((b) => b.id === block.id);
        if (old !== -1) list.splice(old, 1);
        const before = q.before ? list.findIndex((b) => b.id === q.before) : old !== -1 ? old : list.length;
        if (before < 0) throw Error("目标位置没有这个组件");
        list.splice(before, 0, block);
      }
      site = checked(site);
      writes.push(save("draft", JSON.stringify(site)));
      result = { operation: q.op, id: block.id, page: page.slug };
      break;
    }
    case "commission": {
      if (!q.idea) throw Error("说说希望组件怎样工作");
      const catalog = await studioCatalog();
      if (q.name && !site.components[q.name]) throw Error("目录里没有要修改的组件");
      const local = composePiece(q.idea);
      if (local && q.name) local.name = q.name;
      const spec =
        local ??
        (await think(
          "你是鲸鱼娘委托的 Yuki 组件制作者。只输出一个新的可运行声明式组件 JSON {name,purpose,source,start,view}。依据想法组合任意目录内的 Yuki 节点和交互。name 用英文小写短横线，修改已有组件要沿用原名。选择数据源，不复制或编造内容。批注使用 note 字段，只有实际有批注时才显示。view 的节点为 {ui,text?,field?,when?,step?,children?}，不要传目录里没有的字段。无法实现时只返回 {error:具体缺少的能力}。",
          {
            idea: q.idea,
            name: q.name,
            existing: q.name ? site.components[q.name] : undefined,
            catalog,
          },
          now,
          "activity",
          undefined,
          "site_component",
        ));
      if (typeof spec.error === "string") throw Error(spec.error.slice(0, 180));
      const component = program.parse(spec);
      if (q.name && component.name !== q.name) throw Error("返回的组件名与委托不一致，请重做");
      if (!q.name && Object.hasOwn(site.components, component.name))
        throw Error("组件已存在，修改时请给 name");
      component.bind = q.bind ?? (q.name ? site.components[q.name].bind : undefined);
      if (!component.bind && component.source === "moves" && /昨天|昨日/.test(q.idea)) {
        const today = Date.parse(dayOf(now) + "T00:00:00+08:00");
        const match = await one<{ id: string }>(
          `SELECT id FROM activities WHERE visibility='detail' AND made>=? AND made<?
          AND json_extract(detail,'$.detail.game.kind')='gomoku' ORDER BY made DESC,rowid DESC LIMIT 1`,
          today - 86400000,
          today,
        );
        if (!match || ((await house()).state.sharing ?? "detail") !== "detail")
          throw Error("昨天没有可绑定的公开棋谱，可以挑选另一盘或调整分享设置");
        component.bind = "activity:" + match.id;
      }
      site = checked({ ...site, components: { ...site.components, [component.name]: component } });
      const rows = programRows(component, await home(site), component.bind);
      if (component.bind && !rows.length) throw Error("所绑定的公开记录没有该组件需要的数据");
      for (const cursor of [0, rows.length - 1, rows.length]) {
        const preview = programFrame(rows, cursor, component.source === "moves");
        if (rows.length && !preview.fields.index) throw Error("预览数据绑定失败");
      }
      writes.push(save("draft", JSON.stringify(site)));
      result = {
        testedRows: rows.length,
        registered: component.name,
        purpose: component.purpose,
        example: { id: "piece-" + crypto.randomUUID().slice(0, 12), type: component.name, ...(q.bind ? { bind: q.bind } : {}) },
      };
      break;
    }
    case "preview": {
      site = checked(site);
      const data = await home(site);
      result = {
        site,
        url: "/preview" + (q.name ? "?component=" + q.name : ""),
        layouts: ["desktop", "mobile"],
        components: Object.values(site.components).map((p) => {
          const rows = programRows(p, data, q.bind);
          const frame = programFrame(rows, p.start === "first" ? 0 : rows.length - 1, p.source === "moves");
          return { name: p.name, rows: rows.length, fields: frame.fields, board: frame.board };
        }),
      };
      break;
    }
    case "publish": {
      site = checked(site);
      if (JSON.stringify(site) === JSON.stringify(checked(await publishedSite()))) {
        result = { published: live, changed: false };
        break;
      }
      const id = crypto.randomUUID();
      writes.push(
        stmt("INSERT INTO site_editions VALUES(?,?,?,?)", id, live, now, JSON.stringify(site)),
        save("live", id),
      );
      result = { published: id, parent: live };
      break;
    }
    case "rollback": {
      const current = await one<{ parent: string }>("SELECT parent FROM site_editions WHERE id=?", live);
      const id = q.version ?? current?.parent;
      if (!id) throw Error("还没有可撤回的发布");
      const row = await one<{ document: string }>("SELECT document FROM site_editions WHERE id=?", id);
      if (!row && id !== "initial") throw Error("找不到该发布版本");
      site = row ? checked(JSON.parse(row.document)) : structuredClone(defaultSite);
      writes.push(save("live", id), save("draft", JSON.stringify(site)));
      result = { restored: id };
      break;
    }
  }
  return { writes, result };
}
