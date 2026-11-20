import { createReadStream, realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createLogger,
  createServer,
  type Logger,
  type Plugin,
  type ViteDevServer,
} from "vite";
import react from "@vitejs/plugin-react";
import {
  bundleN6kDuckDB,
  crossOriginIsolation,
  n6kWasmExtensions,
} from "@n6k.io/build/vite";
import { findFont } from "./assets";
import {
  SECRET_MESSAGES,
  SECRET_PARAM,
  refusalPage,
  sameSecret,
  secretCookie,
  secretProblem,
  type SecretProblem,
} from "./secret";
import { SERVE_NODE_MODULES, SERVE_ROOT, SRC_DIR } from "./paths";
import {
  RELOAD_EVENT,
  cssId,
  entryId,
  entryUrl,
  n6kServePlugins,
  type PageSource,
} from "./vite-plugin";

export type ServedPage = PageSource & { title: string };

export type Resolved =
  | { kind: "page"; page: ServedPage; rest: string }
  | { kind: "redirect"; to: string }
  | { kind: "html"; body: string };

export type Site = {
  resolve: (pathname: string) => Resolved | undefined;
  page: (key: string) => ServedPage | undefined;
};

export type ServeOptions = {
  hostname: string;
  port: number;
  origins: string[];
  token?: (alias: string) => Promise<string> | undefined;
  secret?: string;
};

export type Server = {
  url: string;
  port: number;
  vite: ViteDevServer;
  stop: () => Promise<void>;
};

