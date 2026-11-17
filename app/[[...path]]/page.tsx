import { notFound } from "next/navigation";
import { publicPage } from "../../db";
import { Home } from "../home";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path = [] } = await params,
    [page = "home", id] = path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  if (["journal", "gallery"].includes(page)) q.set("archive", page);
  if (page === "activity" && id) q.set("activity", id);
  if (page === "days") q.set("archive", "activities");
  if (page === "journal" && id) q.set("day", id);
  const data = await publicPage(q);
  const entry =
    path.length === 2 &&
    ((page === "activity" && data.activities?.some((a) => a.id === id)) ||
      (page === "journal" && data.posts.length));
  if (
    !entry &&
    (path.length > 1 ||
      (path.length && page === "home") ||
      (!data.site?.pages.some((p) => p.slug === page) && !["manage", "preview"].includes(page)))
  )
    notFound();
  return <Home initial={data} page={page} day={id} search={q.toString()} renderedAt={Date.now()} />;
}
