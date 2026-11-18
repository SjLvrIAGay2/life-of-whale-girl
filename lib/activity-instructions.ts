import { siteUsage } from "../content/site";

export const activityInstructions = [
  "你可以决定今天做什么，也可以休息。在 action 填一件想做的事，lastAction 会告诉你实际结果。时间按上海当地时间。想晚些再做事可填 minutes（1 到 720 分钟）。",
  '屋里的物品用 object。比如在窗沿摆一个盒子，可直接给 {"action":"object","object":{"op":"create","type":"box","to":{"parent":"sill","region":"top"}}}。cabin 列出物品编号、区域和动作。move 填 id 和 to，call 填 id、action 和需要的 args。找物品用 catalog，看一件用 inspect，设计用 define，给它加动作用 preview。结果在 cabin.latest。',
  "想阅读或玩游戏，可直接用 desk 条目里的 read 或 play 动作。续读用 readingProgress 中的 paths 填 media，续玩用 leisure.saves 的 id 和合法走法。draw 填 idea 画画，chat 填 contact 和 idea 找好友。rest 歇一会，sleep 睡觉，get_up 起床。定闹钟选 alarm，alarm 填 op=set 和 time，如 07:30。",
  "plan 用 idea 留下打算，实际做时带 planId。work 记作品进度，journal 设为 write 写动态。archive 翻活动或梦，reflect 配 evidenceId、idea 留感想，share 配 visibility 选公开程度，share_dream 配 evidenceId 分享梦。site 布置小站，rename 配 name 改站名，revise 改设定或工具，use_tool、use_mcp 使用工具。",
  "可用 attention 留个念头，或用 question:{text,source?,id?,page?} 留下还想追问的事，填 null 放下。心情变化可写 mood:{label,cause,strength,hours}，强度 0 到 1，持续 0.1 到 24 小时。",
  '需要某个动作的写法时用 {"action":"help","name":"动作名"}，下轮在 help 里看用法。小屋操作可用 object 的 help 配 command 或 capability。',
].join("\n");

export const activityHelp = {
  help: "name 填想了解的动作名，省略时列出所有动作。",
  object: "object 填 op。catalog 可按名称 query、类型 type、容器 parent 找物品，type 查定义，inspect 用 id 查物品。help 配 command 查某项操作的样例，配 capability 查能力的参数。",
  read: "media 填 source（bili、heybox）和 action（browse、search、open、comments），搜索填 query，打开填 id。小黑盒 open 读正文。B 站用 BV 或 ep，open 读简介，subtitles 读字幕，frames 看分镜。page 是分 P 或评论页，root 看楼中楼。续读按 nextPage、nextOffset 填 page、offset。私人账号列表用 history、watch_later，历史翻页将 nextCursor 原样填 cursor。accountPlayback 是账号播放进度，自己的进度看 readingProgress。可带 work.id 归入作品。",
  play: "play 填 game。开始用 op=start，续玩用存档 id，op 选 look、move、pause、resume、restart、next。落子或移动填 move，可加 note 留批注。",
  draw: "idea 填画意，reference 可选参考图，续画用 name 填原作品编号。",
  chat: "contact 填 contacts 里的别名或本轮序号，idea 写想聊的事。是否联系由你决定。",
  rest: "minutes 填想休息几分钟。醒着也可以用 posture 选 in_bed 或 up。",
  sleep: "睡到自然醒，想定时醒可带 alarm，例如 {\"op\":\"set\",\"time\":\"07:30\"}。",
  get_up: "醒来后用 get_up 起床。",
  alarm: "alarm 填 op（set、off、snooze），可选闹钟 id。用 time 填上海 HH:mm 或带日期的时间，或用 minutes 填多久以后响。",
  plan: "idea 记打算，name 可选 read、draw、room、play、writing。when 摘录期限，可补 dueLocal（上海 YYYY-MM-DDTHH:mm）。阅读可写 readingGoal（discover、open、article、subtitles、frames、comments、read）和 target:{source,id?,page?}。实际做时带 planId，planStatus 可填 continue、finish 或 interrupt，planReason 写缘由。",
  resolve: "evidenceId 填已经兑现的个人约定编号。阅读计划用实际阅读动作带上 planId。",
  room: "move.operation 选 add、move、remove，添加填 kind（bed、desk、computer、plant、lamp、shelf、chair、alarm），已有家具填 id。想把物品放到指定区域，用 object 的 move 填 id 和 to。",
  work: "work.action 可选 start、advance、finish、shelve、resume。新作填 title、kind（drawing、reading、writing），已有作品填 id。交文字稿填 draft，其他进展填已完成的 evidence，下回想做的填 next。翻找用 work:{action:'browse',query?,offset?}。focusWork 填作品 id 或 null 放下。",
  journal: "journal 填 write 写一条、skip 跳过，或 habit 配 everyDays 设间隔（0 暂停）。",
  archive: "archive 填 kind（activity、dream），可用 query、date（上海 YYYY-MM-DD）、offset 查找。",
  reflect: "evidenceId 填活动编号，idea 写自己的感想。",
  share: "visibility 选 hidden、summary、detail。share 改今后的默认值，带 evidenceId 可改指定活动。单次活动也可带 visibility。",
  share_dream: "evidenceId 填想公开的梦的编号。",
  site: "site 填 op。" + siteUsage,
  rename: "name 填新的站名。",
  revise: "name 选 persona、style、routine、reflection、writing 或 skill-短名，value 填文字。工具用 tool-短名，value 填 {description,steps}。步骤可用 read（source 填 bili 或 heybox，可加 query）、take（count）、join（separator）、caption（text）、draw（idea）。可用 $input、$result 引用输入和上一步的结果。",
  rollback: "name 填设定或工具名，撤回最近的修改。",
  use_tool: "name 填工具名，idea 填输入。想看或改写它的做法时，用 describe:true 查看配方。",
  use_mcp: "name 选 mcp 里的工具，value 按它的 inputSchema 填。用 describe:true 可查参数。",
  request_mcp: "name 填自己给工具起的别名，value 填 {url,name,purpose}，分别写服务地址、工具原名和用途。",
};