export const TOKEN_PREFIX = "/_n6k/token/";
function shell(page: ServedPage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${Bun.escapeHTML(page.title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${entryUrl(page.key)}"></script>
  </body>
</html>`;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "Content-Type": "text/plain", ...headers });
  res.end(body);
}

function logToStderr(msg: string): void {
  console.error(msg);
}

// stdout carries the MCP stdio transport.
function stderrLogger(): Logger {
  const base = createLogger("info", { allowClearScreen: false });
  return {
    ...base,
    info: logToStderr,
    warn: logToStderr,
    warnOnce: logToStderr,
    error: logToStderr,
  };
}

function redirectWithSecret(
  res: ServerResponse,
  url: URL,
  cookie: string,
  secret: string,
): void {
  if (!sameSecret(url.searchParams.get(SECRET_PARAM), secret))
    return send(res, 403, "wrong secret");
  url.searchParams.delete(SECRET_PARAM);
  res.writeHead(303, {
    Location: url.pathname + url.search,
    "Set-Cookie": `${cookie}=${secret}; Path=/; HttpOnly; SameSite=Lax`,
  });
  res.end();
}

async function serveToken(
  options: ServeOptions,
  res: ServerResponse,
  alias: string,
  refused: () => SecretProblem | undefined,
): Promise<void> {
  const problem = refused();
  if (problem) return send(res, 403, SECRET_MESSAGES[problem]);
  const pending = options.token?.(alias);
  if (!pending) return send(res, 404, `no token for ${alias}`);
  try {
    send(res, 200, await pending, { "Cache-Control": "no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`token for ${alias}: ${message}`);
    send(res, 502, message);
  }
}

async function serveSite(
  vite: ViteDevServer,
  site: Site,
  res: ServerResponse,
  pathname: string,
  refused: () => SecretProblem | undefined,
): Promise<boolean> {
  const resolved = site.resolve(pathname);
  if (resolved?.kind === "redirect") {
    res.writeHead(308, { Location: resolved.to });
    res.end();
    return true;
  }
  const html = { "Content-Type": "text/html; charset=utf-8" };
  if (resolved?.kind === "html") {
    send(res, 200, resolved.body, html);
    return true;
  }
  if (resolved?.kind !== "page" || resolved.rest !== "/") return false;
  const problem = refused();
  if (problem) {
    send(res, 403, refusalPage(problem), html);
    return true;
  }
  send(
    res,
    200,
    await vite.transformIndexHtml(pathname, shell(resolved.page)),
    html,
  );
  return true;
}

function serveFont(res: ServerResponse, pathname: string): boolean {
  const font = pathname.startsWith("/files/")
    ? findFont(pathname.slice("/files/".length))
    : undefined;
  if (!font) return false;
  res.writeHead(200, {
    "Content-Type": "font/woff2",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  createReadStream(font).pipe(res);
  return true;
}

function routes(site: Site, options: ServeOptions, port: () => number): Plugin {
  const logged = new Set<SecretProblem>();
  const refused = (
    req: IncomingMessage,
    cookie: string,
  ): SecretProblem | undefined => {
    if (options.secret === undefined) return undefined;
    const problem = secretProblem(req, cookie, options.secret);
    if (problem && !logged.has(problem)) {
      logged.add(problem);
      console.error(SECRET_MESSAGES[problem]);
    }
    return problem;
  };
  const handle = async (
    vite: ViteDevServer,
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://n6k");
    const { pathname } = url;
    const cookie = secretCookie(port());
    if (options.secret !== undefined && url.searchParams.has(SECRET_PARAM))
      return redirectWithSecret(res, url, cookie, options.secret);
    const check = () => refused(req, cookie);
    if (pathname.startsWith(TOKEN_PREFIX))
      return serveToken(
        options,
        res,
        pathname.slice(TOKEN_PREFIX.length),
        check,
      );
    if (await serveSite(vite, site, res, pathname, check)) return;
    if (serveFont(res, pathname)) return;
    const problem = check();
    if (problem) return send(res, 403, SECRET_MESSAGES[problem]);
    next();
  };

  return {
    name: "n6k-serve-routes",
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        handle(vite, req, res, next).catch(next);
      });
    },
  };
}

export async function startServer(
  site: Site,
  options: ServeOptions,
): Promise<Server> {
  let port = options.port;
  const vite = await createServer({
    root: SERVE_ROOT,
    configFile: false,
    envDir: false,
    publicDir: false,
    appType: "custom",
    clearScreen: false,
    customLogger: stderrLogger(),
    plugins: [
      crossOriginIsolation(),
      routes(site, options, () => port),
      bundleN6kDuckDB(),
      n6kWasmExtensions(),
      ...n6kServePlugins(site.page),
      react({ include: /\.(mdx|[jt]sx?)$/ }),
    ],
    resolve: { dedupe: ["react", "react-dom"] },
    optimizeDeps: {
      entries: [`${SRC_DIR}/root.tsx`, `${SRC_DIR}/mdx-components.tsx`],
      include: ["react", "react-dom/client", "react/jsx-dev-runtime"],
    },
    server: {
      host: options.hostname,
      port: options.port,
      strictPort: true,
      ...(options.origins.length > 0 && { cors: { origin: options.origins } }),
      fs: { allow: [SERVE_ROOT, ...SERVE_NODE_MODULES] },
    },
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("vite: no TCP address after listen");
  port = address.port;
  const url =
    vite.resolvedUrls?.local[0] ?? `http://${options.hostname}:${port}/`;
  return { url, port, vite, stop: () => vite.close() };
}

function invalidate(server: Server, key: string): void {
  const { moduleGraph } = server.vite.environments.client;
  for (const id of [entryId(key), cssId(key)]) {
    const mod = moduleGraph.getModuleById(id);
    if (mod) moduleGraph.invalidateModule(mod);
  }
}

export function reloadPage(server: Server, key: string): void {
  invalidate(server, key);
  server.vite.environments.client.hot.send(RELOAD_EVENT, key);
}

// Surfaces compile and import-resolution errors across the page's own import
// graph without a browser; Vite only warms nested imports, unawaited. Starting
// from the entry lets import analysis mark the page file as servable. The file
// may have just been written, ahead of the watcher event that would invalidate it.
export async function checkPage(
  server: Server,
  page: ServedPage,
): Promise<void> {
  const client = server.vite.environments.client;
  const { moduleGraph } = client;
  for (const mod of moduleGraph.getModulesByFile(realpathSync(page.file)) ?? [])
    moduleGraph.invalidateModule(mod);
  const seen = new Set<string>();
  const visit = async (url: string): Promise<void> => {
    if (seen.has(url) || url.includes("/node_modules/")) return;
    seen.add(url);
    await client.transformRequest(url);
    const mod = await moduleGraph.getModuleByUrl(url);
    await Promise.all(
      [...(mod?.importedModules ?? [])].map((dep) => visit(dep.url)),
    );
  };
  await visit(entryId(page.key));
}
