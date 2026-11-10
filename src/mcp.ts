import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { bundlePage } from "./bundle";
import { buildCss } from "./css";
import { describeComponent, searchComponents } from "./component-docs";
import { ALIAS } from "./data-args";
import { INSTRUCTIONS } from "./mcp-instructions";
import { PagesError, name } from "./pages";
import type { PageState, ServedPage, Server, Site } from "./server";
import { watchFile } from "./watch";

export type DataSource = { url: string; token: string };

type Entry = {
  file: string;
  served: ServedPage;
  cached?: Promise<PageState>;
  unwatch: () => void;
};

function listing(pages: string[]): string {
  const items = pages.map(
    (page) => `<li><a href="/${page}/">${Bun.escapeHTML(page)}</a></li>`,
  );
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>n6k-serve</title></head>
  <body><ul>${items.join("")}</ul></body>
</html>`;
}

export class McpSite implements Site {
  private readonly entries = new Map<string, Entry>();
  private readonly data = new Map<string, DataSource>();

  constructor(private readonly onChange: (key: string) => void) {}

  resolve: Site["resolve"] = (pathname) => {
    if (pathname === "/")
      return { kind: "html", body: listing([...this.entries.keys()]) };
    const [, page, ...rest] = pathname.split("/");
    const entry = this.entries.get(page);
    if (!entry) return;
    if (rest.length === 0) return { kind: "redirect", to: `${pathname}/` };
    return { kind: "page", page: entry.served, rest: `/${rest.join("/")}` };
  };

  page: Site["page"] = (key) => this.entries.get(key)?.served;

  upstream: Site["upstream"] = (alias) => this.data.get(alias)?.url;

  setData(alias: string, source: DataSource): void {
    this.data.set(alias, source);
    this.rebuildAll();
  }

  removeData(alias: string): void {
    if (!this.data.delete(alias)) throw new PagesError(`no data ${alias}`);
    this.rebuildAll();
  }

  private rebuildAll(): void {
    for (const [page, entry] of this.entries) {
      entry.cached = undefined;
      this.onChange(page);
    }
  }

  list(): { page: string; file: string }[] {
    return [...this.entries].map(([page, { file }]) => ({ page, file }));
  }

  set(page: string, file: string): ServedPage {
    const existing = this.entries.get(page);
    if (existing?.file === file) {
      existing.cached = undefined;
      this.onChange(page);
      return existing.served;
    }
    existing?.unwatch();
    const entry: Entry = {
      file,
      served: {
        title: path.basename(file),
        key: page,
        state: () => {
          if (entry.cached) return entry.cached;
          const built = this.build(file);
          entry.cached = built;
          built.catch(() => {
            if (entry.cached === built) entry.cached = undefined;
          });
          return built;
        },
      },
      unwatch: watchFile(file, () => {
        entry.cached = undefined;
        this.onChange(page);
        console.error(`changed ${page}`);
      }),
    };
    this.entries.set(page, entry);
    if (existing) this.onChange(page);
    return entry.served;
  }

  remove(page: string): void {
    const entry = this.entries.get(page);
    if (!entry) throw new PagesError(`no page ${page}`);
    entry.unwatch();
    this.entries.delete(page);
  }

  private async build(file: string): Promise<PageState> {
    const [bundle, css] = await Promise.all([
      bundlePage(file, {
        aliases: [...this.data.keys()],
        dataPath: "/_n6k/data/",
        tokens: Object.fromEntries(
          [...this.data].map(([alias, { token }]) => [alias, token]),
        ),
      }),
      buildCss(file),
    ]);
    return { bundle, css };
  }
}

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value),
      },
    ],
  };
}

export function startMcp(
  site: McpSite,
  server: Server,
  version: string,
  onClose: () => void,
): void {
  const inlineDir = mkdtempSync(path.join(os.tmpdir(), "n6k-serve-"));
  const urlOf = (page: string) => new URL(`${page}/`, server.url).href;
  const mcp = new McpServer(
    { name: "n6k-serve", version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  mcp.registerTool(
    "search_components",
    {
      description:
        "Search components and controls by name or description; omit query to list all.",
      inputSchema: z.object({ query: z.string().optional() }),
    },
    ({ query }) => text(searchComponents(query)),
  );

  mcp.registerTool(
    "describe_component",
    {
      description: "Props and description of one component or control.",
      inputSchema: z.object({ name: z.string() }),
    },
    ({ name: component }) => text(describeComponent(component)),
  );

  mcp.registerTool(
    "list_pages",
    { description: "List served pages with their URLs." },
    () => text(site.list().map((p) => ({ ...p, url: urlOf(p.page) }))),
  );

  mcp.registerTool(
    "set_page",
    {
      description:
        "Serve a page from an absolute .mdx path or inline mdx content (exactly one), build it, and return its URL or the build error.",
      inputSchema: z.object({
        page: z.string(),
        path: z.string().optional(),
        mdx: z.string().optional(),
      }),
    },
    async ({ page, path: file, mdx }) => {
      name(page, "page");
      if ((file === undefined) === (mdx === undefined))
        throw new PagesError("pass exactly one of path or mdx");
      let abs: string;
      if (mdx === undefined) {
        abs = file ?? "";
        if (!path.isAbsolute(abs))
          throw new PagesError(`${abs}: path must be absolute`);
        if (!abs.endsWith(".mdx"))
          throw new PagesError(`${abs}: not an .mdx file`);
        if (!existsSync(abs)) throw new PagesError(`${abs}: no such file`);
      } else {
        abs = path.join(inlineDir, `${page}.mdx`);
        await Bun.write(abs, mdx);
      }
      await site.set(page, abs).state();
      return text(urlOf(page));
    },
  );

  mcp.registerTool(
    "set_data",
    {
      description:
        "Attach a data source as `alias` (also the server catalog name). Rebuilds and reloads every page.",
      inputSchema: z.object({
        alias: z.string(),
        url: z.string(),
        token: z.string(),
      }),
    },
    ({ alias, url, token }) => {
      if (!ALIAS.test(alias))
        throw new PagesError(
          `alias ${JSON.stringify(alias)} must match ${ALIAS.source}`,
        );
      if (!URL.canParse(url) || !/^wss?:$/.test(new URL(url).protocol))
        throw new PagesError(
          `${JSON.stringify(url)} is not a ws:// or wss:// URL`,
        );
      site.setData(alias, { url, token });
      return text(`set data ${alias}`);
    },
  );

  mcp.registerTool(
    "remove_data",
    {
      description: "Detach a data source. Rebuilds and reloads every page.",
      inputSchema: z.object({ alias: z.string() }),
    },
    ({ alias }) => {
      site.removeData(alias);
      return text(`removed data ${alias}`);
    },
  );

  mcp.registerTool(
    "remove_page",
    {
      description: "Stop serving a page.",
      inputSchema: z.object({ page: z.string() }),
    },
    ({ page }) => {
      site.remove(page);
      return text(`removed ${page}`);
    },
  );

  const transport = new StdioServerTransport();
  // eslint-disable-next-line unicorn/prefer-add-event-listener -- Transport has no addEventListener
  transport.onclose = () => {
    void server.stop(true);
    rmSync(inlineDir, { recursive: true, force: true });
    onClose();
  };
  void mcp.connect(transport);
}
