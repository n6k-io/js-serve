import { useState, type ReactNode } from "react";
import { duckdbBundle } from "virtual:n6k-duckdb-bundle";
import { N6kDuckDB, type DatabaseSpec, type SocketSpec } from "@n6k.io/db";
import { DuckDBProvider, QueryProvider } from "@n6k.io/ui/duckdb";
import { ConnectionLost, DuckDBConnectionGuard } from "@n6k.io/runtime";
import { Page } from "@n6k.io/ui/components";

async function fetchToken(alias: string): Promise<string> {
  const waiting = setTimeout(() => {
    console.warn(`${alias}: waiting for sign-in, see the n6k-serve terminal`);
  }, 2000);
  try {
    const res = await fetch(`/_n6k/token/${alias}`, { cache: "no-store" });
    const body = await res.text();
    if (!res.ok) {
      console.error(`${alias}: no token: ${body}`);
      throw new Error(`token for ${alias}: ${body}`);
    }
    return body;
  } finally {
    clearTimeout(waiting);
  }
}

function engine(
  data: Record<string, string>,
  tokens: Record<string, string>,
  oidc: string[],
): N6kDuckDB {
  const sockets: Record<string, SocketSpec> = {};
  const databases: Record<string, DatabaseSpec> = {};
  for (const [alias, url] of Object.entries(data)) {
    sockets[alias] = {
      connect: () => new WebSocket(url),
      token: oidc.includes(alias)
        ? () => fetchToken(alias)
        : Object.hasOwn(tokens, alias)
          ? tokens[alias]!
          : "",
    };
    databases[alias] = { socket: alias };
  }
  return new N6kDuckDB({
    bundle: duckdbBundle,
    sockets,
    databases,
  });
}

export default function Root({
  children,
  data = {},
  tokens = {},
  oidc = [],
  bare = false,
}: {
  children: ReactNode;
  data?: Record<string, string>;
  tokens?: Record<string, string>;
  oidc?: string[];
  bare?: boolean;
}) {
  const [duckdb] = useState(() => engine(data, tokens, oidc));
  return (
    <QueryProvider>
      <DuckDBProvider connect={duckdb.connect} metadataFns={duckdb.metadataFns}>
        <DuckDBConnectionGuard>
          {bare ? children : <Page>{children}</Page>}
        </DuckDBConnectionGuard>
        <ConnectionLost duckdb={duckdb} />
      </DuckDBProvider>
    </QueryProvider>
  );
}
