import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";

const CLI = path.join(import.meta.dir, "cli.ts");

type Reply = {
  id: number;
  result?: {
    content?: { text: string }[];
    isError?: boolean;
    tools?: { name: string }[];
    instructions?: string;
  };
};

function spawnMcp(args: string[] = []) {
  const proc = Bun.spawn(["bun", CLI, "--mcp", "--port", "0", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const lines: string[] = [];
  const waiting = new Map<number, (reply: Reply) => void>();
  let nextId = 1;

  void (async () => {
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk);
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        lines.push(line);
        const msg = JSON.parse(line) as Reply;
        waiting.get(msg.id)?.(msg);
      }
    }
  })();

  const send = (msg: object) => {
    void proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
    void proc.stdin.flush();
  };

  const request = (method: string, params: object): Promise<Reply> => {
    const id = nextId++;
    const reply = new Promise<Reply>((resolve) => waiting.set(id, resolve));
    send({ id, method, params });
    return reply;
  };

  const call = async (name: string, args: object = {}) => {
    const reply = await request("tools/call", { name, arguments: args });
    return {
      text: reply.result?.content?.[0]?.text ?? "",
      isError: reply.result?.isError === true,
    };
  };

  const init = async () => {
    const reply = await request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    send({ method: "notifications/initialized" });
    return reply;
  };

  return { proc, lines, request, call, init };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "n6k-serve-test-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function status(url: string | URL): Promise<number> {
  const res = await fetch(url);
  return res.status;
}

async function body(url: string | URL): Promise<string> {
  const res = await fetch(url);
  return res.text();
}

test("mcp serves inline and path pages", async () => {
  const mcp = spawnMcp();
  cleanup.push(() => mcp.proc.kill());
  await mcp.init();
  const failed = async (name: string, args: object) => {
    const reply = await mcp.call(name, args);
    return reply.isError;
  };

  const tools = await mcp.request("tools/list", {});
  expect(tools.result?.tools?.map((t) => t.name).toSorted()).toEqual([
    "describe_component",
    "list_pages",
    "remove_data",
    "remove_page",
    "search_components",
    "set_data",
    "set_page",
  ]);

  const set = await mcp.call("set_page", { page: "p", mdx: "# one" });
  expect(set.isError).toBe(false);
  const url = set.text;
  expect(url).toMatch(/^http:\/\/.*\/p\/$/);
  expect(await status(url)).toBe(200);
  const js = new URL("index.js", url);
  expect(await body(js)).toContain("one");

  await mcp.call("set_page", { page: "p", mdx: "# two" });
  expect(await body(js)).toContain("two");

  const broken = await mcp.call("set_page", { page: "bad", mdx: "<Nope" });
  expect(broken.isError).toBe(true);
  expect(broken.text).not.toBe("");

  expect(
    await failed("set_page", { page: "x", mdx: "# x", path: "/x.mdx" }),
  ).toBe(true);
  expect(await failed("set_page", { page: "x", path: "rel.mdx" })).toBe(true);
  expect(await failed("set_page", { page: "a/b", mdx: "# x" })).toBe(true);

  const file = path.join(tempDir(), "f.mdx");
  writeFileSync(file, "# from file");
  expect(await mcp.call("set_page", { page: "f", path: file })).toEqual({
    text: url.replace(/p\/$/, "f/"),
    isError: false,
  });

  const listed = await mcp.call("list_pages");
  const pages = JSON.parse(listed.text) as { page: string }[];
  expect(pages.map((p) => p.page).toSorted()).toEqual(["bad", "f", "p"]);

  const data = new URL("/_n6k/data/db", url);
  expect(await status(data)).toBe(404);
  expect(await body(js)).not.toContain("tok-secret");
  expect(
    await failed("set_data", { alias: "1x", url: "ws://x", token: "t" }),
  ).toBe(true);
  expect(
    await failed("set_data", { alias: "db", url: "http://x", token: "t" }),
  ).toBe(true);
  expect(
    await failed("set_data", {
      alias: "db",
      url: "ws://127.0.0.1:1/ws",
      token: "tok-secret",
    }),
  ).toBe(false);
  expect(await status(data)).toBe(426);
  expect(await body(js)).toContain("tok-secret");
  expect(await failed("remove_data", { alias: "db" })).toBe(false);
  expect(await status(data)).toBe(404);
  expect(await body(js)).not.toContain("tok-secret");
  expect(await failed("remove_data", { alias: "db" })).toBe(true);

  expect(await failed("remove_page", { page: "p" })).toBe(false);
  expect(await status(url)).toBe(404);
  expect(await failed("remove_page", { page: "p" })).toBe(true);

  for (const line of mcp.lines) expect(() => JSON.parse(line)).not.toThrow();

  mcp.proc.stdin.end();
  expect(await mcp.proc.exited).toBe(0);
}, 60_000);

test("mcp documents components and renders controls", async () => {
  const mcp = spawnMcp();
  cleanup.push(() => mcp.proc.kill());
  const init = await mcp.init();
  expect(init.result?.instructions).toContain("::Slider");

  const search = async (query?: string) => {
    const reply = await mcp.call("search_components", { query });
    return JSON.parse(reply.text) as { name: string; kind: string }[];
  };
  expect(await search()).toHaveLength(52);
  const charts = await search("chart");
  expect(charts.map((c) => c.name)).toContain("BarChart");

  const slider = await mcp.call("describe_component", { name: "Slider" });
  const doc = JSON.parse(slider.text) as {
    kind: string;
    props: Record<string, unknown>;
  };
  expect(doc.kind).toBe("control");
  expect(Object.keys(doc.props)).toEqual(
    expect.arrayContaining(["min", "max"]),
  );
  const unknown = await mcp.call("describe_component", { name: "Bar" });
  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain("BarChart");

  const leaf = await mcp.call("set_page", {
    page: "leaf",
    mdx: '::Slider[n]{label="N" min=1 max=10 default=5}\n\nValue {n}\n',
  });
  expect(leaf.isError).toBe(false);
  expect(await body(new URL("index.js", leaf.text))).toContain("Controls");

  const container = await mcp.call("set_page", {
    page: "container",
    mdx: [
      ':::Select[month]{default="a"}',
      "<SelectTrigger><SelectValue /></SelectTrigger>",
      '<SelectContent><SelectItem value="a">A</SelectItem></SelectContent>',
      ":::",
      "",
    ].join("\n"),
  });
  expect(container.isError).toBe(false);
}, 60_000);
