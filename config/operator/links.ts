import { locked } from "../options.ts";

export const operatorLinks = {
  roomAssets: locked("/room/", "已部署的小屋家具图像目录"),
  loopback: locked("127.0.0.1", "自托管私有接口的本地监听地址"),
  siteOrigin: locked("http://127.0.0.1:19531", "自托管公开网站的本机备用地址"),
  model: locked("https://api.deepseek.com/chat/completions", "携带模型凭据的推理地址"),
  drawing: locked("https://api.openai.com/v1/images/edits", "携带绘图凭据的图像编辑地址"),
  speech: locked("https://api.deepseek.com/v1/tools/", "携带模型凭据的语音接口前缀"),
  biliApi: locked("https://api.bilibili.com", "哔哩哔哩 API"),
  biliSite: locked("https://www.bilibili.com", "哔哩哔哩资源和视频来源"),
  biliPassport: locked("https://passport.bilibili.com", "哔哩哔哩扫码登录"),
  biliAccount: locked("https://account.bilibili.com", "登录回调允许的账号来源"),
  heyboxApi: locked("https://api.xiaoheihe.cn", "小黑盒 API 与分享地址来源"),
  heyboxSite: locked("https://www.xiaoheihe.cn", "小黑盒请求来源"),
  qqToken: locked("https://bots.qq.com/app/getAppAccessToken", "QQ 机器人令牌接收地址"),
  qqGateway: locked("https://api.sgroup.qq.com/gateway", "QQ 网关发现地址"),
  qqUsers: locked("https://api.sgroup.qq.com/v2/users/", "QQ 好友发送接口前缀"),
};
