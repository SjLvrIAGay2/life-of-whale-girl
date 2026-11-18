import type { Command, Input } from "../../lib/cabin";

export const guides = {
  catalog: { example: { op: "catalog", query: "糖" }, tip: "用 query 找名字，type 选一种物品，parent 只看指定容器里的物品。结果在 items，挑中后复制它的 id。翻下一页把 nextOffset 填入 offset。" },
  inspect: { example: { op: "inspect", id: "sill" }, tip: "查看位置、可用区域和动作。想改写某个动作，加上动作名 action 看它的做法。" },
  type: { example: { op: "type", type: "box" }, tip: "查看这种物品的定义，可用作新类型的起点。" },
  help: { example: { op: "help", command: "move" }, tip: "command 查操作，capability 查能力。" },
  define: { example: { op: "define", type: "mint", definition: { name: "薄荷糖", size: [1.3, 1, 1], massG: 2, consumable: true } },
    tip: [
      "给这类物品起一个以小写字母开头的 type。在 definition 写名字 name、宽深高 size（厘米）和自重 massG（克）。定义一次，以后用 create 做出每一件。",
      "按需加属性。description 写描述，color 写颜色，consumable 表示可以吃。volumeCm3 填体积，rotations 列出允许转动的角度。state 写初始状态，actions 写能做的动作。",
      "要做容器，先用 type 查看 box 的定义。regions 里每个区域都有名称 label 和用途 relation。on 是表面，inside 是内腔，hang 是挂位，part 是部件位。size 是净尺寸，opening 是开口的宽和高，loadG 是承重，capacityCm3 是可用容积。要让新盒里自带东西，在 contents 每项填 type、region 和 count。",
      "要装软件，可以照着 phone 的定义做。安装位的 relation 填 installed，用 capacityMB 写容量，每个软件用 installMB 写所占空间。",
    ].join("\n") },
  defaults: { example: { op: "defaults", type: "box", patch: { color: "浅蓝" } }, tip: "patch 填要改的定义项，新做的物品会采用这些值。" },
  create: { example: { op: "create", type: "box", to: { parent: "sill", region: "top" } }, tip: "填 to 可以直接摆好。省略 to 时物品先收着。" },
  update: { example: { op: "update", id: "desk", props: { color: "浅棕" } }, tip: "只改 id 选中的这一件。props 填属性，也可改 state、regions 或 refs。若要改变访客能看到什么，visibility 选 detail（位置及可见内容）、summary（名称和所在区域）或 hidden（整件藏起）。" },
  find: { example: { op: "find", id: "computer", to: { parent: "desk", region: "top" } }, tip: "询问能放下的位置。物品留在原处。" },
  move: { example: { op: "move", id: "computer", to: { parent: "desk", region: "top" } }, tip: "小屋会找空位。指定位置时在 to 填 x、y（厘米），可加 rotation（0、90、180、270 度）。放不下时物品留在原处。" },
  stow: { example: { op: "stow", id: "computer" }, tip: "连同里边的东西一起收起。" },
  remove: { example: { op: "remove", id: "物品编号" }, tip: "移除一件已清空、也没有被其他物品引用的物品。" },
  consume: { example: { op: "consume", parent: "糖盒编号", region: "inside", type: "mint", count: 2 }, tip: "一次取用这个区域里指定数量的同类食品。" },
  call: { example: { op: "call", id: "website", action: "open" }, tip: "选择物品列出的动作，需要的参数放在 args。" },
  preview: { example: { op: "preview", id: "棋盘编号", action: "review",
    behavior: { input: "integer", recipe: { description: "按手数看棋谱", steps: [{ op: "replay" }] } }, args: { input: 1 } },
    tip: [
      "用 id 选物品，在 action 给新动作起名。借用现成能力时，在 behavior 填 capability。要像样例那样组合自己的步骤，就填 recipe，按执行顺序写 steps。input 可选 none（无参数）、text（文字）或 integer（非负整数）。",
      "想给物品记事，用 state.append 在 key 指定的字段追加 text，再用 state.get 按 key 读回。想看棋谱，用 replay 读取 args.input 指定的那一手。",
      "读内容用 read，选 source（bili 或 heybox），可加 query。取前几项用 take 填 count，拼接用 join 填 separator，配文用 caption 填 text，画画用 draw 填 idea。文字里可用 $input 引用输入、$result 引用上一步的结果。",
      "先看回执里的 result。满意后，把同一回执的 next 原样发出即可启用。",
    ].join("\n") },
  activate: { example: { op: "activate", id: "棋盘编号", action: "review", preview: "试跑编号" }, tip: "填试跑返回的 preview，下一次使用即生效。" },
  rollback: { example: { op: "rollback", id: "棋盘编号", action: "review" }, tip: "撤回这个动作最近的一次修改。" },
} satisfies { [K in Command["op"]]: { example: Extract<Input, { op: K }>; tip: string } };
