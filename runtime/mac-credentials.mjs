import { spawnSync } from "node:child_process";

// launchd starts the resident with a clean environment. Import just the four
// project credentials from the same login shell in which the owner set them.
const missing = [
  "WHALE_DEEPSEEK_API_KEY",
  "WHALE_OPENAI_API_KEY",
  "WHALE_QQBOT_APPID",
  "WHALE_QQBOT_APPSECRET",
].filter(name => !process.env[name]);

if (missing.length) {
  const variables = missing.map(name => '"$' + name + '"').join(" ");
  const result = spawnSync("/bin/zsh", ["-lic", "builtin printf '%s\\0' " + variables + " >&3"], {
    env: { HOME: process.env.HOME, PATH: process.env.PATH },
    stdio: ["ignore", "ignore", "ignore", "pipe"],
    encoding: "utf8",
    timeout: 10000,
  });
  const values = result.output?.[3]?.split("\0");
  if (result.status === 0 && values?.length === missing.length + 1) {
    missing.forEach((name, index) => {
      if (values[index]) process.env[name] = values[index];
    });
  } else {
    console.error("无法从 Mac 登录环境读取鲸鱼娘的模型和 QQ 配置");
  }
}
