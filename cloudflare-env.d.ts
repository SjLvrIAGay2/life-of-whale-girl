declare namespace Cloudflare {
  interface Env {
    WHALE_SELF_HOSTED?: string;
    WHALE_ORIGIN?: string;
    WHALE_MOVED_ORIGIN?: string;
    DB?: D1Database;
    WHALE_EDITOR_TOKEN?: string;
    WHALE_CLOCK_KEY?: string;
    WHALE_DEEPSEEK_API_KEY?: string;
    WHALE_OPENAI_API_KEY?: string;
    WHALE_IMAGE_TRANSPORT?: { fetch(request: Request): Promise<Response> };
    WHALE_QQ_VOICE?: {
      toWave(bytes: Uint8Array): Promise<Uint8Array>;
      toSilk(wave: Uint8Array): Promise<Uint8Array>;
    };
    WHALE_MODEL?: string;
    WHALE_MEMORY_EMBED?: { model: string; encode(texts: string[], query?: boolean): Promise<Float32Array[]> };
    BILI_COOKIE?: string;
    HEYBOX_COOKIE?: string;
    WHALE_QQBOT_APPID?: string;
    WHALE_QQBOT_APPSECRET?: string;
  }
}
