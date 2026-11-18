import { expect, test } from "bun:test";
import { LogoutError, logout } from "./logout";
import { SavedLogins, type RefreshStore } from "./saved-logins";

async function seeded() {
  const saved = new Map<string, string>();
  const store: RefreshStore = {
    get: async (name) => saved.get(name) ?? null,
    set: async (name, value) => {
      saved.set(name, value);
    },
    delete: async (name) => saved.delete(name),
  };
  const logins = new SavedLogins(store);
  await logins.setRefreshToken("http://kc/realms/a cli", "ra");
  await logins.addServer("http://kc/realms/a cli", "ws://h1:8080");
  await logins.addServer("http://kc/realms/a cli", "ws://h2:8080");
  await logins.setRefreshToken("http://kc/realms/b cli", "rb");
  await logins.addServer("http://kc/realms/b cli", "wss://h3");
  return { saved, logins };
}

test("no server lists sign-ins and deletes nothing", async () => {
  const { saved, logins } = await seeded();
  expect(await logout(undefined, false, logins)).toEqual([
    "saved sign-ins:",
    "  http://kc/realms/a (client cli): ws://h1:8080, ws://h2:8080",
    "  http://kc/realms/b (client cli): wss://h3",
    "",
    "sign out with: n6k-serve logout ws://host[:port] | --all",
  ]);
  expect(saved.get("http://kc/realms/a cli")).toBe("ra");
  expect(saved.get("http://kc/realms/b cli")).toBe("rb");
});

test("a server removes only the sign-in it uses", async () => {
  const { saved, logins } = await seeded();
  expect(await logout("ws://h1:8080/ws", false, logins)).toEqual([
    "signed out of:",
    "  http://kc/realms/a (client cli): ws://h1:8080, ws://h2:8080",
  ]);
  expect(saved.has("http://kc/realms/a cli")).toBe(false);
  expect(saved.get("http://kc/realms/b cli")).toBe("rb");
  const left = await logins.list();
  expect(left.map((l) => l.issuer)).toEqual(["http://kc/realms/b"]);
});

test("an unknown server or bad URL is an error", async () => {
  const { logins } = await seeded();
  await expect(logout("ws://other/ws", false, logins)).rejects.toThrow(
    new LogoutError("no saved sign-in for ws://other"),
  );
  await expect(logout("http://h1:8080", false, logins)).rejects.toThrow(
    LogoutError,
  );
});

test("--all removes every sign-in and the index", async () => {
  const { saved, logins } = await seeded();
  const out = await logout(undefined, true, logins);
  expect(out[0]).toBe("signed out of:");
  expect(out).toHaveLength(3);
  expect(saved.size).toBe(0);
  expect(await logout(undefined, false, logins)).toEqual(["no saved sign-ins"]);
});
