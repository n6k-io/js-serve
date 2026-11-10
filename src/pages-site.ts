import path from "node:path";
import { bundlePage } from "./bundle";
import { buildCss } from "./css";
import { diffPages, type PagesConfig, type PageRef } from "./pages";
import type { PageState, ServedPage, Site } from "./server";
import { watchFile } from "./watch";

type Entry = {
  served: ServedPage;
  unwatch: () => void;
  cached?: Promise<PageState>;
};

function keyOf({ app, page }: PageRef): string {
  return `${app}/${page}`;
}

function listing(config: PagesConfig): string {
  const items = Object.entries(config).flatMap(([app, { pages }]) =>
    Object.keys(pages).map((page) => {
      const href = `/${app}/${page}/`;
      return `<li><a href="${href}">${Bun.escapeHTML(`${app}/${page}`)}</a></li>`;
    }),
  );
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>n6k-serve</title></head>
  <body><ul>${items.join("")}</ul></body>
</html>`;
}

export class PagesSite implements Site {
  private config: PagesConfig = {};
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly onChange: (key: string) => void) {}

  update(next: PagesConfig): void {
    const prev = this.config;
    this.config = next;
    const diff = diffPages(prev, next);
    for (const ref of [...diff.removed, ...diff.changed]) this.drop(ref);
    for (const ref of [...diff.added, ...diff.changed]) this.add(ref);
    for (const ref of diff.changed) this.onChange(keyOf(ref));
  }

  resolve: Site["resolve"] = (pathname) => {
    if (pathname === "/") return { kind: "html", body: listing(this.config) };
    const [, app, page, ...rest] = pathname.split("/");
    const entry = this.entries.get(`${app}/${page}`);
    if (!entry) return;
    if (rest.length === 0) return { kind: "redirect", to: `${pathname}/` };
    return { kind: "page", page: entry.served, rest: `/${rest.join("/")}` };
  };

  page: Site["page"] = (key) => this.entries.get(key)?.served;

  upstream: Site["upstream"] = (rest) => {
    const [app, catalog] = rest.split("/");
    const gateway = this.config[app]?.gateway;
    if (!gateway?.catalogs.includes(catalog)) return;
    return gateway.url;
  };

  private add(ref: PageRef): void {
    const key = keyOf(ref);
    const file = this.config[ref.app].pages[ref.page];
    const { token, catalogs } = this.config[ref.app].gateway;
    const entry: Entry = {
      served: {
        title: path.basename(file),
        key,
        state: () => {
          if (entry.cached) return entry.cached;
          const built = this.build(file, ref.app, catalogs, token);
          entry.cached = built;
          built.catch(() => {
            if (entry.cached === built) entry.cached = undefined;
          });
          return built;
        },
      },
      unwatch: () => {},
    };
    try {
      entry.unwatch = watchFile(file, () => {
        entry.cached = undefined;
        this.onChange(key);
        console.log(`changed ${key}`);
      });
    } catch (err) {
      console.error(
        `${key}: cannot watch ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.entries.set(key, entry);
  }

  private drop(ref: PageRef): void {
    const key = keyOf(ref);
    this.entries.get(key)?.unwatch();
    this.entries.delete(key);
  }

  private async build(
    file: string,
    app: string,
    catalogs: string[],
    token: string,
  ): Promise<PageState> {
    const [bundle, css] = await Promise.all([
      bundlePage(file, {
        aliases: catalogs,
        dataPath: `/_n6k/data/${app}/`,
        token,
      }),
      buildCss(file),
    ]);
    return { bundle, css };
  }
}
