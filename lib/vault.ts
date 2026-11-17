import { env } from "cloudflare:workers";
const base64 = (v: ArrayBuffer | Uint8Array) =>
  Buffer.from(v as Uint8Array).toString("base64");
async function key() {
  if (!env.WHALE_EDITOR_TOKEN) throw Error("站主密钥未配置");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("whale/qq/v1/" + env.WHALE_EDITOR_TOKEN),
    ),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(s: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return (
    base64(iv) +
    "." +
    base64(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        await key(),
        new TextEncoder().encode(s),
      ),
    )
  );
}
export async function openSecret(s: string) {
  const [a, b] = s.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(a, "base64") },
      await key(),
      Buffer.from(b, "base64"),
    ),
  );
}
