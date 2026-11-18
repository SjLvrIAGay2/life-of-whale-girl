import { siteUsage } from "../content/site";
import cabinGuide from "../config/tool-guides/cabin.md?raw";

export const activityInstructions = [
  '你可以决定今天做什么，也可以休息。每轮选一件事，返回一个 JSON。比如想歇十分钟，就发 {"action":"rest","minutes":10}。下轮的 lastAction.summary 会告诉你发生了什么。rest 记录连续休息的时长和实际姿态，sleep.inBed 表示现在是否在床上；想躺下可以带 posture:"in_bed"，起身用 "up"。时间按上海当地时间，minutes 可填 1 到 720。困了用 sleep，醒来想起床用 get_up，定闹钟用 alarm。',
  '摆放或使用物品\n在 cabin.items 找到物品的编号。比如要在窗沿摆一个盒子，可以发 {"action":"object","object":{"op":"create","type":"box","to":{"parent":"sill","region":"top"}}}。下轮的 cabin.latest.id 就是新盒子的编号。想学做新物品或给它加动作，用 {"action":"help","name":"object"} 读小屋指南。',
  "阅读、游戏和聊天\n想读桌上的文章或开一局游戏，可直接采用 desk 条目里的 read 或 play 动作。续读时把 readingProgress 里选好的 paths 条目填入 media，续玩时从 leisure.saves 选存档。想找好友，用 chat，contact 选人，idea 写想聊的事。",
  "画画和写作\n用 draw 画画，在 idea 写画意。用 work 接着做一件作品，用 journal 写动态，用 site 布置小站。想留到改天做的事，用 plan 和 idea 记下来，实际做时带上 planId。",
  "想留给自己的事\n一个念头写在 attention。还想追问的事写在 question.text，可以带上来源 source、条目 id 和页码 page，已有答案或想放下时把 question 填成 null。想给一段经历留下感想可用 reflect，evidenceId 从 leisure.recent 选择，idea 写感想原文。reflection 出现时有上次未完成动作的用法和可选活动。心情有变化时，在 mood 写心情 label、缘由 cause、强度 strength（0 到 1）和时长 hours（0.1 到 24 小时）。",
  '要查某个动作的写法，用 help 并在 name 填它的名字。只发 {"action":"help"} 可以看到全部动作，包括公开活动、翻档案和使用工具的动作。查到的内容在下一轮的 help 里。',
].join("\n\n");

