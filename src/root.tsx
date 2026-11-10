import { useState, type ReactNode } from "react";
import { duckdbWorkerUrl, wsWorkerUrl } from "virtual:n6k-workers";
import { duckdbBundle } from "virtual:n6k-duckdb-bundle";
import { N6kDuckDB, type DatabaseSpec, type SocketSpec } from "@n6k.io/db";
import { DuckDBProvider, QueryProvider } from "@n6k.io/ui/duckdb";
import { ConnectionLost, DuckDBConnectionGuard } from "@n6k.io/runtime";

function dataSocket(url: string, token: string): SocketSpec {
  return {
    connect: () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      return new WebSocket(`${scheme}://${location.host}${url}`);
    },
    token,
  };
}

function engine(aliases: string[], dataPath: string, token: string): N6kDuckDB {
  const sockets: Record<string, SocketSpec> = {};
  const databases: Record<string, DatabaseSpec> = {};
  for (const alias of aliases) {
    sockets[alias] = dataSocket(`${dataPath}${alias}`, token);
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
  aliases = [],
  dataPath = "/_n6k/data/",
  token = "",
}: {
  children: ReactNode;
  aliases?: string[];
  dataPath?: string;
  token?: string;
}) {
  const [duckdb] = useState(() => engine(aliases, dataPath, token));
  return (
    <QueryProvider>
      <DuckDBProvider connect={duckdb.connect} metadataFns={duckdb.metadataFns}>
        <DuckDBConnectionGuard>{children}</DuckDBConnectionGuard>
        <ConnectionLost duckdb={duckdb} />
      </DuckDBProvider>
    </QueryProvider>
  );
}
