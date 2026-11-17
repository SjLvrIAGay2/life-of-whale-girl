import { chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { readMedia } from "../lib/media";

const passport = "https://passport.bilibili.com";
const [command, file = join(homedir(), ".local/share/whale-home/resident.env")] = process.argv.slice(2);
const headers = { Referer: "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36" };

async function api(url, cookie) {
  const response = await fetch(url, {
    headers: cookie ? { ...headers, Cookie: cookie } : headers,
    redirect: "error", signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error("哔哩哔哩 HTTP " + response.status);
  const { code, data } = await response.json();
  if (code !== 0) throw Error("哔哩哔哩返回 " + code);
  return { data, cookies: response.headers.getSetCookie() };
}

async function login() {
  const endpoint = passport + "/x/passport-login/web/qrcode/";
  const { data } = await api(endpoint + "generate");
  const qr = new URL(data.url);
  if (![passport, "https://account.bilibili.com"].includes(qr.origin) || qr.username || qr.password || !data.qrcode_key)
    throw Error("没有收到官方登录二维码");
  console.log(qr.href);
  const poll = new URL(endpoint + "poll");
  poll.searchParams.set("qrcode_key", data.qrcode_key);
  let scanned = false;
  for (const until = Date.now() + 210000; Date.now() < until;) {
    await delay(2000);
    const result = await api(poll);
    const status = result.data.code;
    if (status === 86101) continue;
    if (status === 86090) {
      if (!scanned) console.error("已扫码，等待在哔哩哔哩 App 确认。");
      scanned = true;
      continue;
    }
    if (status === 86038) break;
    if (status !== 0) throw Error("扫码登录返回 " + status);
    const cookies = new Map();
    const allowed = new Set(["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5", "sid"]);
    for (const header of result.cookies) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      const name = pair.slice(0, index), value = pair.slice(index + 1);
      if (allowed.has(name) && /^[\x21-\x7e]+$/.test(value) && !/[";\\]/.test(value)) cookies.set(name, value);
    }
    if (!cookies.has("SESSDATA")) throw Error("哔哩哔哩没有返回登录会话，请重新扫码");
    const cookie = [...cookies].map(([k, v]) => k + "=" + v).join("; ");
    if (!(await api("https://api.bilibili.com/x/web-interface/nav", cookie)).data.isLogin)
      throw Error("哔哩哔哩未确认登录");
    const original = await readFile(file, "utf8");
    const updated = original.replace(/^(?:export\s+)?BILI_COOKIE=.*(?:\r?\n|$)/gm, "");
    const stage = await mkdtemp(join(dirname(file), ".bili-login-"));
    try {
      const temp = join(stage, "env");
      await writeFile(temp, updated + (updated && !updated.endsWith("\n") ? "\n" : "") + "BILI_COOKIE=" + JSON.stringify(cookie) + "\n", { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, file);
    } finally { await rm(stage, { recursive: true, force: true }); }
    console.error("账号已验证并保存到常驻端。");
    return;
  }
  throw Error("二维码已过期，请重新运行 login");
}

async function check() {
  const { BILI_COOKIE: biliCookie } = parseEnv(await readFile(file, "utf8"));
  for (const action of ["history", "watch_later"]) {
    const result = await readMedia({ source: "bili", action }, { biliCookie });
    console.log(JSON.stringify({ action, status: result.status, itemsOnPage: result.items.length, hasNext: !!(result.nextCursor || result.nextPage) }));
    if (result.status !== "ok") process.exitCode = 1;
  }
}

try {
  if (command === "login") await login();
  else if (command === "check") await check();
  else throw Error("用法：node bili-account.mjs login|check [resident.env]");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
