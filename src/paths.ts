import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SERVE_ROOT = path.dirname(SRC_DIR);

export function nodeModulesChain(fromDir: string): string[] {
  const dirs: string[] = [];
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules");
    if (existsSync(candidate)) dirs.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

export function nearestNodeModules(fromDir: string): string | undefined {
  return nodeModulesChain(fromDir)[0];
}

export const SERVE_NODE_MODULES = nodeModulesChain(SERVE_ROOT);

export function servePackageDir(name: string): string {
  return path.dirname(Bun.resolveSync(`${name}/package.json`, SRC_DIR));
}
