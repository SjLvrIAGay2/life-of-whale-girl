declare module "@resvg/resvg-wasm/index_bg.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.webp?inline" {
  const data: string;
  export default data;
}
declare module "*.png?inline" {
  const data: string;
  export default data;
}
declare module "*.md?raw" {
  const text: string;
  export default text;
}
