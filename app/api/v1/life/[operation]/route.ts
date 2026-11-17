import { env, waitUntil } from "cloudflare:workers";
import { createHash } from "node:crypto";
import {
  publicHome, publicPage,
  all,
  db,
  one,
  stmt,
  currentSetting,
  saveVersion,
  house,
  commit,
  tickLock,
  unlock,
} from "../../../../../db";
import { arrange, recall, processPainting, tick } from "../../../../../lib/life";
import { artProcess, workHistory } from "../../../../../lib/works";
import { diagnostics } from "../../../../../lib/telemetry";
import { synthesize } from "../../../../../lib/speech";
import {
  readWithDesk as readMedia,
  nextReads,
  finishRead,
} from "../../../../../lib/media-bridge";
import {
  configureQQ,
  deliverQQ,
  hasQQ,
  issuePair,
  qqEvent,
  qqToken,
  acceptQQ,
} from "../../../../../lib/qq";
import {
  input,
  json,
  operator,
  safeOrigin,
  serviceClock,
  same,
} from "../../../../../lib/security";
import { recipe, testRecipe, toolName } from "../../../../../lib/toolbox";
import { manageRemote, registerRemote } from "../../../../../lib/remote-tools";
import { compareVersions } from "../../../../../lib/replay";
import { think } from "../../../../../lib/model";
import { publicActivity } from "../../../../../lib/activities";
import { editSite, studioCatalog } from "../../../../../lib/studio";
import { ZodError } from "zod";
import { failureReason } from "../../../../../lib/diagnostics";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ operation: string }> };
function cleanError(ex: unknown) {
  if(ex instanceof ZodError) {const issue=ex.issues[0];return "请检查 "+(issue.path.join(".")||"根节点")+"，"+issue.message.slice(0,180);}
  const text = ex instanceof Error ? ex.message : "请求失败";
  return /^[\u3400-\u9fff\s，。A-Za-z0-9()（），:：._-]{1,90}$/.test(text)
    ? text
    : "操作没有完成";
}
export async function GET(req: Request, c: Ctx) {
  const { operation: op } = await c.params;
  if (op === "home") return json(await publicPage(new URL(req.url).searchParams));
  if(op==="activity") {
    const item=await publicActivity((await house()).state,new URL(req.url).searchParams.get("id")??"");
    return json(item??{error:"没有这次公开活动"},item?200:404);
  }
  if(op==="studio") {
    if(!operator(req)) return json({error:"需要站主凭据"},401);
    return json({catalog:await studioCatalog(),...((await editSite({op:"inspect"},Date.now(),publicHome)).result as object)});
  }
  if(op==="work-history") {
    const u=new URL(req.url), scope="public";
    if(u.searchParams.has("private")) return json({error:"入口不可用"},404);
    if(u.searchParams.has("art")) return json(await artProcess(scope,u.searchParams.get("art")!));
    const steps=await workHistory(scope,u.searchParams.get("id")??"",Number(u.searchParams.get("before"))||Number.MAX_SAFE_INTEGER,33);
    return json({steps:steps.slice(0,32),more:steps.length>32});
  }
  if (op === "admin" && operator(req)) {
    const { state, revision } = await house();
    return json({
      state,
      revision,
      qq: await hasQQ(),
      friends: (
        await all<{ n: number }>(
          "SELECT count(*) n FROM channel_state WHERE id LIKE 'friend/qq-%'",
        )
      )[0].n,
      proposals: (
        await all<{ value: string }>(
          "SELECT value FROM channel_state WHERE id LIKE 'proposal/%' LIMIT 20",
        )
      ).map((x) => JSON.parse(x.value)),
      versions: await all(
        "SELECT id,name,made,parent FROM agent_versions ORDER BY made DESC LIMIT 25",
      ),
      memories: await all(
        "SELECT id,kind,body,made,scope,source FROM memories WHERE scope IN ('self','public') ORDER BY made DESC LIMIT 60",
      ),
      qqReady: await one("SELECT value FROM channel_state WHERE id='qq-ready'"),
      bridge: await one(
        "SELECT value FROM channel_state WHERE id='bridge-health'",
      ),
      clock: await one(
        "SELECT value FROM channel_state WHERE id='clock-health'",
      ),
      model: !!env.WHALE_DEEPSEEK_API_KEY,
      diagnostics:await diagnostics(),
      tools:(await all<{value:string}>("SELECT value FROM channel_state WHERE id LIKE 'mcp/%' ORDER BY id")).map(row=>JSON.parse(row.value)),
    });
  }
  return json({ error: "入口不可用" }, op === "admin" ? 401 : 404);
}
export async function POST(req: Request, c: Ctx) {
  const { operation: op } = await c.params;
  try {
    if (op === "qq") return await qqEvent(req);
    if (!safeOrigin(req)) return json({ error: "来源不匹配" }, 403);
    if (op === "qq-bridge") {
      const key = req.headers.get("x-whale-bridge") ?? "",
        stored = await one<{ value: string }>(
          "SELECT value FROM channel_state WHERE id='bridge-key'",
        );
      if (
        !stored ||
        !same(createHash("sha256").update(key).digest("hex"), stored.value)
      )
        return json({ error: "需要桥接凭据" }, 401);
      const b = await input(req, 88000);
      if (b.action === "ready") {
        await stmt(
          "INSERT OR REPLACE INTO channel_state VALUES('qq-ready',?)",
          String(Date.now()),
        ).run();
        return json({ ok: true });
      }
      if (b.action === "reads") return json({ jobs: await nextReads() });
      if (b.action === "read-result") {
        await finishRead(b.id, b.created, b.observation);
        return json({ ok: true });
      }
      if (b.action === "gateway") {
        await stmt(
          "INSERT OR REPLACE INTO channel_state VALUES('bridge-health',?)",
          String(Date.now()),
        ).run();
      }
      if (b.action === "gateway") {
        if (!(await hasQQ())) return json({ status: "unconfigured" }, 409);
        const token = await qqToken();
        const r = await fetch("https://api.sgroup.qq.com/gateway", {
          headers: { Authorization: "QQBot " + token },
          signal: AbortSignal.timeout(8000),
        });
        if (!r.ok) return json({ error: "无法连接 QQ 网关" }, 502);
        const { url } = await r.json<{ url: string }>();
        return json({ url, token });
      }
      if (b.action === "event") {
        await acceptQQ(b.event);
        return json({ ok: true });
      }
      return json({ error: "未知操作" }, 400);
    }
    if (op === "clock") {
      const dynamicKey = req.headers.get("x-whale-clock") ?? "";
      const stored = dynamicKey
        ? await one<{ value: string }>(
            "SELECT value FROM channel_state WHERE id='clock-key'",
          )
        : null;
      const ok =
        operator(req) ||
        serviceClock(req) ||
        (stored &&
          same(
            stored.value,
            createHash("sha256").update(dynamicKey).digest("hex"),
          ));
      if (!ok) return json({ error: "需要调度凭据" }, 401);
      const result = await tick("clock").finally(() => deliverQQ());
      waitUntil(processPainting().then(()=>deliverQQ()));
      await stmt(
        "INSERT OR REPLACE INTO channel_state VALUES('clock-health',?)",
        JSON.stringify({ time: Date.now(), status: result.status }),
      ).run();
      return json(result);
    }
    if (!["studio","health","clock-key","bridge-key","qq-config","qq-pair","mcp","media","recall","setting","room","name"].includes(op))
      return json({error:"入口不可用"},404);
    if (!operator(req)) return json({ error: "需要站主凭据" }, 401);
    const b = await input(req,op==="studio"?80000:24000);
    if(op==="studio") {
      const now=Date.now(),lock=await tickLock(now);
      if(!lock) return json({error:"常驻端正保存另一个动作，请稍后重试"},409);
      try {
        const {state}=await house();
        const {writes,result}=await editSite(b,now,publicHome);
        if(writes.length) await commit(lock,state,writes);
        if(b.op==="preview") return json({...result as object,home:await publicHome((result as {site:import("../../../../../content/site").Site}).site)});
        return json(result);
      } finally {await unlock(lock);}
    }
    if(op==="health") {
      if(!["model","voice","qq","embedding"].includes(b.probe)) return json({error:"该检查需要在常驻主机运行"},400);
      const began=Date.now();
      let status="ok",detail:string|undefined;
      try {
        if (b.probe === "model") {
          const reply = await think('连通性检查。原样返回用户给出的 JSON 对象 {"ok":true}。保留布尔值。',
            { ok: true }, began, "activity", undefined, "health");
          if (reply?.ok !== true) throw Error("模型响应格式有误");
        }
        if(b.probe==="voice") await synthesize("连通性检查。");
        if(b.probe==="qq") {
          const token=await qqToken(),r=await fetch("https://api.sgroup.qq.com/gateway",{headers:{Authorization:"QQBot "+token},signal:AbortSignal.timeout(9000)});
          if(!r.ok || !String((await r.json<{url:string}>()).url).startsWith("wss://")) throw Error("无法连接网关");
        }
        if(b.probe==="embedding") {
          const vector=await env.WHALE_MEMORY_EMBED?.encode(["本地语义连通性检查"],true);
          if(!vector?.[0]?.length) throw Error("本地语义模型离线");
        }
      }catch(e){status="error";detail=failureReason(e);}
      const result={time:began,status,detail,elapsed:Date.now()-began};
      await stmt("INSERT OR REPLACE INTO channel_state VALUES(?,?)","health/"+b.probe,JSON.stringify(result)).run();
      return json(result);
    }
    if (
      (op === "clock-key" || op === "bridge-key") &&
      typeof b.key === "string" &&
      b.key.length > 32 &&
      b.key.length < 512
    ) {
      await stmt(
        "INSERT OR REPLACE INTO channel_state VALUES(?,?)",
        op,
        createHash("sha256").update(b.key).digest("hex"),
      ).run();
      return json({ ok: true });
    }
    if (op === "qq-config") {
      await configureQQ(String(b.appId), String(b.secret));
      return json({ ok: true });
    }
    if (op === "qq-pair") {
      return json({ code: await issuePair(), expiresIn: 600 });
    }
    if (op === "mcp") {
      if(["test","revoke","pause","resume","run"].includes(b.action)) return json(await manageRemote(b.alias,b.action,b.args));
      await registerRemote(b);
      await stmt(
        "DELETE FROM channel_state WHERE id=?",
        "proposal/" + b.alias,
      ).run();
      return json({ ok: true });
    }
    if (op === "media") {
      return json(
        await readMedia(b, {
          biliCookie: env.BILI_COOKIE,
          heyCookie: env.HEYBOX_COOKIE,
        }),
      );
    }
    if (op === "recall") {
      return json(
        await recall(
          ["public", "self"],
          String(b.cue ?? "").slice(0, 200),
          Date.now(),
        ),
      );
    }
    if (op === "setting") {
      if(b.action==="compare" || b.action==="replay") return json(await compareVersions(b.id,b.action==="replay",b.scenario));
      const name = toolName.parse(b.name);
      if (
        !/^(persona|style|routine|writing|reflection|skill-[\w-]+|tool-[\w-]+)$/.test(
          name,
        )
      )
        throw Error("不能修改该设置");
      const prev = await currentSetting(name);
      let value: string;
      if (b.restore) {
        const old = await one<{ value: string }>(
          "SELECT value FROM agent_versions WHERE id=? AND name=?",
          b.restore,
          name,
        );
        if (!old) throw Error("版本不存在");
        value = old.value;
      } else if (name.startsWith("tool-")) {
        await testRecipe(b.value);
        value = JSON.stringify(recipe.parse(b.value));
      } else {
        if (
          typeof b.value !== "string" ||
          !b.value.trim() ||
          b.value.length > 2000
        )
          throw Error("设定文本长度有误");
        value = b.value.trim();
      }
      await saveVersion(name, value, prev?.id ?? null, Date.now()).run();
      return json({ ok: true });
    }
    if (op === "room" || op === "name") {
      const now = Date.now(),
        token = await tickLock(now);
      if (!token) return json({ error: "鲸鱼娘正忙，请稍后再试" }, 409);
      try {
        const { state } = await house();
        if (op === "room") arrange(state, b);
        else {
          if (
            typeof b.name !== "string" ||
            !b.name.trim() ||
            b.name.length > 40
          )
            throw Error("站名须在四十字以内");
          state.name = b.name.trim();
        }
        await commit(token, state, []);
        return json({ ok: true, room: state.room, name: state.name });
      } finally {
        await unlock(token);
      }
    }
    return json({ error: "未知操作" }, 404);
  } catch (ex) {
    return json({ error: cleanError(ex) }, op === "clock" ? 503 : 400);
  }
}
