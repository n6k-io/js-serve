#!/usr/bin/env bun
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import { parseAttachUrls } from "@n6k.io/build/pipeline";
import { DataArgError, resolveData, type DataSource } from "./data-args";
import { bundlePage } from "./bundle";
import { buildCss } from "./css";
import { hasWasmExtensions } from "./assets";
import { parsePages, type PagesConfig } from "./pages";
import { PagesSite } from "./pages-site";
import {
  SECRET_PARAM,
  reloadPage,
  startServer,
  type PageState,
  type ServeOptions,
  type ServedPage,
  type Site,
} from "./server";
import { watchFile } from "./watch";
import { McpSite, startMcp } from "./mcp";
import { OidcError, OidcLogins, type OidcSession } from "./oidc";
import { LogoutError, logout } from "./logout";
import { SRC_DIR } from "./paths";
import pkg from "../package.json";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const collect = (value: string, acc: string[]): string[] => [...acc, value];

type ServerFlags = { port: string; host: string; origin: string[] };
type DataFlags = { data: string[]; oidcLogin: boolean };

function withServerFlags(cmd: Command): Command {
  return cmd
    .option("--port <port>", "port to listen on", "3000")
    .option("--host <host>", "host to bind", "127.0.0.1")
    .option("--origin <origin>", "allowed origin (repeatable)", collect, []);
}

function withDataFlags(cmd: Command): Command {
  return cmd
    .option("--data <[alias=]ws://…>", "data source (repeatable)", collect, [])
    .option("--oidc-login", "sign in to data sources with OIDC", false);
}

function serveOptions(flags: ServerFlags): ServeOptions {
  const port = Number(flags.port);
  if (!Number.isInteger(port) || port < 0)
    fail(`--port ${flags.port}: not a port`);
  if (!hasWasmExtensions())
    fail("n6k duckdb wasm extensions missing from @n6k.io/db");
  return { hostname: flags.host, port, origins: flags.origin };
}

const program = new Command("n6k-serve")
  .description(pkg.description)
  .version(pkg.version);

withDataFlags(withServerFlags(program.command("page")))
  .description("serve one .mdx page")
  .argument("<page.mdx>")
  .action(async (arg: string, flags: ServerFlags & DataFlags) => {
    await servePage(arg, flags, serveOptions(flags));
  });

withServerFlags(program.command("site"))
  .description("serve the pages listed in a pages.yml")
  .argument("<pages.yml>")
  .action((arg: string, flags: ServerFlags) => {
    servePages(arg, serveOptions(flags));
  });

withDataFlags(withServerFlags(program.command("sql")))
  .description("serve the SQL editor")
  .option("--console", "serve the SQL console instead of the editor", false)
  .action(async (flags: ServerFlags & DataFlags & { console: boolean }) => {
    await servePage(
      path.join(SRC_DIR, "sql", flags.console ? "console.mdx" : "editor.mdx"),
      flags,
      serveOptions(flags),
      true,
    );
  });

withServerFlags(program.command("mcp"))
  .description("serve pages driven by an MCP client over stdio")
  .action((flags: ServerFlags) => {
    serveMcp(serveOptions(flags));
  });

program
  .command("logout")
  .description("list saved sign-ins, or sign out")
  .argument("[url]", "ws://host[:port]")
  .option("--all", "sign out of all", false)
  .action(async (url: string | undefined, flags: { all: boolean }) => {
    if (url !== undefined && flags.all)
      fail("logout: give a URL or --all, not both");
    try {
      for (const out of await logout(url, flags.all)) console.error(out);
    } catch (err) {
      if (err instanceof LogoutError) fail(err.message);
      throw err;
    }
    process.exit(0);
  });

await program.parseAsync();

async function servePage(
  arg: string,
  flags: DataFlags,
  options: ServeOptions,
  bare = false,
): Promise<void> {
  const mdxPath = path.resolve(arg);
  if (!mdxPath.endsWith(".mdx")) fail(`${arg}: not an .mdx file`);
  if (!existsSync(mdxPath)) fail(`${arg}: no such file`);
  const dataFlags = flags.data;
  const logins = flags.oidcLogin ? new OidcLogins() : undefined;

  const login = async (
    sources: Record<string, DataSource>,
  ): Promise<Map<string, OidcSession>> => {
    const out = new Map<string, OidcSession>();
    if (!logins) return out;
    for (const [alias, { url, token }] of Object.entries(sources)) {
      if (token === "") out.set(alias, await logins.sessionFor(url));
    }
    return out;
  };

  const resolveDataFor = (): Record<string, DataSource> =>
    resolveData(parseAttachUrls(readFileSync(mdxPath, "utf8")), dataFlags);

  const build = async (
    sources: Record<string, DataSource>,
    oidc: string[],
  ): Promise<PageState> => {
    const entries = Object.entries(sources);
    const [bundle, css] = await Promise.all([
      bundlePage(mdxPath, {
        data: Object.fromEntries(entries.map(([a, s]) => [a, s.url])),
        tokens: Object.fromEntries(entries.map(([a, s]) => [a, s.token])),
        oidc,
        bare,
      }),
      buildCss(mdxPath),
    ]);
    return { bundle, css };
  };

  let data: Record<string, DataSource>;
  let sessions: Map<string, OidcSession>;
  try {
    data = resolveDataFor();
    sessions = await login(data);
  } catch (err) {
    if (err instanceof DataArgError || err instanceof OidcError)
      fail(err.message);
    throw err;
  }
  let state = await build(data, [...sessions.keys()]);
  const page: ServedPage = {
    title: path.basename(mdxPath),
    key: "",
    state: () => Promise.resolve(state),
  };
  const site: Site = {
    resolve: (pathname) => ({ kind: "page", page, rest: pathname }),
    page: (key) => (key === "" ? page : undefined),
  };
  const secret = logins
    ? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64url",
      )
    : undefined;
  const server = startServer(site, {
    ...options,
    token: (alias) => sessions.get(alias)?.token(),
    secret,
  });

  const url = new URL(server.url);
  if (secret) url.searchParams.set(SECRET_PARAM, secret);
  console.error(`n6k-serve ${url}`);
  const flagged = new Set(Object.keys(resolveData({}, dataFlags)));
  const rows = Object.entries(data).map(([alias, { url }]) => {
    const tags = [flagged.has(alias) ? "--data" : "attach:"];
    if (sessions.has(alias)) tags.push("oidc");
    return [`${alias}=${url}`, `(${tags.join(", ")})`];
  });
  if (rows.length > 0) {
    const width = Math.max(...rows.map(([entry]) => entry!.length));
    console.error("\ndata:");
    for (const [entry, tags] of rows)
      console.error(`  ${entry!.padEnd(width)}  ${tags}`);
  }

  watchFile(mdxPath, async () => {
    try {
      const nextData = resolveDataFor();
      const nextSessions = await login(nextData);
      state = await build(nextData, [...nextSessions.keys()]);
      data = nextData;
      sessions = nextSessions;
      reloadPage(server, "");
      console.error(`rebuilt ${path.basename(mdxPath)}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  });
}

function servePages(arg: string, options: ServeOptions): void {
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

function serveMcp(options: ServeOptions): void {
  const site = new McpSite((key) => reloadPage(server, key));
  const server = startServer(site, options);
  console.error(`n6k-serve ${server.url}`);
  startMcp(site, server, pkg.version, () => process.exit(0));
}
