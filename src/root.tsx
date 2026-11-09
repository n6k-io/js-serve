import { useState, type ReactNode } from "react";
import { duckdbWorkerUrl, wsWorkerUrl } from "virtual:n6k-workers";
import { duckdbBundle } from "virtual:n6k-duckdb-bundle";
import { N6kDuckDB, type DatabaseSpec, type SocketSpec } from "@n6k.io/db";
import { DuckDBProvider, QueryProvider } from "@n6k.io/ui/duckdb";
import { ConnectionLost, DuckDBConnectionGuard } from "@n6k.io/runtime";

function dataSocket(alias: string): SocketSpec {
  return {
    connect: () => {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      return new WebSocket(`${scheme}://${location.host}/_n6k/data/${alias}`);
    },
    token: "",
  };
}

function engine(aliases: string[]): N6kDuckDB {
  const sockets: Record<string, SocketSpec> = {};
  const databases: Record<string, DatabaseSpec> = {};
  for (const alias of aliases) {
    sockets[alias] = dataSocket(alias);
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
}: {
  children: ReactNode;
  aliases?: string[];
}) {
  const [duckdb] = useState(() => engine(aliases));
  return (
    <QueryProvider>
      <DuckDBProvider connect={duckdb.connect} metadataFns={duckdb.metadataFns}>
        <DuckDBConnectionGuard>{children}</DuckDBConnectionGuard>
        <ConnectionLost duckdb={duckdb} />
      </DuckDBProvider>
    </QueryProvider>
  );
}
