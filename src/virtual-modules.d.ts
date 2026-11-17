// Provided by @n6k.io/build's n6kDuckDBPlugin.
declare module "virtual:n6k-duckdb-bundle" {
  export const duckdbBundle: {
    mainModule: string;
    mainWorker: string | null;
    pthreadWorker: string | null;
  };
}
