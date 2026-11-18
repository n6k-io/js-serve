import { afterEach, expect, test } from "bun:test";
import { OidcError, OidcLogins, protectedResourceUrl } from "./oidc";
import { SavedLogins, type RefreshStore } from "./saved-logins";

type Form = Record<string, string>;

function fakeIdp(script: {
  deviceReplies: object[];
  refreshReplies: object[];
}) {
  const deviceReplies = [...script.deviceReplies];
  const refreshReplies = [...script.refreshReplies];
  const requests: Form[] = [];
  let deviceStarts = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname, origin: base } = new URL(req.url);
      if (pathname === "/n6kd/.well-known/oauth-protected-resource")
        return Response.json({
          resource: "n6kd",
          authorization_servers: [`${base}/realm`],
          client_id: "n6k-cli",
        });
      if (pathname === "/realm/.well-known/openid-configuration")
        return Response.json({
          token_endpoint: `${base}/token`,
          device_authorization_endpoint: `${base}/device`,
          scopes_supported: ["openid", "offline_access"],
        });
      const form = Object.fromEntries(new URLSearchParams(await req.text()));
      requests.push(form);
      if (pathname === "/device") {
        deviceStarts++;
        return Response.json({
          device_code: "dc",
          user_code: "UC",
          verification_uri: `${base}/verify`,
          interval: 1,
          expires_in: 600,
        });
      }
      if (pathname === "/token") {
        const reply =
          form.grant_type === "refresh_token"
            ? refreshReplies.shift()
            : deviceReplies.shift();
        if (!reply)
          return Response.json({ error: "exhausted" }, { status: 400 });
        return Response.json(reply, {
          status: "error" in reply ? 400 : 200,
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    server,
    requests,
    deviceStarts: () => deviceStarts,
  };
}

const servers: { stop: (force?: boolean) => unknown }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

function memoryStore(initial: Record<string, string> = {}) {
  const saved = new Map(Object.entries(initial));
  const store: RefreshStore = {
    get: async (name) => saved.get(name) ?? null,
    set: async (name, value) => {
      saved.set(name, value);
    },
    delete: async (name) => saved.delete(name),
  };
  return { store, saved };
}

function harness(initial: Record<string, string> = {}) {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const { store, saved } = memoryStore(initial);
  const logins = new OidcLogins(new SavedLogins(store), {
    log: (line) => logs.push(line),
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    now: () => now,
  });
  return { logins, saved, sleeps, logs, advance: (ms: number) => (now += ms) };
}

function n6kdAt(idp: ReturnType<typeof fakeIdp>): string {
  return `ws://localhost:${idp.server.port}/ws`;
}

function withMetadataAtRoot(idp: ReturnType<typeof fakeIdp>) {
  const proxy = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/.well-known/oauth-protected-resource")
        return fetch(
          `http://localhost:${idp.server.port}/n6kd/.well-known/oauth-protected-resource`,
        );
      return new Response("not found", { status: 404 });
    },
  });
  servers.push(proxy);
  return `ws://localhost:${proxy.port}/ws`;
}

test("protectedResourceUrl maps ws/wss to http/https on the same host", () => {
  expect(protectedResourceUrl("ws://h:8080/ws")).toBe(
    "http://h:8080/.well-known/oauth-protected-resource",
  );
  expect(protectedResourceUrl("wss://h/x/ws")).toBe(
    "https://h/.well-known/oauth-protected-resource",
  );
});

test("device login polls through pending and slow_down", async () => {
  const idp = fakeIdp({
    deviceReplies: [
      { error: "authorization_pending" },
      { error: "slow_down" },
      { access_token: "a1", refresh_token: "r1", expires_in: 300 },
    ],
    refreshReplies: [],
  });
  servers.push(idp.server);
  const h = harness();
  const session = await h.logins.sessionFor(withMetadataAtRoot(idp));

  expect(await session.token()).toBe("a1");
  expect(h.sleeps).toEqual([1000, 1000, 6000]);
  expect(h.logs).toEqual([
    `Sign in at http://localhost:${idp.server.port}/verify (code: UC)`,
    `signed in to http://localhost:${idp.server.port}/realm as unknown user`,
  ]);
  expect(idp.requests[0]).toEqual({
    client_id: "n6k-cli",
    scope: "openid offline_access",
  });
});

test("refreshes near expiry and keeps the rotated refresh token", async () => {
  const idp = fakeIdp({
    deviceReplies: [
      { access_token: "a1", refresh_token: "r1", expires_in: 300 },
    ],
    refreshReplies: [
      { access_token: "a2", refresh_token: "r2", expires_in: 300 },
      { access_token: "a3", expires_in: 300 },
      { access_token: "a4", expires_in: 300 },
    ],
  });
  servers.push(idp.server);
  const h = harness();
  const session = await h.logins.sessionFor(withMetadataAtRoot(idp));

  h.advance(250_000);
  const [x, y] = await Promise.all([session.token(), session.token()]);
  expect([x, y]).toEqual(["a2", "a2"]);
  h.advance(250_000);
  expect(await session.token()).toBe("a3");
  h.advance(250_000);
  expect(await session.token()).toBe("a4");

  const refreshes = idp.requests.filter(
    (r) => r.grant_type === "refresh_token",
  );
  expect(refreshes.map((r) => r.refresh_token)).toEqual(["r1", "r2", "r2"]);
});

