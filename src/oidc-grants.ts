export class OidcError extends Error {}

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
const LOGIN_SCOPES = ["openid", "email", "offline_access"];
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type OidcOptions = {
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

type Json = Record<string, unknown>;

export type Endpoints = {
  issuer: string;
  clientId: string;
  tokenEndpoint: string;
  deviceEndpoint: string;
  scopes: string[];
};

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(doc: Json, key: string, where: string): string {
  const value = doc[key];
  if (typeof value !== "string" || value === "")
    throw new OidcError(`${where}: missing ${key}`);
  return value;
}

function optionalStr(doc: Json, key: string): string | undefined {
  const value = doc[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function num(doc: Json, key: string): number | undefined {
  const value = doc[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

async function getJson(url: string): Promise<Json> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new OidcError(
      `${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 404)
    throw new OidcError(`${url} not found: the server does not offer sign-in`);
  if (!res.ok) throw new OidcError(`${url}: HTTP ${res.status}`);
  const doc: unknown = await res.json().catch(() => {});
  if (!isJson(doc)) throw new OidcError(`${url}: not a JSON object`);
  return doc;
}

async function postForm(
  url: string,
  form: Record<string, string>,
): Promise<{ status: number; doc: Json }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form),
  });
  const doc: unknown = await res.json().catch(() => {});
  if (!isJson(doc)) throw new OidcError(`${url}: HTTP ${res.status}`);
  return { status: res.status, doc };
}

function oauthError(url: string, doc: Json): OidcError {
  const description = optionalStr(doc, "error_description");
  return new OidcError(
    `${url}: ${optionalStr(doc, "error") ?? "request failed"}${description ? ` (${description})` : ""}`,
  );
}

export function protectedResourceUrl(wsUrl: string): string {
  const url = new URL(wsUrl);
  const scheme = url.protocol === "wss:" ? "https:" : "http:";
  return `${scheme}//${url.host}${PROTECTED_RESOURCE_PATH}`;
}

export async function discover(wsUrl: string): Promise<Endpoints> {
  const metadataUrl = protectedResourceUrl(wsUrl);
  const resource = await getJson(metadataUrl);
  const servers = resource.authorization_servers;
  if (
    !Array.isArray(servers) ||
    typeof servers[0] !== "string" ||
    servers[0] === ""
  )
    throw new OidcError(`${metadataUrl}: missing authorization_servers`);
  const issuer = servers[0];
  const clientId = str(resource, "client_id", metadataUrl);

  const configUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const config = await getJson(configUrl);
  const supported = Array.isArray(config.scopes_supported)
    ? config.scopes_supported.filter((s) => typeof s === "string")
    : [];
  return {
    issuer,
    clientId,
    tokenEndpoint: str(config, "token_endpoint", configUrl),
    deviceEndpoint: str(config, "device_authorization_endpoint", configUrl),
    scopes:
      supported.length === 0
        ? LOGIN_SCOPES
        : LOGIN_SCOPES.filter((s) => supported.includes(s)),
  };
}

export type Tokens = { access: string; refresh?: string; expiresAt: number };

function jwtClaims(token: string): Json {
  const payload = token.split(".", 2)[1];
  if (!payload) return {};
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return isJson(claims) ? claims : {};
  } catch {
    return {};
  }
}

function jwtExpiry(token: string): number | undefined {
  const exp = num(jwtClaims(token), "exp");
  return exp === undefined ? undefined : exp * 1000;
}

export function who(token: string): string {
  const claims = jwtClaims(token);
  return (
    optionalStr(claims, "preferred_username") ??
    optionalStr(claims, "email") ??
    optionalStr(claims, "sub") ??
    "unknown user"
  );
}

function readTokens(doc: Json, url: string, now: number): Tokens {
  const access = str(doc, "access_token", url);
  const expiresIn = num(doc, "expires_in");
  return {
    access,
    refresh: optionalStr(doc, "refresh_token"),
    expiresAt:
      expiresIn === undefined
        ? (jwtExpiry(access) ?? Number.POSITIVE_INFINITY)
        : now + expiresIn * 1000,
  };
}

export async function deviceLogin(
  endpoints: Endpoints,
  options: Required<OidcOptions>,
): Promise<Tokens> {
  const { deviceEndpoint, tokenEndpoint, clientId } = endpoints;
  const started = await postForm(deviceEndpoint, {
    client_id: clientId,
    scope: endpoints.scopes.join(" "),
  });
  if (started.status !== 200) throw oauthError(deviceEndpoint, started.doc);
  const deviceCode = str(started.doc, "device_code", deviceEndpoint);
  const userCode = str(started.doc, "user_code", deviceEndpoint);
  const verify =
    optionalStr(started.doc, "verification_uri_complete") ??
    str(started.doc, "verification_uri", deviceEndpoint);
  let interval = (num(started.doc, "interval") ?? 5) * 1000;
  const deadline =
    options.now() + (num(started.doc, "expires_in") ?? 600) * 1000;

  options.log(`Sign in at ${verify} (code: ${userCode})`);
  for (;;) {
    if (options.now() >= deadline)
      throw new OidcError(`${endpoints.issuer}: sign-in timed out`);
    await options.sleep(interval);
    const { status, doc } = await postForm(tokenEndpoint, {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
      client_id: clientId,
    });
    if (status === 200) return readTokens(doc, tokenEndpoint, options.now());
    const error = optionalStr(doc, "error");
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5000;
      continue;
    }
    throw oauthError(tokenEndpoint, doc);
  }
}

export async function refreshGrant(
  endpoints: Endpoints,
  refresh: string,
  now: number,
): Promise<Tokens> {
  const { tokenEndpoint, clientId } = endpoints;
  const { status, doc } = await postForm(tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId,
  });
  if (status !== 200) throw oauthError(tokenEndpoint, doc);
  const next = readTokens(doc, tokenEndpoint, now);
  return { ...next, refresh: next.refresh ?? refresh };
}
