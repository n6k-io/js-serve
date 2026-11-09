import path from "node:path";
import type { ServerWebSocket } from "bun";
import type { Bundle } from "./bundle";
import { serveAsset } from "./assets";

export type ServeState = {
  bundle: Bundle;
  css: string;
  data: Record<string, string>;
};

type SocketData =
  | { kind: "reload" }
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

const RELOAD_TOPIC = "reload";

function shell(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${Bun.escapeHTML(title)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/index.js"></script>
    <script>
      (function connect() {
        const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/_n6k/reload");
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

export function startServer(mdxPath: string, port: number, state: ServeState) {
  const title = path.basename(mdxPath);
  return Bun.serve<SocketData>({
    port,
    async fetch(req, server) {
      const { pathname } = new URL(req.url);

      if (pathname === "/_n6k/reload") {
        if (server.upgrade(req, { data: { kind: "reload" } })) return;
        return new Response("upgrade required", { status: 426 });
      }
      if (pathname.startsWith("/_n6k/data/")) {
        const alias = pathname.slice("/_n6k/data/".length);
        const url = state.data[alias];
        if (!url)
          return new Response(`no data alias ${alias}`, { status: 404 });
        if (server.upgrade(req, { data: { kind: "data", url, pending: [] } }))
          return;
        return new Response("upgrade required", { status: 426 });
      }

      if (pathname === "/") {
        return withIsolation(
          new Response(shell(title), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
        );
      }
      if (pathname === "/styles.css") {
        return withIsolation(
          new Response(state.css, { headers: { "Content-Type": "text/css" } }),
        );
      }
      const built = state.bundle.get(pathname);
      if (built) {
        return withIsolation(
          new Response(built, {
            headers: {
              "Content-Type": contentType(pathname),
              "Cache-Control": "no-store",
            },
          }),
        );
      }
      const asset = await serveAsset(pathname);
      if (asset) return withIsolation(asset);
      return withIsolation(new Response("not found", { status: 404 }));
    },
    websocket: {
      open(ws) {
        if (ws.data.kind === "reload") ws.subscribe(RELOAD_TOPIC);
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

export function reloadClients(server: ReturnType<typeof startServer>): void {
  server.publish(RELOAD_TOPIC, "reload");
}
