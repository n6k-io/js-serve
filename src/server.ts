import type { ServerWebSocket } from "bun";
import type { Bundle } from "./bundle";
import { serveAsset } from "./assets";

export type PageState = {
  bundle: Bundle;
  css: string;
};

export type ServedPage = {
  title: string;
  key: string;
  state: () => Promise<PageState>;
};

export type Resolved =
  | { kind: "page"; page: ServedPage; rest: string }
  | { kind: "redirect"; to: string }
  | { kind: "html"; body: string };

export type Site = {
  resolve: (pathname: string) => Resolved | undefined;
  page: (key: string) => ServedPage | undefined;
  upstream: (path: string) => string | undefined;
};

export type ServeOptions = {
  hostname: string;
  port: number;
  origins: string[];
};

type SocketData =
  | { kind: "reload"; key: string }
  | {
      kind: "data";
      url: string;
      upstream?: WebSocket;
      pending: Frame[];
    };

type Frame = string | Uint8Array<ArrayBuffer>;

const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

const RELOAD_PREFIX = "/_n6k/reload/";
const DATA_PREFIX = "/_n6k/data/";

function topicFor(key: string): string {
  return `reload:${key}`;
}

function shell(page: ServedPage): string {
  const reload = JSON.stringify(RELOAD_PREFIX + page.key);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${Bun.escapeHTML(page.title)}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./index.js"></script>
    <script>
      (function connect() {
        const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + ${reload});
        ws.onmessage = () => location.reload();
        ws.onclose = () => setTimeout(connect, 1000);
      })();
    </script>
  </body>
</html>`;
}

function withIsolation(res: Response): Response {
  for (const [k, v] of Object.entries(ISOLATION)) res.headers.set(k, v);
  return res;
}

function html(body: string): Response {
  return withIsolation(
    new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  );
}

function contentType(file: string): string {
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".css")) return "text/css";
  return "application/octet-stream";
}

function openUpstream(ws: ServerWebSocket<SocketData>): void {
  const data = ws.data;
  if (data.kind !== "data") return;
  const upstream = new WebSocket(data.url);
  upstream.binaryType = "arraybuffer";
  data.upstream = upstream;
  upstream.addEventListener("open", () => {
    for (const msg of data.pending) upstream.send(msg);
    data.pending = [];
  });
  upstream.addEventListener("message", (ev) => {
    ws.send(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data));
  });
  upstream.addEventListener("close", (ev) => ws.close(1000, ev.reason));
  upstream.addEventListener("error", () => {
    console.error(`[n6k-serve] upstream ${data.url} failed`);
    ws.close(1011, `upstream ${data.url} failed`);
  });
}

async function servePage(
  page: ServedPage,
  rest: string,
): Promise<Response | undefined> {
  if (rest === "/") return html(shell(page));
  let state: PageState;
  try {
    state = await page.state();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return withIsolation(new Response(message, { status: 500 }));
  }
  if (rest === "/styles.css") {
    return withIsolation(
      new Response(state.css, { headers: { "Content-Type": "text/css" } }),
    );
  }
  const built = state.bundle.get(rest);
  if (!built) return undefined;
  return withIsolation(
    new Response(built, {
      headers: {
        "Content-Type": contentType(rest),
        "Cache-Control": "no-store",
      },
    }),
  );
}

export function startServer(site: Site, options: ServeOptions) {
  const originAllowed = (req: Request): boolean =>
    options.origins.length === 0 ||
    options.origins.includes(req.headers.get("origin") ?? "");

  return Bun.serve<SocketData>({
    hostname: options.hostname,
    port: options.port,
    async fetch(req, server) {
      const { pathname } = new URL(req.url);

      if (
        (pathname.startsWith(RELOAD_PREFIX) ||
          pathname.startsWith(DATA_PREFIX)) &&
        !originAllowed(req)
      ) {
        return new Response("origin not allowed", { status: 403 });
      }
      if (pathname.startsWith(RELOAD_PREFIX)) {
        const key = pathname.slice(RELOAD_PREFIX.length);
        if (!site.page(key))
          return new Response(`no page ${key}`, { status: 404 });
        if (server.upgrade(req, { data: { kind: "reload", key } })) return;
        return new Response("upgrade required", { status: 426 });
      }
      if (pathname.startsWith(DATA_PREFIX)) {
        const rest = pathname.slice(DATA_PREFIX.length);
        const url = site.upstream(rest);
        if (!url) return new Response(`no data ${rest}`, { status: 404 });
        if (server.upgrade(req, { data: { kind: "data", url, pending: [] } }))
          return;
        return new Response("upgrade required", { status: 426 });
      }

      const resolved = site.resolve(pathname);
      if (resolved?.kind === "redirect")
        return Response.redirect(resolved.to, 308);
      if (resolved?.kind === "html") return html(resolved.body);
      if (resolved?.kind === "page") {
        const res = await servePage(resolved.page, resolved.rest);
        if (res) return res;
      }
      const asset = await serveAsset(pathname);
      if (asset) return withIsolation(asset);
      return withIsolation(new Response("not found", { status: 404 }));
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === "reload") ws.subscribe(topicFor(ws.data.key));
        else openUpstream(ws);
      },
      message(ws, msg) {
        const data = ws.data;
        if (data.kind !== "data") return;
        const frame: Frame =
          typeof msg === "string" ? msg : new Uint8Array(msg);
        if (data.upstream?.readyState === WebSocket.OPEN) {
          data.upstream.send(frame);
        } else {
          data.pending.push(frame);
        }
      },
      close(ws) {
        if (ws.data.kind === "data") ws.data.upstream?.close();
      },
    },
  });
}

export type Server = ReturnType<typeof startServer>;

export function reloadPage(server: Server, key: string): void {
  server.publish(topicFor(key), "reload");
}
