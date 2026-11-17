import type { PublicHome } from "../content/initial";
export async function fetchPublicPage(params: URLSearchParams, signal?:AbortSignal): Promise<PublicHome> {
  const response = await fetch("/api/v1/life/home?" + params, { cache: "no-store",signal });
  if (!response.ok) throw Error("暂时读不到小屋的公开存档。");
  return response.json<PublicHome>();
}
