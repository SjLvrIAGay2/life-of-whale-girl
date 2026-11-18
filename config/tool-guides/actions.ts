import { siteUsage } from "./site";
import cabinGuide from "./cabin.md?raw";

export const activityHelp = {
  config: [
    '用 {"action":"config","config":{"op":"list","category":"numbers","owner":"resident","query":"休息"}} 列出匹配项。category 可选 numbers、links、texts，筛选项都可省略。用 nextOffset 翻页。',
    '用 {"action":"config","config":{"op":"get","key":"numbers.restMinutes"}} 查作用、默认值、当前值、权限、范围或候选项。public 表示这项会随网站发布。',
    '用 {"action":"config","config":{"op":"set","key":"numbers.restMinutes","value":12}} 保存。数值填数字，文本保留原有 {占位符}。reset 恢复项目默认，rollback 撤回上一次改动。operator 项由维护者管理。',
  ].join("\n"),
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
  rest: "minutes 填想休息几分钟，省略时采用 numbers.restMinutes，再想做什么。可以继续休息。posture 选 in_bed 躺到床上或 up 起身，省略时沿用当前姿态。rest.elapsedMinutes 是这段连续休息已过的分钟数。",
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
    'workHelp.evidence 列出记录编号 evidenceId、内容摘要和可用于的 actions，选中的 evidenceId 原样填进 work.evidence。例如 {"action":"work","work":{"action":"advance","id":"作品编号","evidence":"选中的 evidenceId"}}。想写感想可用 reflect 的 idea；文字作品的新稿用 work.draft。',
    '想先查某件作品的进度记录，可以发 {"action":"help","name":"work","work":{"id":"作品编号"}}，在下一轮 help.evidence 查看。',
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
