import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ownVerificationDirectory,
  recoverVerificationDirectory,
  registerCleanup,
} from "../../verification/lifecycle.mjs";
import { stopCliProcesses } from "../../verification/cli/home.mjs";

const prefix = "iori-cli-compat-";

async function recoverHosts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("iori-host-e2e-"))
      continue;
    const recovered = await recoverVerificationDirectory(
      join(directory, entry.name),
      (host) => stopCliProcesses(join(host, "cli-home")),
    );
    assert.ok(recovered, `Temporary Host not recovered: ${entry.name}`);
  }
}

/** Only marked, inactive runs created by this monitor are recoverable. */
export async function prepareTemporaryDirectory(root, stopTests) {
  const parent = join(root, "tmp");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(prefix))
      await recoverVerificationDirectory(
        join(parent, entry.name),
        recoverHosts,
      );
  }
  const directory = await mkdtemp(join(parent, prefix));
  await ownVerificationDirectory(directory);
  const close = registerCleanup(async () => {
    await stopTests();
    await recoverHosts(directory);
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, close };
}
