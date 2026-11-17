import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
export function windowsTransport(signal) {
  let child,
    seq = 0;
  const pending = new Map();
  function start() {
    const exe = path.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const proc = spawn(
      exe,
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        fileURLToPath(new URL("./bridge-http.ps1", import.meta.url)),
      ],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    child = proc;
    const lines = createInterface({ input: proc.stdout });
    lines.on("line", (line) => {
      try {
        const r = JSON.parse(line),
          h = pending.get(r.id);
        if (!h) return;
        pending.delete(r.id);
        if (r.status === 200) h.resolve(r.body);
        else h.reject(Error("小站状态 " + r.status));
      } catch {
        /* Never log response bodies or tokens. */
      }
    });
    const stopped = () => {
      if (child === proc) child = undefined;
      for (const item of pending.values()) item.reject(Error("桥接传输已断开"));
      pending.clear();
    };
    proc.on("error", stopped);
    proc.on("exit", stopped);
    proc.stdin.on("error", () => proc.kill());
    return proc;
  }
  signal.addEventListener("abort", () => child?.kill(), { once: true });
  return async (body) => {
    if (signal.aborted) throw Error("桥接已终止");
    const id = ++seq,
      proc = child ?? start();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ id, body }) + "\n");
    });
  };
}
