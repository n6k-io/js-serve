import { wsUrl } from "@n6k.io/runtime/ws-url";

export const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_ALIAS = "db";

export class DataArgError extends Error {}

export type DataSource = { url: string; catalog: string; token: string };

export function toWsUrl(url: string, source: string): string {
  if (!/^(wss?|n6ks?):\/\//.test(url)) {
    throw new DataArgError(
      `${source}: ${JSON.stringify(url)} is not a n6k(s):// or ws(s):// URL`,
    );
  }
  return wsUrl(url);
}

function name(value: string, what: string, source: string): string {
  if (!ALIAS.test(value)) {
    throw new DataArgError(
      `${source}: ${what} ${JSON.stringify(value)} must match ${ALIAS.source}`,
    );
  }
  return value;
}

type Entry = { alias: string; catalog: string; url: string };

// `[alias[:catalog]=]url`; a `=` after the scheme belongs to the URL.
function parseFlag(flag: string): Entry {
  const eq = flag.indexOf("=");
  const schemeAt = flag.indexOf("://");
  if (eq === -1 || (schemeAt !== -1 && schemeAt < eq)) {
    return { alias: DEFAULT_ALIAS, catalog: DEFAULT_ALIAS, url: flag };
  }
  const [alias, catalog = alias, ...rest] = flag.slice(0, eq).split(":");
  if (rest.length > 0) {
    throw new DataArgError(
      `--data: ${JSON.stringify(flag)} must be [alias[:catalog]=]url`,
    );
  }
  return { alias: alias!, catalog, url: flag.slice(eq + 1) };
}

function source(entry: Entry, from: string): [string, DataSource] {
  const alias = name(entry.alias, "alias", from);
  const catalog = name(entry.catalog, "catalog", from);
  const raw = toWsUrl(entry.url, from);
  if (!URL.canParse(raw)) {
    throw new DataArgError(
      `${from}: ${JSON.stringify(entry.url)} is not a URL`,
    );
  }
  const url = new URL(raw);
  if (!url.username && !url.password)
    return [alias, { url: raw, catalog, token: "" }];
  if (from !== "--data") {
    throw new DataArgError(
      `${from}: credentials in ${JSON.stringify(url.host)} are only accepted from --data`,
    );
  }
  if (url.password) {
    throw new DataArgError(
      `${from}: use n6k://<token>@host, not user:password`,
    );
  }
  const token = decodeURIComponent(url.username);
  url.username = "";
  return [alias, { url: url.href, catalog, token }];
}

// Alias → source; `catalog` is the server catalog attached under the alias.
export function resolveData(
  frontmatter: Record<string, { url: string; catalog: string }>,
  dataFlags: string[],
): Record<string, DataSource> {
  const out: Record<string, DataSource> = {};
  for (const [alias, { url, catalog }] of Object.entries(frontmatter)) {
    const [a, s] = source({ alias, catalog, url }, "attach:");
    out[a] = s;
  }
  for (const flag of dataFlags) {
    const [a, s] = source(parseFlag(flag), "--data");
    out[a] = s;
  }
  return out;
}
