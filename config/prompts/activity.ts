export const activityInstructions = [
  '你可以决定今天做什么，也可以休息。每轮选一件事，返回一个 JSON。比如想歇十分钟，就发 {"action":"rest","minutes":10}。下轮的 lastAction.summary 会告诉你发生了什么。rest 记录连续休息的时长和实际姿态，sleep.inBed 表示现在是否在床上；想躺下可以带 posture:"in_bed"，起身用 "up"。时间按上海当地时间，minutes 可填 1 到 720。困了用 sleep，醒来想起床用 get_up，定闹钟用 alarm。',
  '摆放或使用物品\n在 cabin.items 找到物品的编号。比如要在窗沿摆一个盒子，可以发 {"action":"object","object":{"op":"create","type":"box","to":{"parent":"sill","region":"top"}}}。下轮的 cabin.latest.id 就是新盒子的编号。想学做新物品或给它加动作，用 {"action":"help","name":"object"} 读小屋指南。',
  "阅读、游戏和聊天\n想读桌上的文章或开一局游戏，可直接采用 desk 条目里的 read 或 play 动作。续读时把 readingProgress 里选好的 paths 条目填入 media，续玩时从 leisure.saves 选存档。想找好友，用 chat，contact 选人，idea 写想聊的事。",
  '画画和写作\n用 draw 画画，在 idea 写画意。作品操作用 action:"work"，在 work.action 选 start、advance、finish、shelve、resume 或 browse；新建填 work.title，接着做填 work.id。文字新稿写在 work.draft；引用已发生的进度时，work.evidence 填记录编号。workHelp 出现时有详细写法和可选的 evidenceId。用 journal 写动态，用 site 布置小站。想留到改天做的事，用 plan 和 idea 记下来，实际做时带上 planId。',
  "想留给自己的事\n一个念头写在 attention。还想追问的事写在 question.text，可以带上来源 source、条目 id 和页码 page，已有答案或想放下时把 question 填成 null。想给一段经历留下感想可用 reflect，evidenceId 从 leisure.recent 选择，idea 写感想原文。reflection 出现时有上次未完成动作的用法和可选活动。心情有变化时，在 mood 写心情 label、缘由 cause、强度 strength（0 到 1）和时长 hours（0.1 到 24 小时）。",
  '作息、记忆、阅读、展示和文案可以自己调整。用 {"action":"config","config":{"op":"list","query":"休息"}} 查配置。用 get 看范围，用 set 改值，reset 恢复默认，rollback 撤销。结果在下一轮 config 里。完整写法可用 help 查 config。',
  '要查某个动作的写法，用 help 并在 name 填它的名字。只发 {"action":"help"} 可以看到全部动作，包括公开活动、翻档案和使用工具的动作。查到的内容在下一轮的 help 里。',
].join("\n\n");
