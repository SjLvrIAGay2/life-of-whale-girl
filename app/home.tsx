"use client";
import { routes } from "../config/routes.ts";
import { SiteCopy, useSiteCopy } from "./site-copy";
import { numbers } from "../config/numbers";
import { texts } from "../config/texts";
import { links } from "../config/links";
import { formatText } from "../config/options";
import { useEffect, useState, type CSSProperties } from "react";
import { furniture, hourOf, type PublicHome, type RoomItem } from "../content/initial";
import { activityTime, groupRestActivities, readingLevel, sourceNames, type PublicActivity } from "../content/activity";
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
  new Date(t).toLocaleDateString("zh-CN", { timeZone: texts.defaults.timezone, month: "long", day: "numeric" });
const moment = (t: number) =>
  new Date(t).toLocaleString("zh-CN", {
    timeZone: texts.defaults.timezone,
    hour12: false,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const href = (slug: string) => (slug === "home" ? "/" : "/" + slug);
const entry = (a: PublicActivity) => routes.activity + encodeURIComponent(a.id);
// A cached image can finish before hydration attaches Yuki's load handler.
const componentDefaults = { Image: { styles: { img: { opacity: 1 } } } };
function BedsideClock({ item, hour, minute }: { item: RoomItem; hour: number; minute: number }) {
  const copy=useSiteCopy();
  const time = [hour, minute].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <span
      className="furniture room-alarm"
      style={{ left: item.x + "%", top: item.y + "%", width: furniture.alarm.width + "%" }}
      role="img"
      aria-label={formatText(copy.alarmTime, {time})}
    >
      <Image src={links.defaults.roomAssets + "alarm-face.webp"} width="100%" alt="" preview={false} />
      <span className="alarm-hand hour-hand" style={{ transform: `rotate(${(hour % 12) * 30 + minute / 2}deg)` }} />
      <span className="alarm-hand minute-hand" style={{ transform: `rotate(${minute * 6}deg)` }} />
      <span className="alarm-pin" />
    </span>
  );
}
function Room({ home, now }: { home: PublicHome; now: number }) {
  const n=numbers.read(home.config), destinations=links.read(home.config), copy=useSiteCopy();
  const hour = hourOf(now), minute = new Date(now).getUTCMinutes();
  const asleep = home.mode === "asleep",
    night = hour < n.nightEndsHour || hour >= n.nightStartsHour,
    inBed = asleep || home.inBed,
    bed = home.room.find((o) => o.kind === "bed");
  return (
    <Typography as="figure" className="room-print">
      <div className="room-canvas">
        <Flex className="room-scene" role="img" aria-label={copy.roomDescription}>
          <Image
            className="room-bg"
            src={night ? destinations.roomNight : destinations.roomDay}
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
              src={links.defaults.roomAssets + (inBed && o.id === bed?.id ? (asleep?"asleep":"in-bed") : o.kind) + ".webp"}
              alt={inBed && o.id===bed?.id ? (asleep?copy.asleepAlt:copy.inBedAlt) : furniture[o.kind].name}
              width={furniture[o.kind].width + "%"}
              style={{ left: o.x + "%", top: o.y + "%", zIndex: o.kind === "computer" ? 99 : Math.round(o.y) }}
              preview={false}
            />
          ))}
          {(!inBed || !bed) && (
            <Image
              className="furniture resident"
              src={links.defaults.roomAssets + "resident.webp"}
              alt={copy.residentAlt}
              width={n.roomPortraitPercent + "%"}
              preview={false}
            />
          )}
        </Flex>
        {home.cabin && <CabinMarkers items={home.cabin} />}
      </div>
      <Typography as="figcaption">
        <Icon name={night ? "moon" : "sun"} size={15} /> {copy.roomCaption}
      </Typography>
      {!!home.cabin?.length && <CabinInventory items={home.cabin} />}
    </Typography>
  );
}
function logTitle(a: PublicActivity, copy: typeof texts.defaults) {
  const d = a.detail;
  if (d?.kind === "reading") return d.items[0]?.title || a.label;
  if (d?.kind === "draw" && d.title) return d.title;
  if (d?.kind === "game")
    return d.game.kind === "gomoku"
      ? formatText(copy.gomokuTitle, {count:d.game.moves.length})
      : formatText(copy.sokobanTitle, {level:d.game.level});
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
  const copy=useSiteCopy();
  const a = home.activities?.find((a) => a.id === home.currentActivity);
  const when = a ? activityTime(a, home.currentActivity, home.syncedAt, now, home.config) : null;
  return (
    <Stack className="intro" gap="4">
      <Text className="eyeline">{a ? date(a.made) + copy.logSuffix : copy.windowLog}</Text>
      <Title level={1} className="mast-title">
        {title ?? home.name}
      </Title>
      {text && <Paragraph className="intro-line">{text}</Paragraph>}
      {a ? (
        <Link href={entry(a)} className="status-link" underline="none">
          <Icon name="clock" size={17} />
          <Text>
            {when === "现在"
              ? copy.statusNow
              : when === "上次同步时"
                ? copy.statusAtSync
                : when === "刚刚"
                  ? copy.statusRecent
                  : copy.statusPrevious}
            {a.label}。
          </Text>
          <Icon name="arrow-right" size={16} />
        </Link>
      ) : (
        <Text tone="secondary" size="sm">
          {home.syncedAt && now-home.syncedAt>numbers.read(home.config).syncStaleMs ? copy.syncPrefix : ""}{home.activity}。
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
  const copy=useSiteCopy(), n=numbers.read(home.config);
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
                {post.body.slice(0, n.notePreviewChars)}
                {post.body.length > n.notePreviewChars ? "…" : ""}
              </Paragraph>
              <Link href={routes.journal + post.day}>{post.day} · {copy.readPost}</Link>
            </Stack>
          ) : null;
        }
        const selected = b.bind
          ? (home.boundArt ?? home.art).find((a) => b.bind === "art:" + a.id)
          : b.type === "art"
            ? home.art[0]
            : undefined;
        const img = selected ? routes.picture + selected.id : b.bind ? undefined : b.image;
        return (
          <Stack gap="3" className={b.type === "art" ? "pinned-print" : "note"}>
            {heading}
            {img && (
              <Image
                src={img}
                alt={selected?.title ?? b.title ?? copy.residentAlt}
                width="100%"
                fit="contain"
                preview
              />
            )}
            {b.text && <Paragraph>{b.text}</Paragraph>}
            {b.type === "art" && (
              <Text className="caption">
                {selected?.title ?? (img ? copy.portraitCaption : copy.noPublicArt)}
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
              groupRestActivities(list).slice(0, full ? n.archivePageSize : n.homeActivityCount).map((a) => (
                <Link className="log-entry" underline="none" key={a.id} href={entry(a)}>
                  <Text className="log-date">{moment(a.made)}</Text>
                  <Stack gap="1">
                    <Text className="log-title">{logTitle(a,copy)}</Text>
                    {a.detail && (
                      <Text size="sm" tone="secondary">
                        {a.restCount ? formatText(copy.restDuration, {minutes:Math.max(0,Math.floor((Math.min(now,a.until)-a.made)/60000))}) : a.label}
                      </Text>
                    )}
                  </Stack>
                  <Icon name="arrow-right" size={16} />
                </Link>
              ))
            ) : (
              <Paragraph tone="secondary">{copy.emptyLog}</Paragraph>
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
            {reads.slice(0, n.homeBookmarkCount).map((a) => {
              if (a.detail?.kind !== "reading") return null;
              return (
                <Link key={a.id} href={entry(a)}>
                  <Icon name="bookmark" size={15} />
                  {a.detail.items[0]?.title}{" "}
                  <Text size="xs" tone="secondary">
                    {sourceNames[a.detail.source]} · {readingLevel(a.detail.level,copy) ?? copy.bookmarkInfo}
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
              {logTitle(a,copy)} <Icon name="arrow-right" size={16} />
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
                      <Image src={routes.picture + a.id} alt={a.title} preview fit="contain" width="100%" />
                      <Text>{a.title}</Text>
                      <Text className="caption">{date(a.made)}</Text>
                    </Stack>
                  </GridItem>
                ))}
              </Grid>
            ) : (
              <Text tone="secondary">{copy.emptyGallery}</Text>
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
                {w.steps[0]?.url?.startsWith(routes.activity) ?
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
                  <Link href={routes.journal + p.day}>{p.day}</Link>
                  <Paragraph>{p.body}</Paragraph>
                  {p.sources.map((s, i) => (
                    <Link key={i} external href={s.url}>
                      {s.name}
                    </Link>
                  ))}
                </Typography>
              ))
            ) : (
              <Text tone="secondary">{copy.emptyJournal}</Text>
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
  const n=numbers.read(home.config), destinations=links.read(home.config), copy=texts.read(home.config);
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
      }, n.refreshMs - Date.now() % n.refreshMs);
    }
    scheduleRefresh();
    const stream=live && page!=="preview" && typeof EventSource!=="undefined" ? new EventSource(routes.revisions) : null;
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
  }, [page, search, live, initial.revision, n.refreshMs]);
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
    <SiteCopy.Provider value={copy}>
    <ConfigProvider
      locale="zh-CN"
      components={componentDefaults}
      theme={{
        mode: theme.mode,
        primaryColor: theme.primary,
        tokens: {
          "color-bg-canvas": theme.paper,
          "font-family-sans": `"${copy.defaultFont}","Microsoft YaHei UI","PingFang SC",sans-serif`,
          ...(theme.mode === "light"
            ? { "color-text": "#263832", "color-text-secondary": "#53665e", "color-border": "#d3d7cb" }
            : {}),
        },
      }}
    >
      <Typography className="house" style={{ background: theme.paper }}>
        <Container maxWidth={n.siteWidthPx} gutter="5">
          <Flex role="banner" className="mast" justify="between" align="center" wrap gap="3">
            <Link className="brand" underline="none" href={destinations.home}>
              <Image src={destinations.avatar} alt="" width={n.brandImageSizePx} height={n.brandImageSizePx} preview={false} />
              <Text strong>{home.name}</Text>
            </Link>
            <Flex role="navigation" aria-label={copy.navigation} className="nav" gap="4" wrap>
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
                <Link href={destinations.home}>{copy.returnHome}</Link>
                {item ? (
                  <>
                    <Text className="eyeline">
                      {moment(item.made)} · {activityTime(item, home.currentActivity, home.syncedAt, now, home.config)}
                    </Text>
                    <Title level={1}>{item.label}</Title>
                    <ActivityDetail item={item} />
                  </>
                ) : (
                  <Title level={2}>{copy.missingActivity}</Title>
                )}
              </Stack>
            ) : page === "journal" && day && home.posts[0] ? (
              <Stack gap="5" className="detail-page">
                <Link href={destinations.home}>{copy.returnHome}</Link>
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
                    {offset > 0 && <Link href={turnPage(Math.max(offset - n.archivePageSize, 0))}>{copy.prevPage}</Link>}
                    {home.more && <Link href={turnPage(offset + n.archivePageSize)}>{copy.nextPage}</Link>}
                  </Flex>
                )}
              </>
            ) : (
              <Text>{copy.missingPage}</Text>
            )}
          </Typography>
          <Flex role="contentinfo" className="foot" align="center" justify="between" wrap gap="3">
            <Text>{home.name}</Text>
            <Flex gap="4">
              <Link href={destinations.feed}>{copy.feedLabel}</Link>
              <Link href={routes.manage}>{copy.manageLabel}</Link>
            </Flex>
          </Flex>
        </Container>
      </Typography>
    </ConfigProvider>
    </SiteCopy.Provider>
  );
}
function HomePreview({ site, home, slug, now }: { site: Site; home: PublicHome; slug: string; now: number }) {
  const copy=texts.read(home.config);
  const page = site.pages.find((p) => p.slug === slug) ?? site.pages[0];
  return (
    <SiteCopy.Provider value={copy}>
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
    </SiteCopy.Provider>
  );
}
