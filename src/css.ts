import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { SERVE_NODE_MODULES, SRC_DIR } from "./paths";

// Under node_modules so the stylesheet's bare `@import`s resolve from serve's own deps.
const CACHE_DIR = path.join(SERVE_NODE_MODULES, ".cache", "n6k-serve");
const TAILWIND = path.join(SERVE_NODE_MODULES, ".bin", "tailwindcss");

export async function buildCss(mdxPath: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const stem = `${process.pid}.${Bun.hash(mdxPath).toString(36)}`;
  const input = path.join(CACHE_DIR, `${stem}.in.css`);
  const output = path.join(CACHE_DIR, `${stem}.out.css`);
  const base = readFileSync(path.join(SRC_DIR, "globals.css"), "utf8");
  await Bun.write(
    input,
    `${base}\n@source ${JSON.stringify(SRC_DIR)};\n@source ${JSON.stringify(path.dirname(mdxPath))};\n`,
  );
  const proc = Bun.spawn([TAILWIND, "-i", input, "-o", output], {
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    throw new Error(
      `tailwindcss failed:\n${await new Response(proc.stderr).text()}`,
    );
  }
  return readFileSync(output, "utf8");
}
