#!/usr/bin/env bun
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseAttachUrls } from "@n6k.io/build/pipeline";
import { DataArgError, resolveData } from "./data-args";
import { bundlePage } from "./bundle";
import { buildCss } from "./css";
import { hasWasmExtensions } from "./assets";
import { reloadClients, startServer, type ServeState } from "./server";
import { watchFile } from "./watch";

const USAGE =
  "usage: n6k-serve <page.mdx> [--data [alias=]ws://…]... [--port 3000]";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    data: { type: "string", multiple: true, default: [] },
    port: { type: "string", default: "3000" },
  },
  allowPositionals: true,
  strict: true,
});

if (positionals.length !== 1) fail(USAGE);
const mdxPath = path.resolve(positionals[0]);
if (!mdxPath.endsWith(".mdx")) fail(`${positionals[0]}: not an .mdx file`);
if (!existsSync(mdxPath)) fail(`${positionals[0]}: no such file`);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0)
  fail(`--port ${values.port}: not a port`);
if (!hasWasmExtensions())
  fail("n6k duckdb wasm extensions missing from @n6k.io/db");

const dataFlags = values.data ?? [];

function resolveDataFor(file: string): Record<string, string> {
  try {
    return resolveData(parseAttachUrls(readFileSync(file, "utf8")), dataFlags);
  } catch (err) {
    if (err instanceof DataArgError) fail(err.message);
    throw err;
  }
}

async function build(data: Record<string, string>): Promise<ServeState> {
  const [bundle, css] = await Promise.all([
    bundlePage(mdxPath, Object.keys(data)),
    buildCss(mdxPath),
  ]);
  return { bundle, css, data };
}

const state = await build(resolveDataFor(mdxPath));
const server = startServer(mdxPath, port, state);

console.log(`n6k-serve ${server.url}`);
for (const [alias, url] of Object.entries(state.data)) {
  console.log(`  ${alias} → ${url}`);
}

watchFile(mdxPath, async () => {
  try {
    const data = resolveData(
      parseAttachUrls(readFileSync(mdxPath, "utf8")),
      dataFlags,
    );
    Object.assign(state, await build(data));
    reloadClients(server);
    console.log(`rebuilt ${path.basename(mdxPath)}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
  }
});
