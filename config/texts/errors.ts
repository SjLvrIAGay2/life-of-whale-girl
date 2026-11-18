// Operator-owned feedback from validation, permissions and service contracts.

export const apiErrors = {
  missingActivity: "没有这次公开活动",
  ownerCredentials: "需要站主凭据",
  unavailable: "入口不可用",
  origin: "来源不匹配",
  bridgeCredentials: "需要桥接凭据",
  qqGateway: "无法连接 QQ 网关",
  unknownOperation: "未知操作",
  schedulerCredentials: "需要调度凭据",
  savingLocal: "常驻端正保存另一个动作，请稍后重试",
  hostOnly: "该检查需要在常驻主机运行",
  invalidModel: "模型响应格式有误",
  gateway: "无法连接网关",
  encoderOffline: "本地语义模型离线",
  restrictedSetting: "不能修改该设置",
  missingVersion: "版本不存在",
  settingLength: "设定文本长度有误",
  busy: "鲸鱼娘正忙，请稍后再试",
  nameLength: "站名须在四十字以内",
};

export const atelierErrors = {
  credentials: "未配置绘图模型",
  noImage: "绘图服务未返回图片",
  invalidPng: "绘图服务返回了无效的 PNG",
};

export const cabinBehaviorErrors = {
  missingMoves: "这个对象没有五子棋棋谱",
  invalidUrl: "浏览器可打开本站首页、B站视频或小黑盒帖子；无法识别该地址",
  noGame: "这件物品没有关联游戏存档",
  missingGame: "找不到游戏存档",
  noHinge: "这件物品没有能开合的区域",
};

export const cabinModelErrors = {
  excessVolume: "声明的体积超过外部尺寸",
};

export const cabinSpaceErrors = {
  cycle: "不能把对象放进自己或其后代",
  softwareOnly: "安装位只接受有安装大小的软件",
  noInstallCoordinates: "软件安装位按 MB 分配，没有网格坐标",
  installInDevice: "软件需要安装在设备的软件安装位",
  fixedOrigin: "小屋地面是坐标原点",
};

export const cabinStoreErrors = {
  outOfScope: "这件物品不在自己的可查看范围内",
  spawnLimit: "一次生成的对象超过 512 件",
  fixedOrigin: "小屋地面是坐标原点",
  keepHistory: "要保留这件物品的记录，请用 stow 收起",
  containerNotEmpty: "物品中还有内容；可整体收起，或先移出里面的物品",
  referenced: "另一个对象仍引用这件物品",
  furnitureKind: "添置家具需要指定种类",
  roomFull: "小屋已满",
  missingFurniture: "屋里找不到这个物件，请选小屋里现有的编号",
};

export const cabinErrors = {
  duplicateOrigin: "小屋已有坐标原点",
  notInstalled: "先把软件安装到设备上",
  missingPreview: "找不到这个对象动作的试跑记录",
  stalePreview: "动作版本已改变，请重新试跑",
  initialVersion: "这个动作已经是初始版本",
  reusedRequest: "requestId 已用于另一项请求",
};

export const chatImagesErrors = {
  size: "每张图片最多 6 MiB",
  format: "支持 PNG、JPEG、WebP 和 GIF 图片",
};

export const configurationErrors = {
  commandMissing: "请在 config 中填 op，可用 list、get、set、reset、rollback。",
  readOnly: "这是维护者管理的只读配置项。",
  invalidValue: "配置值不符合约束，请用 get 查看类型、范围、候选值和模板。",
  initial: "已经是初始配置。",
  missingVersion: "配置历史缺失。",
  obsoleteValue: "历史值与当前配置约束不兼容。",
};

export const contactPreferencesErrors = {
  quietHours: "请填写不同的免打扰起止时间",
  textHours: "请填写不同的纯文字时段起止时间",
  noChange: "没有要保存的设置",
};

export const fetchPublicPageErrors = {
  unavailable: "暂时读不到小屋的公开存档。",
};

export const friendMemoryErrors = {
  invalidReview: "好友记忆整理格式错误",
};

export const gamesErrors = {
  direction: "推箱子方向为 up、down、left、right",
  coordinates: "坐标须在 A1 到 I9 之间",
  noSave: "找不到这个存档，先用 start 开一局",
  nextLevel: "当前没有可进入的下一关",
};

