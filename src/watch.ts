import path from "node:path";
import { watch } from "node:fs";

// Watches the parent dir: editors that save via rename replace the inode, which ends a file watch.
export function watchFile(file: string, onChange: () => void): () => void {
  const name = path.basename(file);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(path.dirname(file), (_event, changed) => {
    if (changed !== name) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
