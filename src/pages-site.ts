import path from "node:path";
import { diffPages, type PagesConfig, type PageRef } from "./pages";
import type { ServedPage, Site } from "./server";

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
  private readonly entries = new Map<string, ServedPage>();

  constructor(private readonly onChange: (key: string) => void) {}

  update(next: PagesConfig): void {
    const prev = this.config;
    this.config = next;
    const diff = diffPages(prev, next);
    for (const ref of [...diff.removed, ...diff.changed])
      this.entries.delete(keyOf(ref));
    for (const ref of [...diff.added, ...diff.changed]) this.add(ref);
    for (const ref of diff.changed) this.onChange(keyOf(ref));
  }

  resolve: Site["resolve"] = (pathname) => {
    if (pathname === "/") return { kind: "html", body: listing(this.config) };
    const [, app, page, ...rest] = pathname.split("/");
    const entry = this.entries.get(`${app}/${page}`);
    if (!entry) return;
    if (rest.length === 0) return { kind: "redirect", to: `${pathname}/` };
    return { kind: "page", page: entry, rest: `/${rest.join("/")}` };
  };

  page: Site["page"] = (key) => this.entries.get(key);

  private add(ref: PageRef): void {
    const key = keyOf(ref);
    const file = this.config[ref.app].pages[ref.page];
    const { url, token, catalogs } = this.config[ref.app].gateway;
    const rootProps = {
      data: Object.fromEntries(catalogs.map((c) => [c, url])),
      tokens: Object.fromEntries(catalogs.map((c) => [c, token])),
    };
    this.entries.set(key, {
      title: path.basename(file),
      key,
      file,
      rootProps: () => rootProps,
    });
  }
}
