import { useState, type ReactNode } from "react";
import { duckdbWorkerUrl, wsWorkerUrl } from "virtual:n6k-workers";
import { duckdbBundle } from "virtual:n6k-duckdb-bundle";
import { N6kDuckDB, type DatabaseSpec, type SocketSpec } from "@n6k.io/db";
import { DuckDBProvider, QueryProvider } from "@n6k.io/ui/duckdb";
import { ConnectionLost, DuckDBConnectionGuard } from "@n6k.io/runtime";
import { Page } from "@n6k.io/ui/components";

function engine(
  data: Record<string, string>,
  tokens: Record<string, string>,
): N6kDuckDB {
  const sockets: Record<string, SocketSpec> = {};
  const databases: Record<string, DatabaseSpec> = {};
  for (const [alias, url] of Object.entries(data)) {
    sockets[alias] = {
      connect: () => new WebSocket(url),
      token: Object.hasOwn(tokens, alias) ? tokens[alias]! : "",
    };
    databases[alias] = { socket: alias };
  }
  return new N6kDuckDB({
    bundle: duckdbBundle,
    duckdbWorkerUrl,
    wsWorkerUrl,
    sockets,
    databases,
  });
}

export default function Root({
  children,
  data = {},
  tokens = {},
  bare = false,
}: {
  children: ReactNode;
  data?: Record<string, string>;
  tokens?: Record<string, string>;
  bare?: boolean;
}) {
  const [duckdb] = useState(() => engine(data, tokens));
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
