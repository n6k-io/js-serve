export type RefreshStore = {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
};

const SERVICE = "n6k-serve";
const INDEX = "index";

export const keychain: RefreshStore = {
  get: (name) => Bun.secrets.get({ service: SERVICE, name }),
  set: (name, value) => Bun.secrets.set({ service: SERVICE, name, value }),
  delete: (name) => Bun.secrets.delete({ service: SERVICE, name }),
};

export type SavedLogin = {
  issuer: string;
  clientId: string;
  servers: string[];
};

export function loginKey(issuer: string, clientId: string): string {
  return `${issuer} ${clientId}`;
}

export function serverOf(wsUrl: string): string {
  const url = new URL(wsUrl);
  return `${url.protocol}//${url.host}`;
}

function describe(key: string, servers: string[]): SavedLogin {
  const space = key.lastIndexOf(" ");
  return {
    issuer: key.slice(0, space),
    clientId: key.slice(space + 1),
    servers,
  };
}

// Bun.secrets cannot enumerate, so the keys written are tracked in an index entry.
export class SavedLogins {
  constructor(private readonly store: RefreshStore = keychain) {}

  private async index(): Promise<Record<string, string[]>> {
    const raw = await this.store.get(INDEX);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return {};
      const out: Record<string, string[]> = {};
      for (const [key, servers] of Object.entries(parsed)) {
        if (Array.isArray(servers))
          out[key] = servers.filter((s) => typeof s === "string");
      }
      return out;
    } catch {
      return {};
    }
  }

  private async writeIndex(index: Record<string, string[]>): Promise<void> {
    await (Object.keys(index).length === 0
      ? this.store.delete(INDEX)
      : this.store.set(INDEX, JSON.stringify(index)));
  }

  refreshToken(key: string): Promise<string | null> {
    return this.store.get(key);
  }

  setRefreshToken(key: string, refresh: string): Promise<void> {
    return this.store.set(key, refresh);
  }

  async addServer(key: string, server: string): Promise<void> {
    const index = await this.index();
    const servers = index[key] ?? [];
    if (servers.includes(server)) return;
    index[key] = [...servers, server];
    await this.writeIndex(index);
  }

  async list(): Promise<SavedLogin[]> {
    return Object.entries(await this.index()).map(([key, servers]) =>
      describe(key, servers),
    );
  }

  async remove(key: string): Promise<void> {
    await this.store.delete(key);
    const index = await this.index();
    if (!Object.hasOwn(index, key)) return;
    delete index[key];
    await this.writeIndex(index);
  }

  async removeForServer(server: string): Promise<SavedLogin | undefined> {
    const index = await this.index();
    const key = Object.keys(index).find((k) => index[k]!.includes(server));
    if (key === undefined) return undefined;
    const removed = describe(key, index[key]!);
    await this.remove(key);
    return removed;
  }

  async removeAll(): Promise<SavedLogin[]> {
    const removed = await this.list();
    for (const login of removed)
      await this.store.delete(loginKey(login.issuer, login.clientId));
    await this.store.delete(INDEX);
    return removed;
  }
}
