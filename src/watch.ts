import { watch } from "node:fs";

export function watchFile(file: string, onChange: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(file, () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  });
}
