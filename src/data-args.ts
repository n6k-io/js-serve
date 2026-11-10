export const ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_ALIAS = "db";

export class DataArgError extends Error {}

function checked(alias: string, url: string, source: string): [string, string] {
  if (!ALIAS.test(alias)) {
    throw new DataArgError(
      `${source}: alias ${JSON.stringify(alias)} must match ${ALIAS.source}`,
    );
  }
  if (!/^wss?:\/\//.test(url)) {
    throw new DataArgError(
      `${source}: ${JSON.stringify(url)} is not a ws:// or wss:// URL`,
    );
  }
  return [alias, url];
}

function parseFlag(flag: string): [string, string] {
  const eq = flag.indexOf("=");
  const schemeAt = flag.indexOf("://");
  if (eq === -1 || (schemeAt !== -1 && schemeAt < eq)) {
    return checked(DEFAULT_ALIAS, flag, "--data");
  }
  return checked(flag.slice(0, eq), flag.slice(eq + 1), "--data");
}

// Alias → URL. The alias is also the server catalog name the client attaches.
export function resolveData(
  frontmatterUrls: Record<string, string>,
  dataFlags: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [alias, url] of Object.entries(frontmatterUrls)) {
    const [a, u] = checked(alias, url, "attach:");
    out[a] = u;
  }
  for (const flag of dataFlags) {
    const [a, u] = parseFlag(flag);
    out[a] = u;
  }
  return out;
}
