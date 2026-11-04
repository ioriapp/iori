import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/** Publish a completed file without exposing a partial write to readers. */
export async function commitAtomicFile(temporary: string, destination: string) {
  const started = Date.now();
  let backoff = 0;
  for (;;) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      // Match graceful-fs and our bundle replacement: transient Windows file
      // sharing failures get up to 60s, with 10ms increments capped at 100ms.
      // Unlike graceful-fs, replacement of an existing destination is intended.
      if (
        process.platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        ) ||
        Date.now() - started >= 60_000
      )
        throw error;
      await setTimeout(backoff);
      backoff = Math.min(backoff + 10, 100);
    }
  }
}

export async function writeFileAtomic(
  destination: string,
  content: string | Uint8Array,
  mode = 0o600,
) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode, flag: "wx" });
    await commitAtomicFile(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}
