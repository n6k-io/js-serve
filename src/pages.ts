import path from "node:path";
import { ALIAS } from "./data-args";

export type Gateway = { url: string; token: string; catalogs: string[] };
export type App = { gateway: Gateway; pages: Record<string, string> };
export type PagesConfig = Record<string, App>;

export type PageRef = { app: string; page: string };
export type PagesDiff = {
  added: PageRef[];
  removed: PageRef[];
  changed: PageRef[];
};

export class PagesError extends Error {}

const NAME = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PagesError(`${where}: expected a mapping`);
  return value;
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string" || value === "")
    throw new PagesError(`${where}: expected a non-empty string`);
  return value;
}

function name(value: string, where: string): string {
  if (!NAME.test(value))
    throw new PagesError(
      `${where}: ${JSON.stringify(value)} must match ${NAME.source}`,
    );
  return value;
}

function parseGateway(value: unknown, where: string): Gateway {
  const raw = record(value, where);
  const url = string(raw.url, `${where}.url`);
  if (!/^wss?:\/\//.test(url))
    throw new PagesError(
      `${where}.url: ${JSON.stringify(url)} is not ws(s)://`,
    );
  if (!Array.isArray(raw.catalogs))
    throw new PagesError(`${where}.catalogs: expected a list`);
  const catalogs = raw.catalogs.map((c, i) => {
    const catalog = string(c, `${where}.catalogs[${i}]`);
    if (!ALIAS.test(catalog))
      throw new PagesError(
        `${where}.catalogs[${i}]: ${JSON.stringify(catalog)} must match ${ALIAS.source}`,
      );
    return catalog;
  });
  return { url, token: string(raw.token, `${where}.token`), catalogs };
}

function parsePageFiles(
  value: unknown,
  where: string,
  baseDir: string,
): Record<string, string> {
  const pages: Record<string, string> = {};
  for (const [page, file] of Object.entries(record(value, where))) {
    const at = `${where}.${name(page, where)}`;
    const abs = path.resolve(baseDir, string(file, at));
    if (!abs.endsWith(".mdx")) throw new PagesError(`${at}: not an .mdx file`);
    pages[page] = abs;
  }
  return pages;
}

export function parsePages(text: string, file: string): PagesConfig {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(text);
  } catch (err) {
    throw new PagesError(
      `${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const root = record(doc ?? {}, file);
  const config: PagesConfig = {};
  const baseDir = path.dirname(file);
  for (const [app, value] of Object.entries(
    record(root.apps ?? {}, `${file}: apps`),
  )) {
    const where = `${file}: apps.${name(app, `${file}: apps`)}`;
    const raw = record(value, where);
    config[app] = {
      gateway: parseGateway(raw.gateway, `${where}.gateway`),
      pages: parsePageFiles(raw.pages ?? {}, `${where}.pages`, baseDir),
    };
  }
  return config;
}

function sameGateway(a: Gateway, b: Gateway): boolean {
  return (
    a.url === b.url &&
    a.token === b.token &&
    a.catalogs.join("\0") === b.catalogs.join("\0")
  );
}

export function diffPages(prev: PagesConfig, next: PagesConfig): PagesDiff {
  const diff: PagesDiff = { added: [], removed: [], changed: [] };
  for (const [app, { gateway, pages }] of Object.entries(next)) {
    const old = prev[app];
    for (const [page, file] of Object.entries(pages)) {
      const oldFile = old?.pages[page];
      if (oldFile === undefined) diff.added.push({ app, page });
      else if (oldFile !== file || !sameGateway(old.gateway, gateway))
        diff.changed.push({ app, page });
    }
  }
  for (const [app, { pages }] of Object.entries(prev)) {
    for (const page of Object.keys(pages)) {
      if (next[app]?.pages[page] === undefined)
        diff.removed.push({ app, page });
    }
  }
  return diff;
}
