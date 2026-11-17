import { openResident } from "./recovery.mjs";
import { qqVoiceCodec } from "./qq-codec.mjs";
import { localEmbedding } from "./embedding.mjs";
import { ProxyAgent } from "undici";
process.umask(0o077);
const file = process.env.WHALE_DB;
if (!file) throw Error("WHALE_DB is required");
export const sqlite = openResident(file);
function prepare(sql, args = []) {
  const statement = sqlite.prepare(sql);
  function run() {
    return { meta: statement.run(...args) };
  }
  return {
    bind: (...values) => prepare(sql, values),
    first: async () => statement.get(...args) ?? null,
    all: async () => ({ results: statement.all(...args) }),
    run: async () => run(),
    sync: run,
  };
}
const imageProxy = process.env.WHALE_OPENAI_PROXY
  ? new ProxyAgent(process.env.WHALE_OPENAI_PROXY)
  : undefined;
export const env = {
  ...process.env,
  WHALE_QQ_VOICE: qqVoiceCodec,
  WHALE_MEMORY_EMBED: localEmbedding(file),
  WHALE_IMAGE_TRANSPORT: imageProxy && {
    fetch: (request) => fetch(request, { dispatcher: imageProxy }),
  },
  DB: {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const values = statements.map((s) => s.sync());
        sqlite.exec("COMMIT");
        return values;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  },
};
export const waitUntil = (promise) => {
  void promise.catch(() => {});
};