export const lifeErrors = {
  missingOriginal: "找不到这次续画选中的原图",
  missingConversationArt: "找不到这段对话里的那幅画。",
  pausedDrawing: "这幅画还有搁置的画稿，先恢复原任务就能继续。",
  draftMissing: "这幅画的原稿暂时找不到。",
  workMissing: "找不到选中的绘画作品",
  draftPending: "这件作品已有待处理的画稿",
  hiddenArt: "画作缺少可见记录",
  gameCommand: "缺少游戏指令",
  visibility: "要设置公开程度",
  activityMissing: "找不到这次活动",
  archiveKind: "请选活动或梦境档案",
  journalChoice: "请给出写作习惯或这次选择",
  contactMissing: "没有选中可联系的好友",
  mediaMissing: "未选择媒体",
  emptyName: "站名为空",
  alarmCommand: "缺少闹钟操作",
  restrictedSetting: "修改限于角色设定和工具箱",
  useConfigRollback: "请用对应的 config 或 object 动作回退。",
  initialVersion: "已经是初始设置",
  versionMissing: "版本不存在",
  toolMissing: "工具不存在",
  incompleteRequest: "工具申请不完整",
  noPublicEvents: "今天没有可引用的公开经历",
  journalEvidence: "这篇动态需要可核对的经历",
  alarmTime: "请告诉我闹钟要在几点响。",
  chatDecision: "私信没有有效的发送决定",
};

export const mediaBridgeErrors = {
  invalidId: "读取编号无效",
};

export const memoryControlErrors = {
  invalidCorrection: "请填写有效的记忆更正",
};

export const modelErrors = {
  credentials: "未配置角色模型",
  invalidResponse: "模型返回了无法读取的内容",
};

export const qqVoiceErrors = {
  invalidUrl: "无效的 QQ 附件地址",
  download: "QQ 语音下载失败",
  size: "QQ 附件过大",
};

export const qqErrors = {
  signature: "无效的回调验证",
  format: "QQ 凭据格式有误",
  credentials: "QQ 尚未配置",
  invalidCredentials: "QQ 凭据验证失败",
  voiceToken: "QQ 语音凭证为空",
  uploadImage: "QQ 图片上传失败",
  imageToken: "QQ 图片凭证为空",
};

export const remoteToolsErrors = {
  missingTool: "服务器未提供这个工具",
  disabled: "工具未启用",
  invalidUrl: "请输入真实的 HTTPS MCP 地址",
  notGranted: "工具尚未获准",
  notListed: "服务端未列出该工具",
  unavailable: "远程工具不可用",
  noResponse: "没有工具响应",
  denied: "远程工具拒绝了请求",
  paused: "这项工具已暂停",
  failed: "远程工具执行失败",
};

export const replayErrors = {
  missingScenario: "找不到这个试聊情境",
  missingVersion: "版本不存在",
  missingPersona: "试聊需要选择人格版本",
};

export const securityErrors = {
  missingBody: "缺少请求内容",
  bodySize: "数据过大",
};

export const sleepErrors = {
  missingAlarm: "这里找不到这只闹钟",
  localTime: "闹钟需要当地的小时和分钟",
  futureTime: "闹钟的响铃时间需要在将来",
};

export const speechErrors = {
  credentials: "未配置语音服务",
  size: "音频须在 8 MiB 以内",
  format: "请选择 PCM WAV 或 Ogg Opus 音频",
  inaudible: "没有听清，请再说一次",
  noAudio: "语音服务未返回音频",
  incomplete: "语音数据不完整",
};

export const studioErrors = {
  documentSize: "版面文档须在 65 KB 以内",
  depth: "组件嵌套太深",
  binding: "组件绑定类型与来源不匹配",
  nodeCount: "组件节点超过 80 个",
  children: "容器需要 children",
  boardSource: "Board 需要 moves 数据",
  buttonStep: "Button 需要标签和翻步方向",
  imageField: "Image 需要 image 字段",
  textField: "文字节点缺少 text 或 field",
  invalidNav: "需要唯一的首页和有效的导航",
  reservedPage: "这个页面地址已被占用",
  componentConflict: "组件名与目录冲突",
  blockLimit: "页面 ID 重复或嵌套超限",
  sectionOnly: "请将子项放进 section",
  staleDraft: "草稿已有新修改，请重新读取后再保存",
  theme: "需要 theme 颜色或明暗模式",
  nav: "需要 nav 页面地址列表",
  path: "需要页面地址",
  lockedPage: "该页面不能移除",
  pageTitle: "需要页面标题",
  missingPage: "找不到目标页面",
  missingBlock: "找不到要移动或移除的组件",
  blockRequired: "缺少组件",
  parentCycle: "父分区不存在或形成嵌套循环",
  targetMissing: "目标位置没有这个组件",
  idea: "说说希望组件怎样工作",
  missingComponent: "目录里没有要修改的组件",
  wrongName: "返回的组件名与委托不一致，请重做",
  duplicateComponent: "组件已存在，修改时请给 name",
  noMoves: "昨天没有可绑定的公开棋谱，可以挑选另一盘或调整分享设置",
  sourceMissing: "所绑定的公开记录没有该组件需要的数据",
  invalidPreview: "预览数据绑定失败",
  noPublication: "还没有可撤回的发布",
  versionMissing: "找不到该发布版本",
};

export const toolboxErrors = {
  readLimit: "每个工具最多读取两次",
  drawingLimit: "每个工具最多画一幅",
};

export const vaultErrors = {
  ownerKey: "站主密钥未配置",
};