export const activityHelp = {
  help: "name 填想了解的动作名，省略时列出所有动作。",
  object: cabinGuide.trim(),
  read: [
    '找内容时，用 browse 看推荐，或用 search 搜关键词。比如在小黑盒搜推箱子，可以发 {"action":"read","media":{"source":"heybox","action":"search","query":"推箱子"}}。',
    "从结果中选一个 id，把 media.action 改成 open 并填入 id。小黑盒打开的是正文。哔哩哔哩选 source=bili，用 BV 或 ep 编号打开简介，subtitles 读字幕，frames 看分镜。两处都能用 comments 读评论，root 选某一楼的回复。",
    "续读时将 nextPage 或 nextOffset 填入 page 或 offset。B 站视频的 page 选分 P，在评论中选评论页。私人列表用 history 或 watch_later。观看历史的 nextCursor 原样填入 cursor。accountPlayback 是账号播放进度，自己的阅读进度在 readingProgress。想把这次阅读归入作品可带 work.id。",
  ].join("\n"),
  play: "play 填 game。开始用 op=start，续玩用存档 id，op 选 look、move、pause、resume、restart、next。落子或移动填 move，可加 note 留批注。",
  draw: "idea 填画意，reference 可选参考图，续画用 name 填原作品编号。",
  chat: "contact 填 contacts 里的别名或本轮序号，idea 写想聊的事。是否联系由你决定。",
  rest: "minutes 填想休息几分钟，省略时先歇五分钟再想做什么。可以继续休息。posture 选 in_bed 躺到床上或 up 起身，省略时沿用当前姿态。rest.elapsedMinutes 是这段连续休息已过的分钟数。",
  sleep: "睡到自然醒，想定时醒可带 alarm，例如 {\"op\":\"set\",\"time\":\"07:30\"}。",
  get_up: "醒来后用 get_up 起床。",
  alarm: "alarm 填 op（set、off、snooze），可选闹钟 id。用 time 填上海 HH:mm 或带日期的时间，或用 minutes 填多久以后响。",
  plan: [
    '用 idea 写打算。比如 {"action":"plan","name":"draw","idea":"画一张窗边的速写"}。name 可选 read、draw、room、play、writing。定了期限可以把时间原话写在 when，明确到日期和时刻可补 dueLocal（上海 YYYY-MM-DDTHH:mm）。',
    "实际动手时，把这项计划的编号填在 planId。需要调整时，planStatus 填 continue（继续）、finish（完成）或 interrupt（中断），缘由写在 planReason。",
    "阅读计划可以在 target 填 source 和已知的条目 id、分 P 页码 page。readingGoal 可选 discover、open、article、subtitles、frames、comments 或 read。",
  ].join("\n"),
  resolve: "evidenceId 填已经兑现的个人约定编号。阅读计划用实际阅读动作带上 planId。",
  room: "move.operation 选 add、move、remove，添加填 kind（bed、desk、computer、plant、lamp、shelf、chair、alarm），已有家具填 id。想把物品放到指定区域，用 object 的 move 填 id 和 to。",
  work: [
    '新建作品用 start。比如 {"action":"work","work":{"action":"start","title":"窗边手记","kind":"writing"}}。kind 可选 writing、drawing、reading。',
    "接着做同一件作品时，在 work 里填它的 id，用 advance 记进展。新稿写在 draft，其他进展用 evidence 填已完成事项的编号，下次想做的写在 next。完成用 finish，暂时搁置用 shelve，拿回来用 resume。",
    "找作品用 work.action=browse，可填关键词 query，翻页用 offset。想一直惦记某件作品，可在外层填 focusWork 为作品编号，填 null 放下。",
  ].join("\n"),
  journal: "journal 填 write 写一条、skip 跳过，或 habit 配 everyDays 设间隔（0 暂停）。",
  archive: "archive 填 kind（activity、dream），可用 query、date（上海 YYYY-MM-DD）、offset 查找。",
  reflect: 'evidenceId 从 activities、leisure.recent 或 archive 的结果选活动编号，idea 写自己的感想原文。例如 {"action":"reflect","evidenceId":"选中的活动编号","idea":"自己的感想"}。如果已经回答了当前惦记的问题，也可同时填 question:null，问题和这次感想会一起留存。',
  share: "visibility 选 hidden、summary、detail。share 改今后的默认值，带 evidenceId 可改指定活动。单次活动也可带 visibility。",
  share_dream: "evidenceId 填想公开的梦的编号。",
  site: '在 site 里填这次要做的操作。例如 {"action":"site","site":{"op":"catalog"}} 会给你组件目录。\n' + siteUsage,
  rename: "name 填新的站名。",
  revise: [
    '改偏好用 name 选项目，value 写自己的想法。比如 {"action":"revise","name":"style","value":"想用淡蓝色画水面"}。还可选 persona、routine、reflection、writing，或用 skill-短名记下心得。',
    "自制工具用 tool-短名，在 value.description 写用途，在 value.steps 按顺序列做法。读取用 read（source 填 bili 或 heybox，可加 query），取前几项用 take（count），拼接用 join（separator），配文用 caption（text），画画用 draw（idea）。在文字里用 $input 引用输入，$result 引用上一步的结果。",
  ].join("\n"),
  rollback: "name 填设定或工具名，撤回最近的修改。",
  use_tool: "name 填工具名，idea 填输入。想看或改写它的做法时，用 describe:true 查看配方。",
  use_mcp: "name 选 mcp 里的工具，value 按它的 inputSchema 填。用 describe:true 可查参数。",
  request_mcp: "name 填自己给工具起的别名，value 填 {url,name,purpose}，分别写服务地址、工具原名和用途。",
};
