import {
  OidcError,
  deviceLogin,
  discover,
  refreshGrant,
  who,
  type Endpoints,
  type OidcOptions,
  type Tokens,
} from "./oidc-grants";

import { SavedLogins, loginKey, serverOf } from "./saved-logins";

export { OidcError, protectedResourceUrl } from "./oidc-grants";

const REFRESH_MARGIN_MS = 60_000;

export class OidcSession {
  private refreshing: Promise<string> | undefined;

  constructor(
    private readonly endpoints: Endpoints,
    private tokens: Tokens,
    private readonly now: () => number,
    private readonly log: (line: string) => void,
    private readonly signIn: () => Promise<Tokens>,
    private readonly save: (refresh: string) => Promise<void>,
  ) {}

  token(): Promise<string> {
    if (this.tokens.expiresAt - this.now() > REFRESH_MARGIN_MS)
      return Promise.resolve(this.tokens.access);
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    const { issuer } = this.endpoints;
    const refresh = this.tokens.refresh;
    if (refresh) {
      try {
        this.tokens = await refreshGrant(this.endpoints, refresh, this.now());
        if (this.tokens.refresh !== refresh)
          await this.save(this.tokens.refresh!);
        return this.tokens.access;
      } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        this.log(`sign-in for ${issuer} expired: ${err.message}`);
      }
    } else {
      this.log(`sign-in for ${issuer} expired and cannot be refreshed`);
    }
    this.tokens = await this.signIn();
    return this.tokens.access;
  }
}

export class OidcLogins {
  private readonly sessions = new Map<string, Promise<OidcSession>>();
  private readonly options: Required<OidcOptions>;

  constructor(
    private readonly saved: SavedLogins = new SavedLogins(),
    options: OidcOptions = {},
  ) {
    this.options = {
      log: options.log ?? ((line) => console.error(line)),
      sleep: options.sleep ?? ((ms) => Bun.sleep(ms)),
      now: options.now ?? Date.now,
    };
  }

  async sessionFor(wsUrl: string): Promise<OidcSession> {
    const endpoints = await discover(wsUrl);
    const key = loginKey(endpoints.issuer, endpoints.clientId);
    let session = this.sessions.get(key);
    if (!session) {
      session = this.login(endpoints, key);
      this.sessions.set(key, session);
      session.catch(() => this.sessions.delete(key));
    }
    const ready = await session;
    await this.saved.addServer(key, serverOf(wsUrl));
    return ready;
  }

  private async login(endpoints: Endpoints, key: string): Promise<OidcSession> {
    const { log, now } = this.options;
    const stored = await this.saved.refreshToken(key);
    let tokens: Tokens | undefined;
    if (stored) {
      try {
        tokens = await refreshGrant(endpoints, stored, now());
        log(
          `using saved sign-in for ${endpoints.issuer} as ${who(tokens.access)}`,
        );
      } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        log(`saved sign-in for ${endpoints.issuer} rejected: ${err.message}`);
        await this.saved.remove(key);
      }
    }
    const save = (refresh: string) => this.saved.setRefreshToken(key, refresh);
    const signIn = async (): Promise<Tokens> => {
      const fresh = await deviceLogin(endpoints, this.options);
      log(`signed in to ${endpoints.issuer} as ${who(fresh.access)}`);
      if (fresh.refresh) await save(fresh.refresh);
      return fresh;
    };
    if (tokens) {
      if (tokens.refresh && tokens.refresh !== stored)
        await save(tokens.refresh);
    } else {
      tokens = await signIn();
    }
    return new OidcSession(endpoints, tokens, now, log, signIn, save);
  }
}
