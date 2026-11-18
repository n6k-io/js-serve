import { SavedLogins, serverOf, type SavedLogin } from "./saved-logins";

export class LogoutError extends Error {}

function line({ issuer, clientId, servers }: SavedLogin): string {
  return `  ${issuer} (client ${clientId}): ${servers.join(", ")}`;
}

export async function logout(
  server: string | undefined,
  all: boolean,
  saved: SavedLogins = new SavedLogins(),
): Promise<string[]> {
  if (all) {
    const removed = await saved.removeAll();
    if (removed.length === 0) return ["no saved sign-ins"];
    return ["signed out of:", ...removed.map((l) => line(l))];
  }
  if (server === undefined) {
    const logins = await saved.list();
    if (logins.length === 0) return ["no saved sign-ins"];
    return [
      "saved sign-ins:",
      ...logins.map((l) => line(l)),
      "",
      "sign out with: n6k-serve logout ws://host[:port] | --all",
    ];
  }
  if (!/^wss?:\/\//.test(server) || !URL.canParse(server))
    throw new LogoutError(`${server}: not a ws:// or wss:// URL`);
  const removed = await saved.removeForServer(serverOf(server));
  if (!removed)
    throw new LogoutError(`no saved sign-in for ${serverOf(server)}`);
  return ["signed out of:", line(removed)];
}
