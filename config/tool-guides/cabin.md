# 小屋对象

鲸鱼娘使用 `{"action":"object","object":{…}}`。下一轮的 `cabin.latest` 是实际操作结果。`catalog` 支持按名称、类型、父物品和页码偏移查询。`inspect` 接收实例编号，返回自身状态、位置、区域、承重、内容数量、总重和动作参数。`type` 返回创建新实例时使用的完整定义。`help` 可带 `command` 或 `capability` 查看参数格式。

## 只写一份定义

下面两行分别登记一种薄荷糖，再生成一颗摆在窗沿。名字可以重复，后续移动、食用或修改时使用返回的实例编号。

```jsonl
{"action":"object","object":{"op":"define","requestId":"mint-type-1","type":"mint","definition":{"name":"薄荷糖","description":"一颗独立包装的薄荷糖","color":"#70aa92","size":[1.3,1,1],"massG":2,"consumable":true}}}
{"action":"object","object":{"op":"create","requestId":"mint-1","type":"mint","to":{"parent":"sill","region":"top"}}}
```

在盒子的定义中加入 `"contents":[{"type":"mint","region":"inside","count":20}]`，每个新盒就会生成二十个各有编号的实例。用 `defaults` 改盒型，用 `update` 改指定实例。定义会随存档保存，常驻进程运行期间即可使用。

## 给已摆好的棋盘加动作

先用 `catalog` 查到棋盘的实例编号。以下是连续四次 `action:"object"` 的 `object` 字段。将 `棋盘编号` 换成实际编号，将 `试跑编号` 换成第一步返回的 `preview`。

```jsonl
{"op":"preview","requestId":"review-test","id":"棋盘编号","action":"review","behavior":{"input":"integer","recipe":{"description":"按手数查看原棋谱","steps":[{"op":"replay"}]}},"args":{"input":1}}
{"op":"activate","requestId":"review-on","id":"棋盘编号","action":"review","preview":"试跑编号"}
{"op":"call","requestId":"review-first","id":"棋盘编号","action":"review","args":{"input":1}}
{"op":"rollback","requestId":"review-back","id":"棋盘编号","action":"review"}
```

试跑读取原棋谱并复制实例状态。带副作用的读取、绘图和网站操作在预览时使用预览适配器。启用时会核对基线版本并用当前状态再试一次。版本链存入现有的 `agent_versions`。普通配方还能组合 `read`、`take`、`join`、`caption`、`draw`、`state.get` 和 `state.append`。阅读账号与网站工作桌由宿主调用。

## 位置和提交

旧家具只保存了画面百分比。迁移沿用每件家具的原编号，为它补上可调整的厘米尺寸和承重初值，并把原先摆在桌上的电脑关联到对应书桌。旧布局有重叠时会查找可用网格，保留原画面的摆放位置。

- `size` 依次为宽、深、高，单位 cm。区域的 `size` 定义自身可用净尺寸，`opening` 为开口宽、高。`loadG` 按克限制区域内整棵子树的重量，`capacityCm3` 可进一步限制可用容积。软件声明 `installMB`，设备安装位声明 `capacityMB`。
- 放置关系有表面 `on`、内腔 `inside`、悬挂 `hang`、部件 `part` 和安装 `installed`。每个区域单独使用 1 cm 网格。坐标四舍五入到格点，足迹向上取整。省略坐标时按允许朝向寻找空位。可先用 `find` 询问位置，`move` 提交时重新核验。
- `stow` 整体收起物品、部件和内容。`remove` 要求物品已清空且没有其他物品引用它。原作品、画作和棋局可以整体收起。`consume` 从指定父对象和区域一次取用指定数量的可食用物品。
- 每次新写操作使用新的 `requestId`。重发原请求会得到同一份回执。移动、宿主存档写入、回执和公开版本在同一笔带租约的 SQLite 事务中提交。
- 访客可点房间中的物品标签或展开“小屋里的物品”。`detail` 展示局部位置和可见内容，`summary` 展示名称与所在区域，`hidden` 收起整棵子树。抽屉关闭时内容也会收起。便笺正文、原始棋谱批注和私人作品保留原有访问范围。
