"use client";
import { routes } from "../config/routes.ts";
import { operatorCopy } from "../config/texts/operator";
import { formatText } from "../config/options";
import { numbers } from "../config/numbers.ts";
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
    const response = await fetch(routes.life + op, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json<any>();
    if (!response.ok) throw Error(data.error ?? operatorCopy.requestFailed);
    return data;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : operatorCopy.operationFailed);
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
      <Title level={1}>{preview ? operatorCopy.preview : operatorCopy.desk}</Title>
      <Flex align="end" gap="3" wrap>
        <Input type="password" label={operatorCopy.ownerToken} value={token} onChange={setToken} />
        <Button
          disabled={busy || !token}
          onClick={() =>
            run(async () => {
              await inspect();
              if (preview) await showPreview();
            })
          }
        >
          {operatorCopy.openDesk}
        </Button>
      </Flex>
      {doc && !preview && (
        <Stack gap="4">
          <Textarea label={operatorCopy.layout} rows={13} value={doc} onChange={setDoc} />
          <Flex gap="2" wrap>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("studio", { op: "save", base, document: JSON.parse(doc) });
                  await inspect();
                  setSnapshot(undefined);
                  setMessage(operatorCopy.draftSaved);
                })
              }
            >
              {operatorCopy.saveDraft}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => run(showPreview)}>
              {operatorCopy.previewSaved}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("studio", { op: "publish", base });
                  setMessage(operatorCopy.published);
                })
              }
            >
              {operatorCopy.publish}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("studio", { op: "rollback" });
                  await inspect();
                  setSnapshot(undefined);
                  setMessage(operatorCopy.restored);
                })
              }
            >
              {operatorCopy.undo}
            </Button>
          </Flex>
          <Title level={2}>{operatorCopy.commission}</Title>
          <Textarea label={operatorCopy.idea} value={idea} onChange={setIdea} />
          <Input label={operatorCopy.alias} value={alias} onChange={setAlias} />
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
                setMessage(formatText(operatorCopy.registered,{name:made.registered,example:JSON.stringify(made.example)}));
              })
            }
          >
            {operatorCopy.verify}
          </Button>
          <Textarea label={operatorCopy.catalog} rows={5} readOnly value={catalog} />
          <Title level={2}>{operatorCopy.qqFriends}</Title>
          <Flex gap="3">
            <Button variant="outline" onClick={() => setQqForm(!qqForm)}>
              {operatorCopy.configureBot}
            </Button>
          </Flex>
          {qqForm && (
            <Stack gap="2">
              <Input label={operatorCopy.appId} value={appId} onChange={setAppId} />
              <Input label={operatorCopy.appSecret} type="password" value={secret} onChange={setSecret} />
              <Button
                disabled={busy || !appId || !secret}
                onClick={() =>
                  run(async () => {
                    await call("qq-config", { appId, secret });
                    setSecret("");
                    setQqForm(false);
                    setMessage(operatorCopy.qqSaved);
                  })
                }
              >
                {operatorCopy.saveQQ}
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
              {operatorCopy.pairCode}
            </Button>
            {pair && <Text>{formatText(operatorCopy.sendPair,{code:pair,minutes:numbers.defaults.pairLifetimeMs/60000})}</Text>}
            <Text>{operatorCopy.pairHelp}</Text>
          </Flex>
        </Stack>
      )}
      {message && <Paragraph role="status">{message}</Paragraph>}
      {snapshot?.site && (
        <Stack gap="3">
          <Select
            label={operatorCopy.previewPage}
            value={slug}
            onChange={(s) => s && setSlug(s)}
            options={snapshot.site.pages.map((p) => ({ value: p.slug, label: p.title }))}
          />
          <Select
            label={operatorCopy.previewComponent}
            value={component}
            onChange={(v) => setComponent(v ?? "")}
            options={[
              { value: "", label: operatorCopy.wholePage },
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
