import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SECRET_PARAM = "secret";

// Cookies are shared across ports on one host, so the name carries the port.
export function secretCookie(port: number): string {
  return `n6k_secret_${port}`;
}

export function sameSecret(a: string | null | undefined, b: string): boolean {
  if (a == undefined) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SecretProblem = "missing" | "stale";

export const SECRET_MESSAGES: Record<SecretProblem, string> = {
  missing: "missing secret: open the URL n6k-serve printed (?secret=)",
  stale: "n6k-serve was restarted: open the new URL it printed",
};

export function secretProblem(
  req: IncomingMessage,
  cookie: string,
  secret: string,
): SecretProblem | undefined {
  const value = new Bun.CookieMap(req.headers.cookie ?? "").get(cookie);
  if (value == undefined) return "missing";
  return sameSecret(value, secret) ? undefined : "stale";
}

export function refusalPage(problem: SecretProblem): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>n6k-serve</title></head>
  <body><p>${Bun.escapeHTML(SECRET_MESSAGES[problem])}</p></body>
</html>`;
}
