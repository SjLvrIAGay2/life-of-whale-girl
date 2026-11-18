# 小屋对象

用 `action: "object"` 操作屋里的物品。物品编号、区域和动作在 `cabin.items`，可做的类型在 `cabin.types`。用编号选中同名物品。上一步的结果在 `cabin.latest`。查写法用 `help` 加操作名 `command` 或能力名 `capability`。

## 做一颗薄荷糖，摆到窗沿

每行是一次完整动作。先定义薄荷糖，再用 `create` 指定窗沿。小屋会找能放下的位置。目录里已有 `mint` 时直接用第二行。

```jsonl
{"action":"object","object":{"op":"define","type":"mint","definition":{"name":"薄荷糖","size":[1.3,1,1],"massG":2,"consumable":true}}}
{"action":"object","object":{"op":"create","type":"mint","to":{"parent":"sill","region":"top"}}}
```

`size` 依次填宽、深、高，单位是厘米。`massG` 是克。要做一盒糖，可在有 `inside` 内腔的盒型定义里加 `"contents":[{"type":"mint","region":"inside","count":20}]`。以后每做一盒就有二十颗。改这一个盒子用 `update`，改下一批盒子用 `defaults`。

## 给棋盘加一个逐手复盘的动作

把下面的 `棋盘编号` 换成屋里那块棋盘的 `id`。第一行试读第一手，第二行用返回的 `preview` 编号启用，第三行就是以后复盘的用法。

```jsonl
{"action":"object","object":{"op":"preview","id":"棋盘编号","action":"review","behavior":{"input":"integer","recipe":{"description":"按手数看棋谱","steps":[{"op":"replay"}]}},"args":{"input":1}}}
{"action":"object","object":{"op":"activate","id":"棋盘编号","action":"review","preview":"试跑编号"}}
{"action":"object","object":{"op":"call","id":"棋盘编号","action":"review","args":{"input":1}}}
```

试跑时原棋盘保持原样。想撤回修改时，用 `rollback` 指定同一棋盘和动作名。

## 摆放和使用

- 找物品用 `catalog`，可按名字 `query`、类型 `type` 或容器 `parent` 查找。用 `inspect` 查看一件物品的状态、区域、承重、内容和动作。想改写已有动作时，在 `inspect` 加上它的 `action`。用 `type` 查看整份类型定义。
- 移动用 `move`，在 `to` 填目标物品 `parent` 和区域 `region`。想指定位置可填该区域内的 `x`、`y`，每格一厘米。需要先问哪里放得下时用 `find`。放不下会说明原因，东西留在原处。
- 区域的关系可以是表面 `on`、内腔 `inside`、挂位 `hang`、部件 `part` 或安装位 `installed`。区域的 `size` 是可用净尺寸，`opening` 是开口的宽和高。`loadG` 按总重计，`capacityCm3` 按容积计。软件大小 `installMB` 和安装位容量 `capacityMB` 都按 MB 计。
- 用 `call` 指定物品和动作，按它的样例填 `args`。用 `consume` 指定容器、区域、食品类型和数量，一次取用。用 `stow` 连同里面的东西一起收起，清空后可用 `remove` 移除可删除的物品。
- 新动作直接发送。如果需要重复发送同一次写操作，第一次就带上自选的 `requestId`，重发时沿用它和原参数。不同的操作各用自己的编号。
- `visibility` 可选 `detail`（访客可看位置和可见内容）、`summary`（名称和所在区域）或 `hidden`（整件藏起）。关上抽屉也会遮住里面的东西。
