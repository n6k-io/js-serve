#!/usr/bin/env bun
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseAttachUrls } from "@n6k.io/build/pipeline";
import { DataArgError, resolveData } from "./data-args";
import { bundlePage } from "./bundle";
import { buildCss } from "./css";
import { hasWasmExtensions } from "./assets";
import { parsePages, type PagesConfig } from "./pages";
import { PagesSite } from "./pages-site";
import {
  reloadPage,
  startServer,
  type PageState,
  type ServeOptions,
  type ServedPage,
  type Site,
} from "./server";
import { watchFile } from "./watch";
import { McpSite, startMcp } from "./mcp";
import pkg from "../package.json";

const USAGE = `usage: n6k-serve <page.mdx> [--data [alias=]ws://…]... [options]
       n6k-serve --pages <pages.yml> [options]
       n6k-serve --mcp [options]
options: [--port 3000] [--host 127.0.0.1] [--origin <origin>]...`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    data: { type: "string", multiple: true, default: [] },
    pages: { type: "string" },
    mcp: { type: "boolean", default: false },
    port: { type: "string", default: "3000" },
    host: { type: "string", default: "127.0.0.1" },
    origin: { type: "string", multiple: true, default: [] },
  },
  allowPositionals: true,
  strict: true,
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0)
  fail(`--port ${values.port}: not a port`);
if (!hasWasmExtensions())
  fail("n6k duckdb wasm extensions missing from @n6k.io/db");

const options: ServeOptions = {
  hostname: values.host,
  port,
  origins: values.origin,
};

if (values.mcp) {
  if (
    positionals.length > 0 ||
    values.pages !== undefined ||
    values.data.length > 0
  )
    fail(USAGE);
  serveMcp();
} else if (values.pages === undefined) {
  if (positionals.length !== 1) fail(USAGE);
  await servePage(positionals[0]);
} else {
  if (positionals.length > 0 || values.data.length > 0) fail(USAGE);
  servePages(values.pages);
}

async function servePage(arg: string): Promise<void> {
  const mdxPath = path.resolve(arg);
  if (!mdxPath.endsWith(".mdx")) fail(`${arg}: not an .mdx file`);
  if (!existsSync(mdxPath)) fail(`${arg}: no such file`);
  const dataFlags = values.data;

  const resolveDataFor = (): Record<string, string> =>
    resolveData(parseAttachUrls(readFileSync(mdxPath, "utf8")), dataFlags);

  const build = async (aliases: string[]): Promise<PageState> => {
    const [bundle, css] = await Promise.all([
      bundlePage(mdxPath, { aliases, dataPath: "/_n6k/data/", tokens: {} }),
      buildCss(mdxPath),
    ]);
    return { bundle, css };
  };

  let data: Record<string, string>;
  try {
    data = resolveDataFor();
  } catch (err) {
    if (err instanceof DataArgError) fail(err.message);
    throw err;
  }
  let state = await build(Object.keys(data));
  const page: ServedPage = {
    title: path.basename(mdxPath),
    key: "",
    state: () => Promise.resolve(state),
  };
  const site: Site = {
    resolve: (pathname) => ({ kind: "page", page, rest: pathname }),
    page: (key) => (key === "" ? page : undefined),
    upstream: (alias) => data[alias],
  };
  const server = startServer(site, options);

  console.error(`n6k-serve ${server.url}`);
  for (const [alias, url] of Object.entries(data)) {
    console.error(`  ${alias} → ${url}`);
  }

  watchFile(mdxPath, async () => {
    try {
      const nextData = resolveDataFor();
      state = await build(Object.keys(nextData));
      data = nextData;
      reloadPage(server, "");
      console.error(`rebuilt ${path.basename(mdxPath)}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  });
}

function servePages(arg: string): void {
  const file = path.resolve(arg);
  const load = (): PagesConfig => parsePages(readFileSync(file, "utf8"), file);

  let config: PagesConfig;
  try {
    config = load();
  } catch (err) {
    if (err instanceof Error) fail(err.message);
    throw err;
  }

  const site = new PagesSite((key) => reloadPage(server, key));
  site.update(config);
  const server = startServer(site, options);
  console.error(`n6k-serve ${server.url}`);

  watchFile(file, () => {
    try {
      site.update(load());
      console.error(`reloaded ${path.basename(file)}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  });
}

function serveMcp(): void {
  const site = new McpSite((key) => reloadPage(server, key));
  const server = startServer(site, options);
  console.error(`n6k-serve ${server.url}`);
  startMcp(site, server, pkg.version, () => process.exit(0));
}
