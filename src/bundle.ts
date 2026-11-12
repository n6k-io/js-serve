import path from "node:path";
import * as esbuild from "esbuild";
import {
  n6kDuckDBPlugin,
  n6kWorkersPlugin,
  preprocess,
  virtualModulesPlugin,
} from "@n6k.io/build/pipeline";
import {
  SERVE_NODE_MODULES,
  SERVE_ROOT,
  SRC_DIR,
  nearestNodeModules,
  servePackageDir,
} from "./paths";

export type Bundle = Map<string, string>;

export type RootProps = {
  data: Record<string, string>;
  tokens: Record<string, string>;
  bare?: boolean;
};

export async function bundlePage(
  mdxPath: string,
  rootProps: RootProps,
): Promise<Bundle> {
  const mdxDir = path.dirname(mdxPath);
  const { entries, modules } = await preprocess(
    { index: mdxPath },
    {
      rootComponent: path.join(SRC_DIR, "root.tsx"),
      rootProps,
      mdxComponents: path.join(SRC_DIR, "mdx-components.tsx"),
    },
  );

  const pageNodeModules = nearestNodeModules(mdxDir);
  const result = await esbuild.build({
    entryPoints: entries,
    bundle: true,
    splitting: true,
    format: "esm",
    jsx: "automatic",
    write: false,
    outdir: "/",
    absWorkingDir: SERVE_ROOT,
    tsconfig: path.join(SERVE_ROOT, "tsconfig.json"),
    nodePaths: [
      ...SERVE_NODE_MODULES,
      ...(pageNodeModules && !SERVE_NODE_MODULES.includes(pageNodeModules)
        ? [pageNodeModules]
        : []),
    ],
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    logLevel: "silent",
    plugins: [
      virtualModulesPlugin(modules, mdxDir),
      n6kWorkersPlugin(undefined, { used: false }),
      n6kDuckDBPlugin(undefined, { used: false }),
    ],
    alias: {
      react: servePackageDir("react"),
      "react-dom": servePackageDir("react-dom"),
    },
  });

  const out: Bundle = new Map();
  for (const file of result.outputFiles) out.set(file.path, file.text);
  return out;
}
