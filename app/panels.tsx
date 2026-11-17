"use client";
import { useState } from "react";
import type { PublicHome } from "../content/initial";
import type { Site } from "../content/site";
import { Interactive } from "./activity";
import { Button, Flex, Input, Paragraph, Select, Stack, Text, Textarea, Title } from "./yuki";
export function StudioPanel({
  preview,
  render,
}: {
  preview: boolean;
  render: (doc: Site, data: PublicHome, slug: string) => React.ReactNode;
}) {
  const [base, setBase] = useState<string>();
  const [token, setToken] = useState(""),
    [doc, setDoc] = useState(""),
    [idea, setIdea] = useState(""),
    [alias, setAlias] = useState("");
  const [catalog, setCatalog] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState(""),
    [secret, setSecret] = useState(""),
    [qqForm, setQqForm] = useState(false);
  const [component, setComponent] = useState("");
  const [snapshot, setSnapshot] = useState<PublicHome>(),
    [slug, setSlug] = useState("home"),
    [pair, setPair] = useState("");
  async function call(op: string, body?: unknown) {
    const response = await fetch("/api/v1/life/" + op, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json<any>();
    if (!response.ok) throw Error(data.error ?? "请求未完成");
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  }
  async function inspect() {
    const data = await call("studio");
    setBase(data.base);
    setDoc(JSON.stringify(data.site, null, 2));
    setCatalog(JSON.stringify(data.catalog, null, 2));
    return data;
  }
  async function showPreview() {
    const data = await call("studio", { op: "preview" });
    setSnapshot(data.home);
    setComponent(new URLSearchParams(location.search).get("component") ?? "");
  }
  return (
    <Stack gap="5">
      <Title level={1}>{preview ? "预览草稿" : "小站工作桌"}</Title>
      <Flex align="end" gap="3" wrap>
        <Input type="password" label="站主管理令牌" value={token} onChange={setToken} />
        <Button
          disabled={busy || !token}
          onClick={() =>
            run(async () => {
              await inspect();
              if (preview) await showPreview();
            })
          }
        >
          打开工作桌
        </Button>
      </Flex>
      {doc && !preview && (
        <Stack gap="4">
          <Textarea label="版面草稿" rows={13} value={doc} onChange={setDoc} />
          <Flex gap="2" wrap>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("studio", { op: "save", base, document: JSON.parse(doc) });
                  await inspect();
                  setSnapshot(undefined);
                  setMessage("草稿已保存。");
                })
              }
            >
              保存草稿
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => run(showPreview)}>
              预览已保存草稿
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("studio", { op: "publish", base });
                  setMessage("已发布保存的草稿。");
                })
              }
            >
              发布已保存草稿
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("studio", { op: "rollback" });
                  await inspect();
                  setSnapshot(undefined);
                  setMessage("已恢复上一版。");
                })
              }
            >
              撤回发布
            </Button>
          </Flex>
          <Title level={2}>委托制作组件</Title>
          <Textarea label="希望它怎样工作" value={idea} onChange={setIdea} />
          <Input label="修改已有组件时填目录名" value={alias} onChange={setAlias} />
          <Button
            disabled={!idea || busy}
            onClick={() =>
              run(async () => {
                const made = await call("studio", {
                  op: "commission",
                  idea,
                  ...(alias ? { name: alias } : {}),
                });
                await inspect();
                setMessage("已注册到草稿：" + made.registered + "。用法 " + JSON.stringify(made.example));
              })
            }
          >
            制作并验证
          </Button>
          <Textarea label="组件目录" rows={5} readOnly value={catalog} />
          <Title level={2}>QQ 好友</Title>
          <Flex gap="3">
            <Button variant="outline" onClick={() => setQqForm(!qqForm)}>
              设置机器人
            </Button>
          </Flex>
          {qqForm && (
            <Stack gap="2">
              <Input label="QQ AppID" value={appId} onChange={setAppId} />
              <Input label="QQ AppSecret" type="password" value={secret} onChange={setSecret} />
              <Button
                disabled={busy || !appId || !secret}
                onClick={() =>
                  run(async () => {
                    await call("qq-config", { appId, secret });
                    setSecret("");
                    setQqForm(false);
                    setMessage("QQ 机器人配置已保存。");
                  })
                }
              >
                保存 QQ 配置
              </Button>
            </Stack>
          )}
          <Flex align="center" gap="3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const v = await call("qq-pair", {});
                  setPair(v.code);
                })
              }
            >
              生成 QQ 配对口令
            </Button>
            {pair && <Text>QQ 发送「配对 {pair}」，十分钟内有效。</Text>}
          </Flex>
        </Stack>
      )}
      {message && <Paragraph role="status">{message}</Paragraph>}
      {snapshot?.site && (
        <Stack gap="3">
          <Select
            label="预览页面"
            value={slug}
            onChange={(s) => s && setSlug(s)}
            options={snapshot.site.pages.map((p) => ({ value: p.slug, label: p.title }))}
          />
          <Select
            label="预览已注册组件"
            value={component}
            onChange={(v) => setComponent(v ?? "")}
            options={[
              { value: "", label: "整页" },
              ...Object.values(snapshot.site.components).map((p) => ({ value: p.name, label: p.name })),
            ]}
          />
          {component && snapshot.site.components[component] ? (
            <Interactive key={component} program={snapshot.site.components[component]} home={snapshot} />
          ) : (
            render(snapshot.site, snapshot, slug)
          )}
        </Stack>
      )}
    </Stack>
  );
}
