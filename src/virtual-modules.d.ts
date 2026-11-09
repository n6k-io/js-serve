// Provided by @n6k.io/build's bundleN6kWorkers / n6kWorkersPlugin.
declare module "virtual:n6k-workers" {
  export const duckdbWorkerUrl: string;
  export const wsWorkerUrl: string;
}

// Provided by @n6k.io/build's bundleN6kDuckDB / n6kDuckDBPlugin.
declare module "virtual:n6k-duckdb-bundle" {
  export const duckdbBundle: {
    mainModule: string;
    mainWorker: string | null;
    pthreadWorker: string | null;
  };
}
