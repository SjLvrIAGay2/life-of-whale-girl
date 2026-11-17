import { env } from "cloudflare:workers";
import { createHash, timingSafeEqual } from "node:crypto";
export function same(a: string, b: string) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
export function operator(r: Request) {
  return (
    !!env.WHALE_EDITOR_TOKEN &&
    same(
      r.headers.get("authorization") ?? "",
      "Bearer " + env.WHALE_EDITOR_TOKEN,
    )
  );
}
export function serviceClock(r: Request) {
  return (
    !!env.WHALE_CLOCK_KEY &&
    same(r.headers.get("x-whale-clock") ?? "", env.WHALE_CLOCK_KEY)
  );
}
export function safeOrigin(r: Request) {
  const o = r.headers.get("origin");
  return !o || o === new URL(r.url).origin;
}
export function json(o: unknown, status = 200) {
  return Response.json(o, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function input(r: Request, limit = 24000) {
  if (!r.body) throw Error("缺少请求内容");
  const buffer = await limited(r.body, limit);
  return JSON.parse(new TextDecoder().decode(buffer));
}
export async function limited(
  stream: ReadableStream<Uint8Array>,
  limit: number,
) {
  const reader = stream.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw Error("数据过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}
