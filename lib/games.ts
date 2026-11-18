import { gamesErrors } from "../config/texts/errors.ts";
import { levels, gomoku } from "../config/games.ts";
import { gameRules } from "../config/tool-guides/games.ts";
// Each engine accepts one resident decision and returns the resulting position.
export const gameKinds = ["gomoku", "sokoban"] as const;
export type Move = { cell: string; stone: "黑" | "白"; note?: string; origin?: string };
export type Game = {
  kind: (typeof gameKinds)[number];
  board: string[];
  moves: Move[];
  steps: number;
  level: number;
  result: string;
  feedback: string;
  paused: boolean;
};
export type GameCommand = {
  game: Game["kind"];
  op: "start" | "look" | "move" | "pause" | "resume" | "restart" | "next";
  id?: string;
  move?: string;
  note?: string;
};
const directions: Record<string, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};
const size = gomoku.boardSize;
const cellName = (r: number, c: number) => String.fromCharCode(65 + c) + (r + 1);
export function positionAt(moves: Move[], count: number) {
  const board = Array.from({ length: size }, () => Array<string>(size).fill("."));
  for (const { cell, stone } of moves.slice(0, count)) {
    board[Number(cell.slice(1)) - 1][cell.charCodeAt(0) - 65] = stone === "黑" ? "X" : "O";
  }
  return board.map((row) => row.join(""));
}
function fresh(kind: Game["kind"], level = 1): Game {
  return {
    kind,
    board: engines[kind].board(level),
    level,
    moves: [],
    steps: 0,
    result: "",
    paused: false,
    feedback: engines[kind].opening,
  };
}
function pushBox(g: Game, move: string) {
  const delta = directions[move];
  if (!delta) throw Error(gamesErrors.direction);
  const rows = g.board.map((row) => [...row]);
  const r = rows.findIndex((row) => row.some((cell) => cell === "@" || cell === "+"));
  const c = rows[r].findIndex((cell) => cell === "@" || cell === "+");
  const [dy, dx] = delta,
    y = r + dy,
    x = c + dx,
    next = rows[y]?.[x];
  const box = next === "$" || next === "*";
  const target = rows[y + dy]?.[x + dx];
  if (!next || next === "#" || (box && target !== "." && target !== " ")) {
    g.feedback = box ? "箱子后面没有空位，推不动。" : "前面是墙，留在原地。";
    return;
  }
  if (box) rows[y + dy][x + dx] = target === "." ? "*" : "$";
  rows[y][x] = next === "." || next === "*" ? "+" : "@";
  rows[r][c] = rows[r][c] === "+" ? "." : " ";
  g.board = rows.map((row) => row.join(""));
  g.steps++;
  g.feedback = box ? "箱子向前移了一格。" : "走了一格。";
  if (!g.board.some((row) => row.includes("$"))) g.result = "所有箱子都就位了，过关！";
}
const lines = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
function strength(board: string[], r: number, c: number, stone: string) {
  return lines.reduce((best, [dy, dx]) => {
    let n = 1,
      opens = 0;
    for (const sign of [-1, 1]) {
      let y = r + dy * sign,
        x = c + dx * sign;
      while (board[y]?.[x] === stone) {
        n++;
        y += dy * sign;
        x += dx * sign;
      }
      if (board[y]?.[x] === ".") opens++;
    }
    return Math.max(best, n >= gomoku.winningStones ? gomoku.winScore : opens * gomoku.lineWeight ** n);
  }, 0);
}
function place(g: Game, r: number, c: number, stone: Move["stone"], note?: string) {
  const cell = cellName(r, c),
    mark = stone === "黑" ? "X" : "O";
  g.board[r] = g.board[r].slice(0, c) + mark + g.board[r].slice(c + 1);
  g.moves.push({ cell, stone, ...(note ? { note } : {}) });
  g.steps = g.moves.length;
  if (strength(g.board, r, c, mark) === gomoku.winScore)
    g.result = stone + "方五子连线，" + (stone === "黑" ? "我赢了。" : "对手赢了。");
  else if (g.steps === size ** 2) g.result = "棋盘已满，和棋。";
}
function playStone(g: Game, move: string, note?: string) {
  const cell = move.toUpperCase();
  if (!/^[A-I][1-9]$/.test(cell)) throw Error(gamesErrors.coordinates);
  const r = Number(cell[1]) - 1,
    c = cell.charCodeAt(0) - 65;
  if (g.board[r][c] !== ".") {
    g.feedback = cell + " 已经有棋子，请选空位。";
    return;
  }
  place(g, r, c, "黑", note);
  g.feedback = "黑棋落在 " + cell + "。";
  if (g.result) return;
  let best = -Infinity,
    reply = [0, 0];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (g.board[y][x] !== ".") continue;
      const attack = strength(g.board, y, x, "O"),
        defend = strength(g.board, y, x, "X");
      const score = Math.max(attack * gomoku.attackWeight, defend) - (Math.abs(y - (size-1)/2) + Math.abs(x - (size-1)/2)) * gomoku.centerWeight;
      if (score > best) {
        best = score;
        reply = [y, x];
      }
    }
  place(g, reply[0], reply[1], "白");
  g.feedback += "对手应在 " + cellName(reply[0], reply[1]) + "。";
}
type Engine = {
  title: string;
  rules: string;
  opening: string;
  levels: number;
  board: (level: number) => string[];
  move: (game: Game, choice: string, note?: string) => void;
  legal: (game: Game) => string[];
};
const engines: Record<Game["kind"], Engine> = {
  gomoku: {
    title: "五子棋",
    rules: gameRules.gomoku,
    opening: "你执黑先行，对手执白。",
    levels: 1,
    board: () => positionAt([], 0),
    move: playStone,
    legal: (g) => g.board.flatMap((row, y) => [...row].flatMap((v, x) => v === "." ? [cellName(y, x)] : [])),
  },
  sokoban: {
    title: "推箱子",
    rules: gameRules.sokoban,
    opening: "把所有箱子推到目标点。",
    levels: levels.length,
    board: (level) => [...levels[level - 1]],
    move: pushBox,
    legal: (g) => Object.keys(directions).filter((choice) => {
      const next = structuredClone(g);
      pushBox(next, choice);
      return next.steps !== g.steps;
    }),
  },
};
export const gameCatalog = Object.fromEntries(gameKinds.map((kind) => {
  const {title, rules, levels} = engines[kind];
  return [kind, {title, rules, levels}];
}));
export function legalMoves(g: Game) {
  if (g.result || g.paused) return [];
  return engines[g.kind].legal(g);
}
export function playGame(saved: Game | undefined, command: GameCommand): Game {
  if (command.op === "start") return fresh(command.game);
  if (!saved || saved.kind !== command.game) throw Error(gamesErrors.noSave);
  const g = structuredClone(saved);
  switch (command.op) {
    case "restart":
      return fresh(g.kind, g.level);
    case "next":
      if (!g.result || g.level >= engines[g.kind].levels)
        throw Error(gamesErrors.nextLevel);
      return fresh(g.kind, g.level + 1);
    case "pause":
      g.paused = true;
      g.feedback = "把局面原样存下了。";
      break;
    case "resume":
      g.paused = false;
      g.feedback = "重新打开了这盘存档。";
      break;
    case "look":
      break;
    case "move":
      if (g.result || g.paused) throw Error(g.result || "存档已搁置，需要先 resume");
      engines[g.kind].move(g, command.move ?? "", command.note);
  }
  return g;
}
