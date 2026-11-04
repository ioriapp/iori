import { watch } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
// A timeout wrapper can put a runner outside the terminal's foreground process
// group. Reading stdin there stops it with SIGTTIN. Observe an explicit file
// written only after the Owner has answered instead; elapsed time is no answer.
export async function waitForOwnerReady(directory, step) {
  const file = path.join(directory, `continue-${step}`);
  const { promise, resolve, reject } = Promise.withResolvers();
  const watcher = watch(directory, (_event, filename) => {
    if (filename === path.basename(file)) resolve();
  });
  watcher.once("error", reject);
  console.log(JSON.stringify({ ownerReadyRequired: step, continueFile: file }));
  try {
    try {
      await access(file);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await promise;
  } finally {
    watcher.close();
  }
}
