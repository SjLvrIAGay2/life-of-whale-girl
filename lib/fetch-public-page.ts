import { routes } from "../config/routes.ts";
import { fetchPublicPageErrors } from "../config/texts/errors.ts";
import type { PublicHome } from "../content/initial";
export async function fetchPublicPage(params: URLSearchParams, signal?:AbortSignal): Promise<PublicHome> {
  const response = await fetch(routes.homeData + "?" + params, { cache: "no-store",signal });
  if (!response.ok) throw Error(fetchPublicPageErrors.unavailable);
  return response.json<PublicHome>();
}
