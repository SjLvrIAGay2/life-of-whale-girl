import { locked } from "../options.ts";

export const operatorTexts = {
  modelName: locked("deepseek-flash", "推理与视觉模型，需要匹配服务的能力"),
  drawingModel: locked("gpt-image-2.6-flare", "图像编辑接口使用的模型"),
  speechVoice: locked("stella", "语音服务契约中已验证的音色"),
  timezone: locked("Asia/Shanghai", "所有日记日期、当地时间和闹钟共同使用的时区"),
};
