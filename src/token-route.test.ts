import { afterEach, expect, test } from "bun:test";
import { secretCookie } from "./secret";
import { startServer, type ServedPage, type Server, type Site } from "./server";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

const status = (res: Promise<Response>) => res.then((r) => r.status);

test("token route serves tokens by alias", async () => {
  const site: Site = { resolve: () => {}, page: () => {} };
  const server = await startServer(site, {
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
  const get = (alias: string) => fetch(`${server.url}_n6k/token/${alias}`);

  const ok = await get("nyc");
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("no-store");
  expect(await ok.text()).toBe("tok");
  const other = await get("other");
  expect(other.status).toBe(404);
  const failed = await get("bad");
  expect(failed.status).toBe(502);
  expect(await failed.text()).toBe("refresh failed");
});

test("secret URL sets the cookie the token route requires", async () => {
  const site: Site = { resolve: () => {}, page: () => {} };
  const server = await startServer(site, {
    hostname: "127.0.0.1",
    port: 0,
    origins: [],
    token: () => Promise.resolve("tok"),
    secret: "s3cret",
  });
  servers.push(server);
  const name = secretCookie(server.port);
  const token = (cookie?: string) =>
    fetch(`${server.url}_n6k/token/nyc`, {
      headers: cookie ? { cookie } : {},
    });

  const missing = await token();
  expect(missing.status).toBe(403);
  expect(await missing.text()).toContain("?secret=");
  const stale = await token(`${name}=wrong`);
  expect(stale.status).toBe(403);
  expect(await stale.text()).toContain("restarted");
  expect(await status(token(`n6k_secret_1=s3cret`))).toBe(403);

  const wrong = await fetch(`${server.url}x?secret=nope`, {
    redirect: "manual",
  });
  expect(wrong.status).toBe(403);

  const visit = await fetch(`${server.url}x?a=1&secret=s3cret`, {
    redirect: "manual",
  });
  expect(visit.status).toBe(303);
  expect(visit.headers.get("location")).toBe("/x?a=1");
  const set = visit.headers.get("set-cookie")!;
  expect(set).toContain(`${name}=s3cret`);
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Lax");

  const ok = await token(`${name}=s3cret`);
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe("tok");
});

test("page shell requires the secret cookie", async () => {
  const page: ServedPage = {
    key: "p",
    file: "p.mdx",
    title: "P",
    rootProps: () => ({ data: {}, tokens: {} }),
  };
  const site: Site = {
    resolve: (pathname) =>
      pathname === "/" ? { kind: "page", page, rest: "/" } : undefined,
    page: (key) => (key === "p" ? page : undefined),
  };
  const server = await startServer(site, {
    hostname: "127.0.0.1",
    port: 0,
    origins: [],
    secret: "s3cret",
  });
  servers.push(server);
  const name = secretCookie(server.port);
  const shell = (cookie?: string) =>
    fetch(server.url, { headers: cookie ? { cookie } : {} });

  const missing = await shell();
  expect(missing.status).toBe(403);
  expect(await missing.text()).toContain("?secret=");
  const stale = await shell(`${name}=wrong`);
  expect(stale.status).toBe(403);
  expect(await stale.text()).toContain("restarted");
  const ok = await shell(`${name}=s3cret`);
  expect(ok.status).toBe(200);
  expect(await ok.text()).toContain('<div id="root">');
});

test("--oidc-login is rejected by mcp and site", async () => {
  for (const args of [["mcp"], ["site", "x.yml"]]) {
    const proc = Bun.spawn(
      ["bun", `${import.meta.dir}/cli.ts`, ...args, "--oidc-login"],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
    );
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain("unknown option");
  }
});
