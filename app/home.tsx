"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { furniture, hourOf, type PublicHome, type RoomItem } from "../content/initial";
import { activityTime, levelNames, sourceNames, type PublicActivity } from "../content/activity";
import { defaultSite, findActivity, type Block, type Site } from "../content/site";
import { ActivityDetail, Board, Interactive } from "./activity";
import { StudioPanel } from "./panels";
import { fetchPublicPage } from "../lib/fetch-public-page";
import { CabinInventory, CabinMarkers } from "./cabin";
import {
  Button,
  ConfigProvider,
  Container,
  Flex,
  Grid,
  GridItem,
  Icon,
  Image,
  Link,
  Paragraph,
  Stack,
  Text,
  Title,
  Typography,
} from "./yuki";
const date = (t: number) =>
  new Date(t).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
const moment = (t: number) =>
  new Date(t).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const href = (slug: string) => (slug === "home" ? "/" : "/" + slug);
const entry = (a: PublicActivity) => "/activity/" + encodeURIComponent(a.id);
// A cached image can finish before hydration attaches Yuki's load handler.
const componentDefaults = { Image: { styles: { img: { opacity: 1 } } } };
function BedsideClock({ item, hour, minute }: { item: RoomItem; hour: number; minute: number }) {
  const time = [hour, minute].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <span
      className="furniture room-alarm"
      style={{ left: item.x + "%", top: item.y + "%", width: furniture.alarm.width + "%" }}
      role="img"
      aria-label={"床头闹钟，上海时间 " + time}
    >
      <Image src="/room/alarm-face.webp" width="100%" alt="" preview={false} />
      <span className="alarm-hand hour-hand" style={{ transform: `rotate(${(hour % 12) * 30 + minute / 2}deg)` }} />
      <span className="alarm-hand minute-hand" style={{ transform: `rotate(${minute * 6}deg)` }} />
      <span className="alarm-pin" />
    </span>
  );
}
function Room({ home, now }: { home: PublicHome; now: number }) {
  const hour = hourOf(now), minute = new Date(now).getUTCMinutes();
  const asleep = home.mode === "asleep",
    night = hour < 6 || hour >= 18,
    inBed = asleep || home.inBed,
    bed = home.room.find((o) => o.kind === "bed");
  return (
    <Typography as="figure" className="room-print">
      <div className="room-canvas">
        <Flex className="room-scene" role="img" aria-label="鲸鱼娘的小屋，窗外是海，屋内按她的存档陈设">
          <Image
            className="room-bg"
            src={"/room/" + (night ? "room-night" : "room") + ".webp"}
            width="100%"
            height="100%"
            alt=""
            preview={false}
          />
          {home.room.map((o) => o.kind === "alarm" ?
            <BedsideClock key={o.id} item={o} hour={hour} minute={minute} /> : (
            <Image
              key={o.id}
              className="furniture"
              src={"/room/" + (inBed && o.id === bed?.id ? (asleep?"asleep":"in-bed") : o.kind) + ".webp"}
              alt={inBed && o.id===bed?.id ? (asleep?"鲸鱼娘在床上睡觉":"鲸鱼娘醒着，窝在被子里") : furniture[o.kind].name}
              width={furniture[o.kind].width + "%"}
              style={{ left: o.x + "%", top: o.y + "%", zIndex: o.kind === "computer" ? 99 : Math.round(o.y) }}
              preview={false}
            />
          ))}
          {(!inBed || !bed) && (
            <Image
              className="furniture resident"
              src="/room/resident.webp"
              alt="鲸鱼娘"
              width="19%"
              preview={false}
            />
          )}
        </Flex>
        {home.cabin && <CabinMarkers items={home.cabin} />}
      </div>
      <Typography as="figcaption">
        <Icon name={night ? "moon" : "sun"} size={15} /> 我的小屋 · 靠海的窗
      </Typography>
      {!!home.cabin?.length && <CabinInventory items={home.cabin} />}
    </Typography>
  );
}
function logTitle(a: PublicActivity) {
  const d = a.detail;
  if (d?.kind === "reading") return d.items[0]?.title || a.label;
  if (d?.kind === "draw" && d.title) return d.title;
  if (d?.kind === "game")
    return d.game.kind === "gomoku"
      ? "五子棋，第 " + d.game.moves.length + " 手"
      : "推箱子，第 " + d.game.level + " 关";
  return a.label;
}
function Status({
  home,
  now,
  title,
  text,
}: {
  home: PublicHome;
  now: number;
  title?: string;
  text?: string;
}) {
  const a = home.activities?.find((a) => a.id === home.currentActivity);
  const when = a ? activityTime(a, home.currentActivity, home.syncedAt, now) : null;
  return (
    <Stack className="intro" gap="4">
      <Text className="eyeline">{a ? date(a.made) + " · 小屋手记" : "窗边手记"}</Text>
      <Title level={1} className="mast-title">
        {title ?? home.name}
      </Title>
      {text && <Paragraph className="intro-line">{text}</Paragraph>}
      {a ? (
        <Link href={entry(a)} className="status-link" underline="none">
          <Icon name="clock" size={17} />
          <Text>
            {when === "现在"
              ? "我"
              : when === "上次同步时"
                ? "上次同步时，我"
                : when === "刚刚"
                  ? "刚刚，我"
                  : "上回记下时，我"}
            {a.label}。
          </Text>
          <Icon name="arrow-right" size={16} />
        </Link>
      ) : (
        <Text tone="secondary" size="sm">
          {home.syncedAt && now-home.syncedAt>150000 ? "上次同步时，" : ""}{home.activity}。
        </Text>
      )}
    </Stack>
  );
}
function Pages({
  blocks,
  home,
  site,
  now,
  full = false,
}: {
  blocks: Block[];
  home: PublicHome;
  site: Site;
  now: number;
  full?: boolean;
}) {
  const list = home.activities ?? [];
  function content(b: Block) {
    const heading = b.title && (
      <Title level={2} className="section-title">
        {b.title}
      </Title>
    );
    const custom = site.components[b.type];
    if (custom)
      return (
        <Stack gap="4">
          {heading}
          <Interactive program={custom} home={home} bind={b.bind} />
        </Stack>
      );
    switch (b.type) {
      case "room":
        return <Room home={home} now={now} />;
      case "status":
        return <Status home={home} now={now} title={b.title} text={b.text} />;
      case "section":
        return (
          <Stack gap="4">
            {heading}
            <Pages blocks={b.children ?? []} home={home} site={site} now={now} full={full} />
          </Stack>
        );
      case "art":
      case "note": {
        if (b.type === "note" && b.bind?.startsWith("post:")) {
          const post =
            b.bind === "post:latest"
              ? home.posts[0]
              : (home.boundPosts ?? home.posts).find((p) => b.bind === "post:" + p.day);
          return post ? (
            <Stack className="note writing" gap="3">
              {heading}
              <Paragraph>
                {post.body.slice(0, 180)}
                {post.body.length > 180 ? "…" : ""}
              </Paragraph>
              <Link href={"/journal/" + post.day}>{post.day} · 读这篇动态</Link>
            </Stack>
          ) : null;
        }
        const selected = b.bind
          ? (home.boundArt ?? home.art).find((a) => b.bind === "art:" + a.id)
          : b.type === "art"
            ? home.art[0]
            : undefined;
        const img = selected ? "/picture/" + selected.id : b.bind ? undefined : b.image;
        return (
          <Stack gap="3" className={b.type === "art" ? "pinned-print" : "note"}>
            {heading}
            {img && (
              <Image
                src={img}
                alt={selected?.title ?? b.title ?? "鲸鱼娘"}
                width="100%"
                fit="contain"
                preview
              />
            )}
            {b.text && <Paragraph>{b.text}</Paragraph>}
            {b.type === "art" && (
              <Text className="caption">
                {selected?.title ?? (img ? "鲸鱼娘 · 角色画像" : "还没有公开的画作。")}
              </Text>
            )}
          </Stack>
        );
      }
      case "activities": {
        return (
          <Stack gap="3">
            {heading}
            {list.length ? (
              list.slice(0, full ? 48 : 6).map((a) => (
                <Link className="log-entry" underline="none" key={a.id} href={entry(a)}>
                  <Text className="log-date">{moment(a.made)}</Text>
                  <Stack gap="1">
                    <Text className="log-title">{logTitle(a)}</Text>
                    {a.detail && (
                      <Text size="sm" tone="secondary">
                        {a.label}
                      </Text>
                    )}
                  </Stack>
                  <Icon name="arrow-right" size={16} />
                </Link>
              ))
            ) : (
              <Paragraph tone="secondary">手记还空着。</Paragraph>
            )}
          </Stack>
        );
      }
      case "bookmarks": {
        const reads = list.filter(
          (a) => a.detail?.kind === "reading" && a.detail.items.length > 0 &&
            (!a.detail.status || a.detail.status === "ok") && (!b.bind || b.bind === "activity:" + a.id),
        );
        if (!reads.length) return null;
        return (
          <Stack gap="3" className="bookmarks">
            {heading}
            {reads.slice(0, 4).map((a) => {
              if (a.detail?.kind !== "reading") return null;
              return (
                <Link key={a.id} href={entry(a)}>
                  <Icon name="bookmark" size={15} />
                  {a.detail.items[0]?.title}{" "}
                  <Text size="xs" tone="secondary">
                    {sourceNames[a.detail.source]} · {levelNames[a.detail.level] ?? "条目信息"}
                  </Text>
                </Link>
              );
            })}
          </Stack>
        );
      }
      case "detail": {
        const a = findActivity(home, b.bind);
        return a ? (
          <Stack gap="4">
            {heading}
            <ActivityDetail item={a} />
          </Stack>
        ) : null;
      }
      case "game": {
        const a = findActivity(home, b.bind, "game");
        if (!a || a.detail?.kind !== "game") return null;
        return (
          <Stack gap="3">
            {heading}
            <Board
              board={a.detail.game.board}
              chess={a.detail.game.kind === "gomoku"}
              last={a.detail.game.moves.at(-1)?.cell}
            />
            <Link href={entry(a)}>
              {logTitle(a)} <Icon name="arrow-right" size={16} />
            </Link>
          </Stack>
        );
      }
      case "gallery":
        return (
          <Stack gap="5">
            {heading}
            {home.art.length ? (
              <Grid columns={12} gap="5">
                {home.art.map((a) => (
                  <GridItem key={a.id} span={6} responsive={{ md: 4 }}>
                    <Stack gap="2">
                      <Image src={"/picture/" + a.id} alt={a.title} preview fit="contain" width="100%" />
                      <Text>{a.title}</Text>
                      <Text className="caption">{date(a.made)}</Text>
                    </Stack>
                  </GridItem>
                ))}
              </Grid>
            ) : (
              <Text tone="secondary">画册里还没有公开的画。</Text>
            )}
          </Stack>
        );
      case "works":
        return home.objects?.works.length ? (
          <Stack gap="4">
            {heading}
            {home.objects.works.map((w) => (
              <Stack key={w.id} gap="1">
                <Text strong>{w.title}</Text>
                {w.steps[0]?.url?.startsWith("/activity/") ?
                  <Link href={w.steps[0].url}>{w.steps[0].body}</Link> :
                  <Paragraph>{w.steps[0]?.body ?? w.next}</Paragraph>}
              </Stack>
            ))}
          </Stack>
        ) : null;
      case "journal":
        return (
          <Stack gap="4">
            {heading}
            {home.posts.length ? (
              home.posts.map((p) => (
                <Typography as="article" key={p.day} className="journal-line">
                  <Link href={"/journal/" + p.day}>{p.day}</Link>
                  <Paragraph>{p.body}</Paragraph>
                  {p.sources.map((s, i) => (
                    <Link key={i} external href={s.url}>
                      {s.name}
                    </Link>
                  ))}
                </Typography>
              ))
            ) : (
              <Text tone="secondary">还没有写下动态。</Text>
            )}
          </Stack>
        );
    }
  }
  return (
    <Grid columns={12} className="page-grid" align="start">
      {blocks.map((b) => {
        const body = content(b);
        if (!body) return null;
        return (
          <GridItem
            key={b.id}
            span={b.mobile?.span ?? 12}
            responsive={{ md: b.desktop?.span ?? 12 }}
            data-block={b.id}
            className="page-block"
            style={
              {
                "--desk-order": b.desktop?.order ?? 0,
                "--phone-order": b.mobile?.order ?? 0,
              } as CSSProperties
            }
          >
            {body}
          </GridItem>
        );
      })}
    </Grid>
  );
}
export function Home({
  initial,
  page,
  day,
  search,
  renderedAt,
  live = false,
}: {
  initial: PublicHome;
  page: string;
  day?: string;
  search: string;
  renderedAt?: number;
  live?: boolean;
}) {
  const [home, setHome] = useState(initial),
    [now, setNow] = useState(() => renderedAt ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    const ctl = new AbortController();
    let revision=initial.revision;
    async function refresh() {
      setNow(Date.now());
      if (document.hidden || page === "preview") return;
      try {
        const data = await fetchPublicPage(new URLSearchParams(search),ctl.signal);
        if (!ctl.signal.aborted && data.revision>=revision) {
          revision=data.revision;
          setHome(old=>old.revision===data.revision && (old.syncedAt??0)>(data.syncedAt??0)?old:data);
        }
      } catch {
        /* Keep the last public copy, age it on the clock. */
      }
    }
    let timer: ReturnType<typeof setTimeout>;
    function scheduleRefresh() {
      timer = setTimeout(() => {
        void refresh();
        scheduleRefresh();
      }, 30000 - Date.now() % 30000);
    }
    scheduleRefresh();
    const stream=live && page!=="preview" && typeof EventSource!=="undefined" ? new EventSource("/api/v1/life/revisions") : null;
    if(stream) stream.onmessage=message=>{if(Number(message.data)>revision) void refresh();};
    window.addEventListener("online",refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      ctl.abort();
      stream?.close();
      window.removeEventListener("online",refresh);
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [page, search, live, initial.revision]);
  const site = home.site ?? defaultSite,
    item = page === "activity" ? home.activities?.find((a) => a.id === day) : undefined;
  const current = site.pages.find((p) => p.slug === page);
  const params = new URLSearchParams(search),
    offset = Math.max(0, Number(params.get("offset")) || 0);
  const turnPage = (n: number) => {
    const q = new URLSearchParams(params);
    q.set("offset", String(n));
    return href(page) + "?" + q;
  };
  const theme = site.theme;
  return (
    <ConfigProvider
      locale="zh-CN"
      components={componentDefaults}
      theme={{
        mode: theme.mode,
        primaryColor: theme.primary,
        tokens: {
          "color-bg-canvas": theme.paper,
          "font-family-sans": '"DM Sans","Microsoft YaHei UI","PingFang SC",sans-serif',
          ...(theme.mode === "light"
            ? { "color-text": "#263832", "color-text-secondary": "#53665e", "color-border": "#d3d7cb" }
            : {}),
        },
      }}
    >
      <Typography className="house" style={{ background: theme.paper }}>
        <Container maxWidth={1232} gutter="5">
          <Flex role="banner" className="mast" justify="between" align="center" wrap gap="3">
            <Link className="brand" underline="none" href="/">
              <Image src="/whale-avatar.webp" alt="" width={37} height={37} preview={false} />
              <Text strong>{home.name}</Text>
            </Link>
            <Flex role="navigation" aria-label="小站导航" className="nav" gap="4" wrap>
              {site.nav.map((id) => (
                <Link
                  key={id}
                  href={href(id)}
                  underline="none"
                  aria-current={page === id ? "page" : undefined}
                >
                  {site.pages.find((p) => p.slug === id)?.title}
                </Link>
              ))}
            </Flex>
          </Flex>
          <Typography as="main" className={"main " + (page === "home" ? "front" : "inside")}>
            {page === "manage" || page === "preview" ? (
              <StudioPanel
                preview={page === "preview"}
                render={(draft, draftHome, slug) => (
                  <HomePreview site={draft} home={draftHome} slug={slug} now={now} />
                )}
              />
            ) : page === "activity" ? (
              <Stack gap="5" className="detail-page">
                <Link href="/">返回小屋</Link>
                {item ? (
                  <>
                    <Text className="eyeline">
                      {moment(item.made)} · {activityTime(item, home.currentActivity, home.syncedAt, now)}
                    </Text>
                    <Title level={1}>{item.label}</Title>
                    <ActivityDetail item={item} />
                  </>
                ) : (
                  <Title level={2}>这次活动已经收起来了。</Title>
                )}
              </Stack>
            ) : page === "journal" && day && home.posts[0] ? (
              <Stack gap="5" className="detail-page">
                <Link href="/">返回小屋</Link>
                <Title level={1}>{home.posts[0].day}</Title>
                <Paragraph className="excerpt">{home.posts[0].body}</Paragraph>
                {home.posts[0].sources.map((s, i) => (
                  <Link key={i} external href={s.url}>
                    {s.name}
                  </Link>
                ))}
              </Stack>
            ) : current ? (
              <>
                <Pages blocks={current.blocks} home={home} site={site} now={now} full={page !== "home"} />
                {["journal", "gallery", "days"].includes(page) && !day && (
                  <Flex gap="4" className="pager">
                    {offset > 0 && <Link href={turnPage(Math.max(offset - 24, 0))}>上一页</Link>}
                    {home.more && <Link href={turnPage(offset + 24)}>下一页</Link>}
                  </Flex>
                )}
              </>
            ) : (
              <Text>这个页面已收起。</Text>
            )}
          </Typography>
          <Flex role="contentinfo" className="foot" align="center" justify="between" wrap gap="3">
            <Text>{home.name}</Text>
            <Flex gap="4">
              <Link href="/feed.xml">RSS</Link>
              <Link href="/manage">小站管理</Link>
            </Flex>
          </Flex>
        </Container>
      </Typography>
    </ConfigProvider>
  );
}
function HomePreview({ site, home, slug, now }: { site: Site; home: PublicHome; slug: string; now: number }) {
  const page = site.pages.find((p) => p.slug === slug) ?? site.pages[0];
  return (
    <ConfigProvider
      global={false}
      theme={{
        mode: site.theme.mode,
        primaryColor: site.theme.primary,
        tokens: { "color-bg-canvas": site.theme.paper },
      }}
    >
      <Typography className="preview-surface" style={{ background: site.theme.paper }}>
        <Pages blocks={page.blocks} home={home} site={site} now={now} />
      </Typography>
    </ConfigProvider>
  );
}
