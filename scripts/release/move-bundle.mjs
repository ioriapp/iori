import { rename } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

export async function moveBundle(from, to) {
  const started = Date.now();
  let backoff = 0;
  for (;;) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      // graceful-fs uses up to 60s, with 10ms increments capped at 100ms,
      // for Windows antivirus / executable locks during rename.
      if (
        process.platform !== "win32" ||
        !["EPERM", "EBUSY", "EACCES"].includes(error.code) ||
        Date.now() - started >= 60000
      )
        throw error;
      await setTimeout(backoff);
      backoff = Math.min(backoff + 10, 100);
    }
  }
}

if (process.argv[1] === import.meta.filename)
  await moveBundle(process.argv[2], process.argv[3]);
