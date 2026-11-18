import type { PublicHome } from "./initial";
import type { PublicActivity, Reading } from "./activity";
import { positionAt, type Move } from "../lib/games.ts";

// The public document contains inert data. Only the renderer chooses React components.
export const libraryCommit = "84cba63c5a729f4fe5d8117a488f70223abf12d3";
export { siteUsage, blockCatalog, programGuide } from "../config/tool-guides/site.ts";
export { defaultSite } from "../config/site.ts";
export type Layout = { span?: number; order?: number };
export type Block = {
  id: string;
  type: string;
  title?: string;
  text?: string;
  image?: string;
  bind?: string;
  desktop?: Layout;
  mobile?: Layout;
  children?: Block[];
};
export type Page = { slug: string; title: string; blocks: Block[] };
export type Part = {
  ui: "Stack" | "Row" | "Title" | "Text" | "Image" | "Board" | "Button" | "Progress";
  text?: string;
  field?: string;
  when?: string;
  step?: number;
  children?: Part[];
};
export type Program = {
  name: string;
  purpose: string;
  bind?: string;
  source: "moves" | "readings" | "art" | "posts";
  start: "first" | "last";
  view: Part;
};
export type Site = {
  theme: { mode: "light" | "dark"; primary: string; paper: string };
  nav: string[];
  pages: Page[];
  components: Record<string, Program>;
};
export function findActivity(home: PublicHome, bind: string | undefined, kind?: PublicActivity["kind"]) {
  const rows = home.activities ?? [];
  if (bind) return rows.find((a) => "activity:" + a.id === bind && (!kind || a.kind === kind));
  return rows.find((a) => !kind || a.kind === kind);
}
export function programRows(p: Program, home: PublicHome, bind?: string): Record<string, string>[] {
  bind ??= p.bind;
  if (p.source === "art")
    return (bind ? (home.boundArt ?? home.art) : home.art)
      .filter((a) => !bind || bind === "art:" + a.id)
      .map((a) => ({ title: a.title, image: "/picture/" + a.id }));
  if (p.source === "posts")
    return (bind ? (home.boundPosts ?? home.posts) : home.posts)
      .filter((a) => !bind || bind === "post:" + a.day)
      .map((a) => ({ day: a.day, body: a.body }));
  if (p.source === "moves") {
    const activity = bind
      ? findActivity(home, bind, "game")
      : (home.activities ?? []).find((a) => a.detail?.kind === "game" && a.detail.game.kind === "gomoku");
    const d = activity?.detail;
    return d?.kind === "game" && d.game.kind === "gomoku" ? d.game.moves.map((m) => ({ ...m })) : [];
  }
  const readings = (home.activities ?? []).filter(
    (a) => a.detail?.kind === "reading" && (!bind || bind === "activity:" + a.id),
  );
  return readings.flatMap((a) =>
    (a.detail as Reading).items.map((i) => ({
      title: i.title,
      body: i.body,
      url: i.url,
      image: i.image ?? "",
    })),
  );
}
export function programFrame(rows: Record<string, string>[], cursor: number, board: boolean) {
  const i = Math.max(0, Math.min(cursor, rows.length - 1));
  return {
    cursor: i,
    fields: { ...rows[i], index: rows.length ? String(i + 1) : "0", count: String(rows.length) } as Record<
      string,
      string
    >,
    board: board ? positionAt(rows as unknown as Move[], i + 1) : undefined,
  };
}
export function siteBindings(site: Site) {
  const pins = new Set<string>();
  function collect(b: Block) {
    if (b.bind) pins.add(b.bind);
    b.children?.forEach(collect);
  }
  site.pages.forEach((p) => p.blocks.forEach(collect));
  Object.values(site.components).forEach((p) => {
    if (p.bind) pins.add(p.bind);
  });
  const values = [...pins];
  const ids = (type: string) =>
    values.filter((v) => v.startsWith(type + ":")).map((v) => v.slice(type.length + 1));
  return { activities: ids("activity"), art: ids("art"), posts: ids("post") };
}
