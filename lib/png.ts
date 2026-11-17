import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
let ready: Promise<void> | undefined;

export async function renderPNG(svg: string) {
  await (ready ??= initWasm(wasm));
  const renderer = new Resvg(svg);
  try {
    const image = renderer.render();
    try {
      return Buffer.from(image.asPng());
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
