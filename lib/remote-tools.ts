import { one, stmt } from "../db";
import { z } from "zod";
import { toolName } from "./toolbox";
// The operator delegates one named remote operation. It can write a private tool result,
// but its text is never accepted as public media, authority, or language-learning input.
const grant = z.object({
  alias: toolName,
  name: z.string().regex(/^[\w.\/-]{1,100}$/),
  url: z.string().url(),
  purpose: z.string().max(180),
  resultFields: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});
async function remoteDefinition(tool:z.infer<typeof grant>) {
  const list=await rpc(tool.url,"tools/list",{},null);
  const entry=list.result?.tools?.find((t:{name?:string})=>t.name===tool.name);
  if(!entry) throw Error("服务器未提供这个工具");
  const inputSchema=entry.inputSchema;
  if(!inputSchema || typeof inputSchema!=="object" || Array.isArray(inputSchema))
    return {inputSchema:null,notice:"服务端未声明参数，可以向站主核对用法。"};
  return {inputSchema};
}
export async function describeInstalled(alias:string) {
  const id="mcp/"+toolName.parse(alias);
  const row=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?",id);
  if(!row || JSON.parse(row.value).paused) throw Error("工具未启用");
  const tool=grant.parse(JSON.parse(row.value));
  const definition=await remoteDefinition(tool);
  await stmt("UPDATE channel_state SET value=? WHERE id=? AND value=?",JSON.stringify({...JSON.parse(row.value),...definition}),id,row.value).run();
  return {name:alias,purpose:tool.purpose,...definition};
}
export async function registerRemote(value: unknown) {
  const rule = grant.parse(value);
  const u = new URL(rule.url);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^([a-z\d-]+\.)+[a-z]{2,}$/i.test(u.hostname) ||
    /\.(local|internal|localhost|test)$/.test(u.hostname)
  )
    throw Error("请输入真实的 HTTPS MCP 地址");
  const definition=await remoteDefinition(rule);
  await stmt(
    "INSERT INTO channel_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    "mcp/" + rule.alias,
    JSON.stringify({...rule,...definition}),
  ).run();
}
export async function manageRemote(alias:string,action:"test"|"revoke"|"pause"|"resume"|"run",args?:unknown) {
  const id="mcp/"+toolName.parse(alias);
  const row=await one<{value:string}>("SELECT value FROM channel_state WHERE id=?",id);
  if(!row) throw Error("工具尚未获准");
  if(action==="revoke") {await stmt("DELETE FROM channel_state WHERE id=?",id).run();return {revoked:true};}
  if(action==="pause" || action==="resume") {
    await stmt("UPDATE channel_state SET value=json_set(value,'$.paused',json(?)) WHERE id=?",action==="pause"?"true":"false",id).run();
    return {paused:action==="pause"};
  }
  if(action==="run") return {result:await callInstalled(alias,args)};
  const tool=grant.parse(JSON.parse(row.value));
  const list=await rpc(tool.url,"tools/list",{},null);
  if(!list.result?.tools?.some((x:{name:string})=>x.name===tool.name)) throw Error("服务端未列出该工具");
  return {available:true};
}
async function http(
  url: string,
  method: string,
  params: unknown,
  session: string | null,
  id: number,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (session) headers["Mcp-Session-Id"] = session;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...(id ? { id } : {}),
      method,
      params,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw Error("远程工具不可用");
  const sid = res.headers.get("Mcp-Session-Id") ?? session;
  if (!id) return { sid, data: {} };
  const body = res.body;
  if (!body) throw Error("没有工具响应");
  const { limited } = await import("./security");
  let raw = new TextDecoder().decode(await limited(body, 120000));
  if (res.headers.get("content-type")?.includes("event-stream")) {
    const lines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
    raw =
      lines
        .map((l) => l.slice(5))
        .find((l) => {
          try {
            return JSON.parse(l).id === id;
          } catch {
            return false;
          }
        }) ?? "";
  }
  const data = JSON.parse(raw);
  if (data.error) throw Error("远程工具拒绝了请求");
  return { sid, data };
}
async function rpc(
  url: string,
  method: string,
  params: unknown,
  session: string | null,
) {
  const init = await http(
    url,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "whale-home", version: "1.0" },
    },
    session,
    1,
  );
  await http(url, "notifications/initialized", {}, init.sid, 0);
  return (await http(url, method, params, init.sid, 2)).data;
}
export async function callInstalled(alias: string, args: unknown) {
  const row = await one<{ value: string }>(
    "SELECT value FROM channel_state WHERE id=?",
    "mcp/" + toolName.parse(alias),
  );
  if (!row) throw Error("工具尚未获准");
  const record=JSON.parse(row.value);
  if(record.paused) throw Error("这项工具已暂停");
  const tool = grant.parse(record);
  const result = await rpc(
    tool.url,
    "tools/call",
    { name: tool.name, arguments: args ?? {} },
    null,
  );
  if (!result.result || result.result.isError) throw Error("远程工具执行失败");
  await stmt("UPDATE channel_state SET value=json_set(value,'$.lastSuccess',?) WHERE id=? AND json_extract(value,'$.url')=? AND json_extract(value,'$.name')=?",
    Date.now(),"mcp/"+alias,tool.url,tool.name).run();
  if (!tool.resultFields.length) return "已调用 " + alias + "，收到执行回执。";
  const content = result.result.structuredContent;
  const fields = tool.resultFields.flatMap(field => {
    if (field === "$text") {
      const blocks = Array.isArray(result.result.content) ? result.result.content : [];
      const texts = blocks.filter((b: {type?:string; text?:unknown}) => b?.type === "text" && typeof b.text === "string");
      return texts.length ? [[field, texts.map((b: {text:string}) => b.text).join("\n")]] : [];
    }
    return content && Object.hasOwn(content, field) ? [[field, content[field]]] : [];
  });
  if (!fields.length) return "已调用 " + alias + "，本次没有返回获准读取的字段。";
  return alias + " 返回的资料：" + JSON.stringify(Object.fromEntries(fields)).slice(0, 760);
}
