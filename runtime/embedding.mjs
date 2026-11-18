import embedding from "../config/operator/embedding.json" with { type:"json" };
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// One pipe owned by the resident. Only model files are read outside SQLite.
export function localEmbedding(database) {
  const root = join(dirname(dirname(database)), "semantic");
  const python = join(root, "venv", "bin", "python");
  if (!existsSync(python) || !existsSync(join(root, "bge-small-zh-v1.5", "model.onnx"))) return;
  let child, pending, queue = Promise.resolve();
  function connect() {
    if (child) return child;
    const proc = spawn(python, ["-u", fileURLToPath(new URL("./embed.py", import.meta.url))], {
      env: { PATH: process.env.PATH, WHALE_BGE_DIR: join(root,"bge-small-zh-v1.5"), TOKENIZERS_PARALLELISM:"false" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    child = proc;
    const lost = () => {
      if (child !== proc) return;
      child = undefined;
      pending?.reject(Error("本地语义模型离线"));
    };
    proc.once("error", lost);
    proc.once("exit", lost);
    proc.stdin.on("error", lost);
    createInterface({ input:proc.stdout }).on("line", line => {
      if (child !== proc || !pending) return;
      try {
        const data = JSON.parse(line);
        if (!Array.isArray(data) || data.length !== pending.count) throw Error();
        const vectors = data.map(s => {
          const bytes = Uint8Array.from(Buffer.from(s,"base64"));
          if (bytes.length !== embedding.dimensions * Float32Array.BYTES_PER_ELEMENT) throw Error();
          return new Float32Array(bytes.buffer);
        });
        pending.resolve(vectors);
      } catch { pending.reject(Error("本地语义模型返回无效向量")); }
    });
    return proc;
  }
  return { model:embedding.model, async encode(texts, query = false) {
    const task = queue.then(async () => {
      const proc = connect();
      const timer = setTimeout(() => proc.kill(),embedding.timeoutMs);
      try {
        return await new Promise((resolve,reject) => {
          pending = {count:texts.length,resolve,reject};
          proc.stdin.write(JSON.stringify({ texts, query })+"\n");
        });
      } finally { clearTimeout(timer); pending = undefined; }
    });
    queue = task.catch(() => {});
    return task;
  }};
}
