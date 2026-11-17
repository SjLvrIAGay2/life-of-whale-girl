"use client";
import { useState } from "react";
import type { PublicHome } from "../content/initial";
import { readingOutcome, sourceNames, videoPart, type PublicActivity } from "../content/activity";
import { programFrame, programRows, type Part, type Program } from "../content/site";
import { Button, Flex, Grid, Icon, Image, Link, Paragraph, Progress, Stack, Text, Title } from "./yuki";

const cols = "ABCDEFGHI";
const tiles: Record<string, string> = {
  "#": "墙",
  "@": "人",
  "+": "人在目标点",
  $: "箱",
  ".": "目标",
  "*": "已到位",
  " ": "地板",
};
export function Board({ board, chess, last }: { board: string[]; chess: boolean; last?: string }) {
  return (
    <Grid
      columns={(board[0]?.length || 1) + (chess ? 1 : 0)}
      gap="0"
      className={"board " + (chess ? "chess" : "boxes")}
      role="img"
      aria-label={(chess ? "五子棋棋盘" : "推箱子局面") + " " + board.join(" / ")}
    >
      {chess &&
        ["", ...cols].map((col, i) => (
          <Text className="axis" key={"col" + i}>
            {col}
          </Text>
        ))}
      {board.flatMap((row, r) => [
        ...(chess
          ? [
              <Text className="axis" key={"row" + r}>
                {r + 1}
              </Text>,
            ]
          : []),
        ...[...row].map((v, c) => {
          const pos = String.fromCharCode(65 + c) + (r + 1);
          return (
            <Text
              key={pos}
              title={pos + " " + (chess ? ({ X: "黑棋", O: "白棋" }[v] ?? "空位") : tiles[v])}
              data-piece={chess ? v : tiles[v]}
              data-last={pos === last || undefined}
              className="tile"
            >
              {chess
                ? v === "X"
                  ? "●"
                  : v === "O"
                    ? "○"
                    : "·"
                : ({ "#": "▧", $: "□", "@": "我", "*": "▣", "+": "我", ".": "·" }[v] ?? " ")}
            </Text>
          );
        }),
      ])}
    </Grid>
  );
}
export function ActivityDetail({ item }: { item: PublicActivity }) {
  const e = item.detail;
  if (!e) return <Paragraph tone="secondary">这次只留了一句状态。</Paragraph>;
  return (
    <Stack gap="4">
      {e.kind === "draw" && e.art && e.title && (
        <Stack gap="2"><Text strong>{e.title}</Text><Image src={"/picture/"+e.art} alt={e.title} fit="contain" width="100%" preview /></Stack>
      )}
      {e.kind === "game" && (
        <>
          <Board board={e.game.board} chess={e.game.kind === "gomoku"} last={e.game.moves.at(-1)?.cell} />
          <Flex gap="3" wrap>
            <Text strong>
              {e.game.kind === "gomoku"
                ? "五子棋 · " + e.game.moves.length + " 手"
                : "推箱子 · 第 " + e.game.level + " 关"}
            </Text>
            <Text tone="secondary">
              {e.game.result ||
                (e.game.paused
                  ? "已搁置"
                  : e.game.kind === "gomoku"
                    ? "轮到黑棋（鲸鱼娘）"
                    : "已走 " + e.game.steps + " 步")}
            </Text>
          </Flex>
          <Paragraph>
            {e.input && (
              <Text strong>
                {e.game.kind === "gomoku"
                  ? "我选了 " + e.input
                  : "我试着向" +
                    ({ left: "左", right: "右", up: "上", down: "下" }[e.input] ?? e.input) +
                    "走"}
                。{" "}
              </Text>
            )}
            {e.game.feedback}
          </Paragraph>
          {e.game.moves.length > 0 && (
            <Text size="sm">
              最近一手　{e.game.moves.at(-1)?.stone}棋 {e.game.moves.at(-1)?.cell}
            </Text>
          )}
        </>
      )}
      {e.kind === "reading" && (
        <>
          <Text className="eyeline">
            {sourceNames[e.source]}　/　{readingOutcome(e)}
            {e.page &&
              (videoPart(e)
                ? "　·　第 " + e.page + " P"
                : "　·　第 " + e.page + " 页")}
            {e.offset !== undefined && ["subtitles", "storyboard_viewed"].includes(e.level)
              ? "　·　第 " + (e.offset + 1) + (e.nextOffset && e.nextOffset > e.offset + 1 ? "–" + e.nextOffset : "") + (e.level === "subtitles" ? " 句" : " 张") + (e.atEnd ? "（末尾）" : "")
              : ""}
          </Text>
          {e.coverage && <Text size="sm" tone="secondary">{e.coverage}</Text>}
          {e.filteredCount !== undefined && <Text size="sm" tone="secondary">本页按昵称及回复数过滤了 {e.filteredCount} 条评论。</Text>}
          {e.action === "archive" && (
            <Text size="sm" tone="secondary">
              旧站留下的阅读书签
            </Text>
          )}
          {e.items.map((i, index) => (
            <Stack gap="2" key={i.id + "-" + index}>
              <Link className="source-title" href={i.url} external>
                {i.title || i.id}
              </Link>
              {i.body && (!e.status || e.status === "ok") && <Paragraph className="excerpt">{i.body}</Paragraph>}
              {i.image && <Image alt={i.title} src={i.image} fit="contain" width="100%" preview />}
            </Stack>
          ))}
          {!!e.comments?.length && (
            <Stack gap="2">
              <Text strong>读到的讨论</Text>
              {e.comments.map((c) => (
                <Paragraph key={c.id} className="quote">
                  <Text size="xs">#{c.id}　</Text>
                  {c.text}
                </Paragraph>
              ))}
            </Stack>
          )}
        </>
      )}
      {"description" in e && <Paragraph>{e.description}。</Paragraph>}
      {item.remark && <Paragraph className="personal-note">「{item.remark}」</Paragraph>}
    </Stack>
  );
}
export function Interactive({ program, home, bind }: { program: Program; home: PublicHome; bind?: string }) {
  const rows = programRows(program, home, bind);
  const [cursor, setCursor] = useState(program.start === "first" ? 0 : Math.max(0, rows.length - 1));
  if (!rows.length) return <Text tone="secondary">这件作品还没有可展示的公开记录。</Text>;
  const frame = programFrame(rows, cursor, program.source === "moves");
  function render(p: Part, key: string): React.ReactNode {
    if (p.when && !frame.fields[p.when]) return null;
    const children = p.children?.map((c, i) => render(c, key + "-" + i)),
      value = p.field ? frame.fields[p.field] : p.text;
    switch (p.ui) {
      case "Row":
        return (
          <Flex key={key} align="center" gap="3" wrap>
            {children}
          </Flex>
        );
      case "Stack":
        return (
          <Stack key={key} gap="3">
            {children}
          </Stack>
        );
      case "Title":
        return (
          <Title level={3} key={key}>
            {value}
          </Title>
        );
      case "Text":
        return <Paragraph key={key}>{value}</Paragraph>;
      case "Image":
        return value ? (
          <Image key={key} src={value} alt={frame.fields.title || ""} fit="contain" width="100%" preview />
        ) : null;
      case "Board":
        return <Board key={key} board={frame.board!} chess last={frame.fields.cell} />;
      case "Progress":
        return <Progress key={key} value={frame.cursor + 1} max={rows.length} label="浏览进度" />;
      case "Button": {
        const target = frame.cursor + (p.step ?? 0);
        return (
          <Button
            key={key}
            disabled={target < 0 || target >= rows.length}
            variant="outline"
            onClick={() => setCursor(target)}
          >
            {p.text}
          </Button>
        );
      }
    }
  }
  return (
    <Stack aria-label={program.purpose} className="interactive" gap="2">
      {render(program.view, "root")}
    </Stack>
  );
}
