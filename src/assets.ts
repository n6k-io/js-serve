import { wasmDir } from "@n6k.io/db/wasm-dir";
import { collectN6kWasmFiles, findFontFile } from "@n6k.io/build/pipeline";
import { SERVE_NODE_MODULES } from "./paths";

export function findFont(name: string): string | undefined {
  return SERVE_NODE_MODULES.map((dir) => findFontFile(dir, name)).find(Boolean);
}

export function hasWasmExtensions(): boolean {
  return collectN6kWasmFiles(wasmDir).length > 0;
}
