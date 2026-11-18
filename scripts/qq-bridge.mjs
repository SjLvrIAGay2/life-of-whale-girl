import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { readMedia } from "../lib/media.ts";
import { writeFile } from "node:fs/promises";
import { windowsTransport } from "./bridge-http.mjs";
async function record(state, code = 0) {
  if (process.env.WHALE_BRIDGE_STATUS)
    await writeFile(
      process.env.WHALE_BRIDGE_STATUS,
      JSON.stringify({ time: new Date().toISOString(), state, code }),
    ).catch(() => {});
}

export async function runBridge({ origin, access, key }, signal) {
  const site = new URL(origin);
  if (site.protocol !== "https:" || !site.hostname.endsWith(".chatgpt.site"))
    throw Error("需要小站的正式 HTTPS 地址");
  const send =
    process.platform === "win32"
      ? windowsTransport(signal)
      : async (body) => {
          const response = await fetch(
            new URL("/api/v1/life/qq-bridge", site.origin),
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "OAI-Sites-Authorization": "Bearer " + access,
                "x-whale-bridge": key,
              },
              redirect: "error",
              body: JSON.stringify(body),
              signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            },
          );
          if (!response.ok) throw Error("小站状态 " + response.status);
          return response.json();
        };
  const reading = serveReads(send, signal);
  await runQQ(send, signal);
  await reading;
}
export async function runQQ(send, signal) {
  const ready = async () => {
    await record("ready");
    await send({ action: "ready" }).catch(() => {});
  };
  let sequence = null,
    session = null,
    backoff = 2500;
  while (!signal.aborted) {
    try {
      await record("requesting_gateway");
      const transport = await send({ action: "gateway" }),
        gateway = new URL(transport.url);
      if (
        gateway.protocol !== "wss:" ||
        !/(^|\.)(qq\.com|qqbot\.cn)$/.test(gateway.hostname)
      )
        throw Error("不受支持的 QQ 网关");
      await record("connecting");
      await new Promise((resolve) => {
        const ws = new WebSocket(gateway),
          stop = () => ws.close(),
          heartbeat = () => ws.send(JSON.stringify({ op: 1, d: sequence }));
        let timer,
          pending = Promise.resolve(),
          acked = true;
        signal.addEventListener("abort", stop, { once: true });
        ws.onmessage = (e) => {
          let frame;
          try {
            frame = JSON.parse(String(e.data));
          } catch {
            ws.close();
            return;
          }
          // Voice recognition can span heartbeat intervals. Keep dispatches ordered
          // while answering the transport independently of a slow attachment.
          if (frame.op === 11) {
            acked = true;
            if (session) void ready();
            return;
          }
          if (frame.op === 1) {
            heartbeat();
            return;
          }
          pending = pending
            .then(async () => {
              switch (frame.op) {
                case 10:
                  await record("identifying");
                  ws.send(
                    JSON.stringify(
                      session
                        ? {
                            op: 6,
                            d: {
                              token: "QQBot " + transport.token,
                              session_id: session,
                              seq: sequence,
                            },
                          }
                        : {
                            op: 2,
                            d: {
                              token: "QQBot " + transport.token,
                              intents: 1 << 25,
                              shard: [0, 1],
                              properties: {
                                $os: "windows",
                                $browser: "whale-home",
                                $device: "whale-home",
                              },
                            },
                          },
                    ),
                  );
                  timer = setInterval(
                    () => {
                      if (!acked) {
                        ws.close();
                        return;
                      }
                      acked = false;
                      heartbeat();
                    },
                    Math.max(1000, frame.d.heartbeat_interval),
                  );
                  break;
                case 0:
                  if (frame.t === "READY" || frame.t === "RESUMED")
                    await ready();
                  if (frame.t === "READY") {
                    session = frame.d.session_id;
                    backoff = 2500;
                  }
                  if (frame.t === "C2C_MESSAGE_CREATE" || frame.t === "C2C_MESSAGE_RECALL")
                    await send({ action: "event", event: frame });
                  if (Number.isInteger(frame.s)) sequence = frame.s;
                  break;
                case 9:
                  if (!frame.d) {
                    sequence = null;
                    session = null;
                  }
                  ws.close();
                  break;
                case 7:
                  ws.close();
                  break;
              }
            })
            .catch(() => ws.close());
        };
        ws.onclose = (event) => {
          void record("closed", event.code);
          if ([4006, 4007, 4009, 4900].includes(event.code)) {
            session = null;
            sequence = null;
          }
          clearInterval(timer);
          signal.removeEventListener("abort", stop);
          resolve();
        };
        ws.onerror = () => ws.close();
      });
    } catch (e) {
      await record(
        e.message.includes("网关")
          ? "unexpected_gateway"
          : e.message.startsWith("小站状态")
            ? "site_response"
            : "network_unavailable",
        Number(e.message.match(/\d{3}$/)?.[0]) || 0,
      );
    }
    if (!signal.aborted)
      await delay(backoff, undefined, { signal }).catch(() => {});
    backoff = Math.min(60000, backoff * 2);
  }
}
async function serveReads(send, signal) {
  while (!signal.aborted) {
    try {
      const { jobs } = await send({ action: "reads" });
      for (const job of jobs) {
        if (job.request.source !== "bili") continue;
        const observation = await readMedia(job.request, {
          overrides: job.overrides,
          biliCookie: process.env.BILI_COOKIE,
        });
        await send({
          action: "read-result",
          id: job.id,
          created: job.created,
          observation,
        });
      }
    } catch {
      /* Retry reads after network interruptions. */
    }
    await delay(6000, undefined, { signal }).catch(() => {});
  }
}
if (
  process.env.WHALE_SELF_HOSTED !== "1" &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const ctl = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => ctl.abort());
  await runBridge(
    {
      origin: process.env.WHALE_SITE_ORIGIN,
      access: process.env.WHALE_SITE_ACCESS,
      key: process.env.WHALE_BRIDGE_KEY,
    },
    ctl.signal,
  );
}
