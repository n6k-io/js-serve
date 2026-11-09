import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SERVE_ROOT = path.dirname(SRC_DIR);
export const SERVE_NODE_MODULES = path.join(SERVE_ROOT, "node_modules");

export function nearestNodeModules(fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
