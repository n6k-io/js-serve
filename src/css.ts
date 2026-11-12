import path from "node:path";
import { readFileSync } from "node:fs";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { SRC_DIR } from "./paths";

export async function buildCss(mdxPath: string): Promise<string> {
  const base = readFileSync(path.join(SRC_DIR, "globals.css"), "utf8");
  const css = `${base}\n@source ${JSON.stringify(SRC_DIR)};\n@source ${JSON.stringify(path.dirname(mdxPath))};\n`;
  const compiler = await compile(css, { base: SRC_DIR, onDependency() {} });
  const root =
    compiler.root === "none"
      ? []
      : compiler.root === null
        ? [{ base: process.cwd(), pattern: "**/*", negated: false }]
        : [{ ...compiler.root, negated: false }];
  const sources = [...root, ...compiler.sources];
  return compiler.build(new Scanner({ sources }).scan());
}
