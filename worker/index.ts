import { routes } from "../config/routes.ts";
import handler from "vinext/server/fetch-handler";
function migrationOrigin(value?: string) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.href === url.origin + "/") return url.origin;
  } catch { return; }
}

export default {
  async fetch(req: Request, bindings: Cloudflare.Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    const destination = migrationOrigin(bindings.WHALE_MOVED_ORIGIN);
    if (destination && destination !== url.origin) {
      if(url.pathname==="/inbox" || (url.pathname.startsWith("/api/") &&
          ![routes.homeData,routes.activityData,routes.workHistory].includes(url.pathname))) {
        return new Response(null,{status:410});
      }
      if (req.method === "GET" || req.method === "HEAD") {
        return Response.redirect(
          destination + url.pathname + url.search,
          302,
        );
      }
      return Response.json(
        {
          error: "小站已迁移，请在新的小站打开对应页面。",
          site: destination,
        },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    }
    return handler.fetch(req, bindings, ctx);
  },
};