function savedKey(idp: ReturnType<typeof fakeIdp>): string {
  return `http://localhost:${idp.server.port}/realm n6k-cli`;
}

test("device login saves the refresh token, refresh saves the rotated one", async () => {
  const idp = fakeIdp({
    deviceReplies: [
      { access_token: "a1", refresh_token: "r1", expires_in: 300 },
    ],
    refreshReplies: [
      { access_token: "a2", refresh_token: "r2", expires_in: 300 },
    ],
  });
  servers.push(idp.server);
  const h = harness();
  const session = await h.logins.sessionFor(withMetadataAtRoot(idp));
  expect(h.saved.get(savedKey(idp))).toBe("r1");
  h.advance(250_000);
  expect(await session.token()).toBe("a2");
  expect(h.saved.get(savedKey(idp))).toBe("r2");
});

test("a saved refresh token skips the device login", async () => {
  const idp = fakeIdp({
    deviceReplies: [],
    refreshReplies: [
      { access_token: "a1", refresh_token: "r2", expires_in: 300 },
    ],
  });
  servers.push(idp.server);
  const h = harness({ [savedKey(idp)]: "r1" });
  const session = await h.logins.sessionFor(withMetadataAtRoot(idp));
  expect(await session.token()).toBe("a1");
  expect(idp.deviceStarts()).toBe(0);
  expect(h.logs).toEqual([
    `using saved sign-in for http://localhost:${idp.server.port}/realm as unknown user`,
  ]);
  expect(h.saved.get(savedKey(idp))).toBe("r2");
});

test("a rejected saved refresh token falls back to device login", async () => {
  const idp = fakeIdp({
    deviceReplies: [
      { access_token: "a1", refresh_token: "r9", expires_in: 300 },
    ],
    refreshReplies: [{ error: "invalid_grant" }],
  });
  servers.push(idp.server);
  const h = harness({ [savedKey(idp)]: "stale" });
  const session = await h.logins.sessionFor(withMetadataAtRoot(idp));
  expect(await session.token()).toBe("a1");
  expect(idp.deviceStarts()).toBe(1);
  expect(h.logs[0]).toContain("rejected");
  expect(h.saved.get(savedKey(idp))).toBe("r9");
});

function jwt(claims: object): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
}

test("a rejected refresh while running signs in again", async () => {
  const idp = fakeIdp({
    deviceReplies: [
      { access_token: "a1", refresh_token: "r1", expires_in: 300 },
      {
        access_token: jwt({ preferred_username: "grace" }),
        refresh_token: "r2",
        expires_in: 300,
      },
    ],
    refreshReplies: [{ error: "invalid_grant", error_description: "revoked" }],
  });
  servers.push(idp.server);
  const h = harness();
  const session = await h.logins.sessionFor(withMetadataAtRoot(idp));
  h.advance(250_000);
  expect(await session.token()).toBe(jwt({ preferred_username: "grace" }));
  expect(idp.deviceStarts()).toBe(2);
  const issuer = `http://localhost:${idp.server.port}/realm`;
  expect(h.logs.slice(2)).toEqual([
    `sign-in for ${issuer} expired: http://localhost:${idp.server.port}/token: invalid_grant (revoked)`,
    `Sign in at http://localhost:${idp.server.port}/verify (code: UC)`,
    `signed in to ${issuer} as grace`,
  ]);
  expect(h.saved.get(savedKey(idp))).toBe("r2");
});

test("servers on one issuer share a single login", async () => {
  const idp = fakeIdp({
    deviceReplies: [
      { access_token: "a1", refresh_token: "r1", expires_in: 300 },
    ],
    refreshReplies: [],
  });
  servers.push(idp.server);
  const h = harness();
  const a = await h.logins.sessionFor(withMetadataAtRoot(idp));
  const b = await h.logins.sessionFor(withMetadataAtRoot(idp));
  expect(a).toBe(b);
  expect(idp.deviceStarts()).toBe(1);
});

test("a server without protected-resource metadata fails", async () => {
  const idp = fakeIdp({ deviceReplies: [], refreshReplies: [] });
  servers.push(idp.server);
  const h = harness();
  const err = await h.logins.sessionFor(n6kdAt(idp)).catch((e) => e);
  expect(err).toBeInstanceOf(OidcError);
  expect(err.message).toContain("does not offer sign-in");
});

test("a denied device login fails", async () => {
  const idp = fakeIdp({
    deviceReplies: [{ error: "access_denied", error_description: "no" }],
    refreshReplies: [],
  });
  servers.push(idp.server);
  const h = harness();
  const err = await h.logins
    .sessionFor(withMetadataAtRoot(idp))
    .catch((e) => e);
  expect(err).toBeInstanceOf(OidcError);
  expect(err.message).toContain("access_denied (no)");
});
