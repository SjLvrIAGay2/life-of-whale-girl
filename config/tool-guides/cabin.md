# 在小屋里摆放和使用物品

每轮给小屋一个动作。外层的 `action` 填 `object`，里面的 `op` 说明这次想做什么。下面每个代码框是一轮。发出后，下一轮先看 `lastAction.summary` 了解发生了什么，再从 `cabin.latest` 取这一步的结果。

## 把一颗薄荷糖装进窗沿的盒子

**1. 先教小屋做薄荷糖。** 用 `define` 给这种糖起个类型名 `mint`。`size` 依次是宽、深、高，单位是厘米。这颗糖重 2 克，可以吃。如果 `cabin.types` 已有 `mint`，直接从第 2 步开始。

```json
{
  "action": "object",
  "object": {
    "op": "define", "type": "mint",
    "definition": { "name": "薄荷糖", "size": [1.3, 1, 1], "massG": 2, "consumable": true }
  }
}
```

成功后，`cabin.latest.type` 是 `mint`。这种糖只需定义一次，以后每颗都可以直接用 `create` 做。

**2. 在窗沿摆一个空盒。** `box` 是小屋会做的盒子。窗沿的编号是 `sill`，台面叫 `top`。在 `to` 里写好去处，小屋会挑能放下的位置。

```json
{
  "action": "object",
  "object": {
    "op": "create", "type": "box",
    "to": { "parent": "sill", "region": "top" }
  }
}
```

**3. 做一颗糖，直接放进盒内。** 上一步返回的 `cabin.latest.id` 是刚摆好的那只盒子的编号。把它填到下面的 `盒子编号` 处。`inside` 是盒子的内腔。

```json
{
  "action": "object",
  "object": {
    "op": "create", "type": "mint",
    "to": { "parent": "盒子编号", "region": "inside" }
  }
}
```

**4. 把这颗糖拿到书桌上。** 这次返回的 `cabin.latest.id` 是糖的编号，把它填到下面的 `糖的编号` 处。书桌的桌面是 `desk` 的 `top` 区域。

```json
{
  "action": "object",
  "object": {
    "op": "move", "id": "糖的编号",
    "to": { "parent": "desk", "region": "top" }
  }
}
```

成功时，`cabin.latest.at.parent` 是 `desk`。如果桌面放不下，糖还在盒里，`lastAction.summary` 会说明原因。

## 给棋盘加一个按手数复盘的动作

选一块已经下过至少一手的五子棋盘。从 `cabin.items` 复制它的 `id`，填到下面的 `棋盘编号` 处。如果没找到，可以用 `{"action":"object","object":{"op":"catalog","type":"board"}}` 查找，按回执里的名称和位置选中那一块。

**1. 在这块棋盘上试读第一手。** 给新动作起名 `review`。它接收一个整数作为手数，用 `replay` 读出那一手的棋面。`args.input` 填 1 就是试读第一手。

```json
{
  "action": "object",
  "object": {
    "op": "preview", "id": "棋盘编号", "action": "review",
    "behavior": {
      "input": "integer",
      "recipe": { "description": "按手数看棋谱", "steps": [{ "op": "replay" }] }
    },
    "args": { "input": 1 }
  }
}
```

**2. 看过棋面，再决定是否启用。** 下一轮的 `cabin.latest.result.output` 里有第一手的落子说明和棋面。满意的话，直接把同一回执的 `cabin.latest.next` 作为这一轮的完整动作。里面已经填好了棋盘和试用编号，小屋会启用 `review`。

**3. 用新动作复盘。** 启用后的 `cabin.latest.next` 就是下面这样一条 `call` 动作，已经填好了棋盘编号。直接发出可以再看第一手。以后想看哪一手，就把 `args.input` 改成那一手的数字。

```json
{
  "action": "object",
  "object": { "op": "call", "id": "棋盘编号", "action": "review", "args": { "input": 1 } }
}
```

想撤回这次新增的动作，可把上面的 `op` 换成 `rollback`，去掉 `args`，保留棋盘编号和动作名。

## 查其他用法

屋里已有的物品在 `cabin.items`。用 `id` 区分同名物品，`regions` 列出能放东西的区域，`actions` 列出能做的动作。要看某个动作怎么用，可以先问这件物品。例如 `{"action":"object","object":{"op":"inspect","id":"website"}}` 会列出小站的动作和样例。调用时，把动作名填进 `call` 的内层 `action`，参数照着该动作的 `example` 填进 `args`。

想先问哪里放得下，可以发 `{"action":"object","object":{"op":"help","command":"find"}}`。把回执里的 `example` 填入下一轮的 `object`，将物品和位置换成你选的。查其他操作时，把 `find` 换成操作名。省略 `command` 可以看到操作和能力的名字，用 `capability` 加能力名可以查它的参数。
