import { encode, decode, getDuration, isSilk } from "silk-wasm";
import { pcmWave } from "../lib/wave";

export const qqVoiceCodec = {
  async toWave(silk) {
    if (!isSilk(silk) || getDuration(silk) > 120000) throw Error("QQ 语音超过两分钟或格式有误");
    const { data } = await decode(silk, 24000);
    if (!data.length || data.byteLength > 120 * 48000) throw Error("QQ 语音时长无效");
    return pcmWave(data, 24000);
  },
  async toSilk(wave) {
    const { data } = await encode(wave, 0);
    if (!data.length || !isSilk(data)) throw Error("QQ 语音编码失败");
    return data;
  },
};
