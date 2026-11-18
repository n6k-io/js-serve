import { afterEach, expect, test } from "bun:test";
import { startServer, type Site } from "./server";

const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

test("token route serves tokens by alias and checks origin", async () => {
  const site: Site = { resolve: () => {}, page: () => {} };
  const server = startServer(site, {
    hostname: "127.0.0.1",
    port: 0,
    origins: ["http://ok"],
    token: (alias) =>
      alias === "nyc"
        ? Promise.resolve("tok")
        : alias === "bad"
          ? Promise.reject(new Error("refresh failed"))
          : undefined,
  });
  servers.push(server);
  const get = (alias: string, origin = "http://ok") =>
    fetch(`${server.url}_n6k/token/${alias}`, { headers: { origin } });

  const ok = await get("nyc");
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("no-store");
  expect(await ok.text()).toBe("tok");
  const evil = await get("nyc", "http://evil");
  expect(evil.status).toBe(403);
  const other = await get("other");
  expect(other.status).toBe(404);
  const failed = await get("bad");
  expect(failed.status).toBe(502);
  expect(await failed.text()).toBe("refresh failed");
});

test("--oidc-login is rejected with --mcp and --pages", async () => {
  for (const args of [["--mcp"], ["--pages", "x.yml"]]) {
    const proc = Bun.spawn(
      ["bun", `${import.meta.dir}/cli.ts`, ...args, "--oidc-login"],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("usage:");
  }
});
