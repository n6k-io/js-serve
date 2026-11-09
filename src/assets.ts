import path from "node:path";
import { wasmDir } from "@n6k.io/db/wasm-dir";
import {
  N6K_DUCKDB_FILES,
  N6K_WASM_MIME,
  N6K_WORKER_DEV_URLS,
  bundleN6kWorker,
  collectN6kWasmFiles,
  findFontFile,
  n6kDuckDBUrl,
  resolveDuckDBDist,
  resolveN6kWorkerSource,
} from "@n6k.io/build/pipeline";
import { SERVE_NODE_MODULES, SERVE_ROOT } from "./paths";

const SAME_ORIGIN = { "Cross-Origin-Resource-Policy": "same-origin" };

const duckdbFiles = new Map(
  Object.values(N6K_DUCKDB_FILES).map((file) => [
    n6kDuckDBUrl(file),
    resolveDuckDBDist(file),
  ]),
);

const wasmFiles = new Map(
  collectN6kWasmFiles(wasmDir).map((f) => [`/${f.rel}`, f.abs]),
);

function mime(file: string): string {
  return N6K_WASM_MIME[path.extname(file)] ?? "application/octet-stream";
}

// duckdb runtime, n6k driver workers, n6k duckdb extensions and fontsource fonts; undefined if `pathname` is none of them.
export async function serveAsset(
  pathname: string,
): Promise<Response | undefined> {
  const fixed = duckdbFiles.get(pathname) ?? wasmFiles.get(pathname);
  if (fixed) {
    return new Response(Bun.file(fixed), {
      headers: { "Content-Type": mime(fixed), ...SAME_ORIGIN },
    });
  }
  if (pathname.startsWith("/files/")) {
    const font = findFontFile(
      SERVE_NODE_MODULES,
      pathname.slice("/files/".length),
    );
    if (font) {
      return new Response(Bun.file(font), {
        headers: { "Content-Type": "font/woff2", ...SAME_ORIGIN },
      });
    }
  }
  const workerRel = N6K_WORKER_DEV_URLS[pathname];
  if (workerRel) {
    const code = await bundleN6kWorker(
      resolveN6kWorkerSource(workerRel, SERVE_ROOT),
    );
    return new Response(code, {
      headers: {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
        ...SAME_ORIGIN,
      },
    });
  }
  return undefined;
}

export function hasWasmExtensions(): boolean {
  return wasmFiles.size > 0;
}
