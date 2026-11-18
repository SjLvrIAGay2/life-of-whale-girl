import { publicPage } from "../../db";
import { rss } from "../../runtime/public-archive.mjs";
export const dynamic="force-dynamic";
export async function GET(req:Request) {
  const home=await publicPage(new URLSearchParams({archive:"journal"}),true);
  return new Response(rss(home,new URL(req.url).origin),{headers:{"Content-Type":"application/rss+xml; charset=utf-8"}});
}
