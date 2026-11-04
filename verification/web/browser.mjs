import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export async function chromiumExecutable(chromium) {
  let executablePath =
    process.env.IORI_CHROMIUM_PATH ?? chromium.executablePath();
  try {
    await access(executablePath);
  } catch (error) {
    if (process.env.IORI_CHROMIUM_PATH) throw error;
    // Playwright may advance before this machine's existing browser cache does.
    // Select an installed Chromium; never download a browser during acceptance.
    const cache = join(homedir(), ".cache/ms-playwright");
    const installed = (await readdir(cache))
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    executablePath = undefined;
    for (const name of installed) {
      for (const layout of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = join(cache, name, layout);
        try {
          await access(candidate);
          executablePath = candidate;
          break;
        } catch (missing) {
          if (missing.code !== "ENOENT") throw missing;
        }
      }
      if (executablePath) break;
    }
    if (!executablePath) throw error;
  }
  return executablePath;
}
