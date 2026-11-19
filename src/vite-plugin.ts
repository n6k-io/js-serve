import path from "node:path";
import { realpathSync } from "node:fs";
import type { Plugin, ResolvedConfig } from "vite";
import { compileN6kMdx } from "@n6k.io/build/pipeline";
import { buildCss } from "./css";
import { SERVE_ROOT, SRC_DIR, nodeModulesChain } from "./paths";

export type RootProps = {
  data: Record<string, string>;
  tokens: Record<string, string>;
  oidc?: string[];
  bare?: boolean;
};

export type PageSource = {
  key: string;
  file: string;
  rootProps: () => RootProps;
};

const ENTRY = "\0n6k-entry:";
const CSS = "\0n6k-css:";
const CSS_IMPORT = "virtual:n6k-css:";
export const RELOAD_EVENT = "n6k:reload";

export function entryId(key: string): string {
  return ENTRY + encodeURIComponent(key);
}

export function cssId(key: string): string {
  return `${CSS + encodeURIComponent(key)}.css`;
}

export function entryUrl(key: string): string {
  return `/@id/${entryId(key).replace("\0", "__x00__")}`;
}

function keyOf(id: string, prefix: string): string {
  return decodeURIComponent(id.slice(prefix.length).replace(/\.css$/, ""));
}

function entryModule(page: PageSource): string {
  const key = JSON.stringify(page.key);
  return `import { createElement } from "react";
import { createRoot } from "react-dom/client";
import Root from ${JSON.stringify(path.join(SRC_DIR, "root.tsx"))};
import Page from ${JSON.stringify(page.file)};
import ${JSON.stringify(`${CSS_IMPORT}${encodeURIComponent(page.key)}.css`)};
createRoot(document.getElementById("root")).render(
  createElement(Root, ${JSON.stringify(page.rootProps())}, createElement(Page)),
);
import.meta.hot?.on(${JSON.stringify(RELOAD_EVENT)}, (key) => {
  if (key === ${key}) location.reload();
});
`;
}

// Vite checks fs.allow and reports watcher events against real paths.
function realPath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

export function allowFs(config: ResolvedConfig, file: string): void {
  const allow = config.server.fs.allow;
  const dir = path.dirname(realPath(file));
  for (const d of [dir, ...nodeModulesChain(dir)]) {
    if (!allow.includes(d)) allow.push(d);
  }
}

// Pages live outside SERVE_ROOT and may lack their own node_modules; bare
// imports retry from SRC_DIR, as esbuild's nodePaths did.
function resolveFallback(): Plugin {
  const fromServe = path.join(SRC_DIR, "root.tsx");
  return {
    name: "n6k-resolve-fallback",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(SERVE_ROOT + path.sep)) return;
      if (/^[./\0]|^[a-z]+:/i.test(source) || path.isAbsolute(source)) return;
      const own = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return (
        own ?? this.resolve(source, fromServe, { ...options, skipSelf: true })
      );
    },
  };
}

function mdx(): Plugin {
  const mdxComponents = path.join(SRC_DIR, "mdx-components.tsx");
  return {
    name: "n6k-mdx",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?", 1)[0]!;
      if (!file.endsWith(".mdx")) return;
      const { code: out } = await compileN6kMdx(code, {
        slug: path.basename(file),
        mdxComponents,
      });
      return { code: out, map: null };
    },
  };
}

function pages(page: (key: string) => PageSource | undefined): Plugin {
  let config: ResolvedConfig;
  const find = (key: string): PageSource => {
    const found = page(key);
    if (!found) throw new Error(`no page ${JSON.stringify(key)}`);
    return found;
  };
  return {
    name: "n6k-pages",
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(source) {
      if (source.startsWith(ENTRY)) return source;
      if (source.startsWith(CSS_IMPORT))
        return CSS + source.slice(CSS_IMPORT.length);
    },
    load(id) {
      if (id.startsWith(ENTRY)) {
        const found = find(keyOf(id, ENTRY));
        allowFs(config, found.file);
        return entryModule(found);
      }
      if (id.startsWith(CSS)) return buildCss(find(keyOf(id, CSS)).file);
    },
    hotUpdate({ file, modules }) {
      if (this.environment.name !== "client") return;
      const graph = this.environment.moduleGraph;
      const css = [...graph.idToModuleMap.values()].filter(
        (mod) =>
          mod.id?.startsWith(CSS) &&
          realPath(page(keyOf(mod.id, CSS))?.file ?? "") === file,
      );
      if (css.length === 0) return;
      for (const mod of css) graph.invalidateModule(mod);
      return [...modules, ...css];
    },
  };
}

export function n6kServePlugins(
  page: (key: string) => PageSource | undefined,
): Plugin[] {
  return [resolveFallback(), mdx(), pages(page)];
}
