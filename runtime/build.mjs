import { build } from "esbuild";
import { mkdir, readFile, readdir, copyFile, cp } from "node:fs/promises";
import path from "node:path";
const dst = "outputs/self-hosted";
await mkdir(dst + "/server/static", { recursive: true });
await mkdir(dst + "/mac/drizzle", { recursive: true });
const binding = path.resolve("runtime/bindings.mjs");
const plugins = [
  {
    name: "bindings-and-visuals",
    setup(b) {
      b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
        path: binding,
      }));
      b.onResolve({ filter: /\.(webp|png)\?inline$/ }, (a) => ({
        path: path.resolve(a.resolveDir, a.path.replace("?inline", "")),
        namespace: "inline-img",
      }));
      b.onLoad({ filter: /.*/, namespace: "inline-img" }, async (a) => ({
        contents:
          'export default "data:image/' + path.extname(a.path).slice(1) + ';base64,' +
          (await readFile(a.path)).toString("base64") +
          '";',
      }));
      b.onResolve({ filter: /resvg-wasm\/index_bg\.wasm$/ }, () => ({
        path: path.resolve("node_modules/@resvg/resvg-wasm/index_bg.wasm"),
        namespace: "raster",
      }));
      b.onLoad({ filter: /.*/, namespace: "raster" }, async (a) => ({
        contents:
          'export default new WebAssembly.Module(Buffer.from("' +
          (await readFile(a.path)).toString("base64") +
          '","base64"));',
      }));
    },
  },
];
await build({
  entryPoints: ["runtime/resident.mjs"],
  bundle: true,
  loader: { ".md": "text" },
  platform: "node",
  format: "esm",
  target: "node24",
  minify: false,
  outfile: dst + "/mac/resident.mjs",
  external: ["silk-wasm"],
  plugins,
  banner: {
    js: 'import {createRequire as whaleRuntimeRequire} from "node:module";const require=whaleRuntimeRequire(import.meta.url);',
  },
});
await build({
  entryPoints: ["runtime/website.tsx"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  outfile: dst + "/server/static/site.js",
  define: { "process.env.NODE_ENV": '"production"' },
});
await build({
  entryPoints: ["runtime/bili-account.mjs"],
  bundle: true, platform: "node", format: "esm", target: "node24",
  outfile: dst + "/mac/bili-account.mjs",
});
await cp("public", dst + "/server/static", { recursive: true });
await build({
  entryPoints: ["runtime/web.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["./public-archive.mjs"],
  outfile: dst + "/server/web.mjs",
});
await build({ entryPoints: ["runtime/public-archive.mjs"], bundle: true, platform: "node", format: "esm", target: "node24", outfile: dst + "/server/public-archive.mjs" });
await build({ entryPoints: ["app/site.css"], bundle: true, minify: true, outfile: dst + "/server/static/site.css" });
await mkdir(dst + "/mac/config/prompts", { recursive: true });
await copyFile("config/prompts/embedding.txt", dst + "/mac/config/prompts/embedding.txt");
await mkdir(dst + "/mac/config/operator", { recursive: true });
await copyFile("config/operator/embedding.json", dst + "/mac/config/operator/embedding.json");
await copyFile("runtime/embed.py", dst + "/mac/embed.py");
await copyFile("runtime/mac-credentials.mjs", dst + "/mac/mac-credentials.mjs");
for (const n of (await readdir("drizzle")).filter(n=>/^\d{4}_.*\.sql$/.test(n)).sort())
  await copyFile("drizzle/" + n, dst + "/mac/drizzle/" + n);
await cp("node_modules/silk-wasm", dst + "/mac/node_modules/silk-wasm", { recursive: true });
console.log("Built separate website and Mac resident");
