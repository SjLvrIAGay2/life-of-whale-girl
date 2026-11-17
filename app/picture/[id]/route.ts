import { one } from "../../../db";
import { assetBytes, communitySticker } from "../../../lib/community-art";
import { operator } from "../../../lib/security";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sticker = communitySticker(id);
  if (sticker)
    return new Response(assetBytes(sticker.data), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" },
    });
  const pic = await one<{ svg: string; png: Uint8Array | number[] | null; scope: string }>(
    "SELECT svg,png,scope FROM drawings WHERE id=?",
    id,
  );
  if (!pic || (pic.scope !== "public" && !operator(req)))
    return new Response(null, { status: 404 });
  return new Response(pic.png ? Uint8Array.from(pic.png) : pic.svg, {
    headers: {
      "Content-Type": pic.png ? "image/png" : "image/svg+xml; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":
        pic.scope === "public" ? "public, max-age=86400" : "private, no-store",
    },
  });
}
