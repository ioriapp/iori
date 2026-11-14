import { readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MessageChannel } from "node:worker_threads";
import {
  stopVerificationUnitsUnder,
  stopTerminalDaemon,
} from "./terminal/daemon-process.mjs";

const cleanups = new Set();
let stopping;

/** Normal completion and signals share the same in-flight cleanup. */
export function registerCleanup(cleanup) {
  let pending;
  const close = (...args) => {
    pending ??= Promise.resolve()
      .then(() => cleanup(...args))
      .finally(() => cleanups.delete(close));
    return pending;
  };
  cleanups.add(close);
  return close;
}

for (const [signal, code] of [
  ["SIGTERM", 143],
  ["SIGINT", 130],
]) {
  process.on(signal, () => {
    stopping ??= (async () => {
      // A pending Promise alone does not keep node --test alive after abort.
      const keepAlive = new MessageChannel();
      keepAlive.port1.start();
      keepAlive.port1.ref();
      for (const close of [...cleanups].reverse()) {
        try {
          await close();
        } catch (error) {
          console.error(error);
        }
      }
      keepAlive.port1.close();
      keepAlive.port2.close();
      process.exit(code);
    })();
  });
}

async function identity(pid) {
  if (process.platform !== "linux") {
    try {
      process.kill(pid, 0);
      return { pid };
    } catch (error) {
      if (error.code === "ESRCH") return undefined;
      throw error;
    }
  }
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (["Z", "X"].includes(fields[0])) return undefined;
    return {
      pid,
      start: fields[19],
      boot: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
    };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return undefined;
    throw error;
  }
}

const ownerFile = "verification-owner.json";

/** Write ownership before any Host or daemon can start in the directory. */
async function writeOwner(directory, owner) {
  const temporary = join(directory, `${ownerFile}.${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(owner), { mode: 0o600 });
  await rename(temporary, join(directory, ownerFile));
}

export async function ownVerificationDirectory(directory) {
  await writeOwner(directory, {
    ...(await identity(process.pid)),
    daemonRoots: [],
  });
}

export async function recoverVerificationDirectory(directory) {
  let owner;
  try {
    owner = JSON.parse(await readFile(join(directory, ownerFile), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const current = await identity(owner.pid);
  if (current && current.start === owner.start && current.boot === owner.boot)
    return false;
  if (process.platform === "linux") await stopVerificationUnitsUnder(directory);
  for (const root of owner.daemonRoots ?? []) await stopTerminalDaemon(root);
  await rm(directory, { recursive: true, force: true });
  return true;
}

let recovering;
/** A missing marker is not permission to remove an older or active run. */
export function recoverStaleVerificationRuns() {
  recovering ??= (async () => {
    if (process.platform !== "linux") return;
    for (const parent of new Set([tmpdir(), "/tmp", "/var/tmp"])) {
      for (const entry of await readdir(parent, { withFileTypes: true })) {
        if (
          !entry.isDirectory() ||
          !/^(iori-host-e2e-|iori-startup-send-|iori-background-web-|iori-web-runs-)/u.test(
            entry.name,
          )
        )
          continue;
        await recoverVerificationDirectory(join(parent, entry.name));
      }
    }
  })().finally(() => {
    recovering = undefined;
  });
  return recovering;
}

/** Find a run boundary, never the user's Host data directory. */
export async function verificationDirectoryFor(path) {
  for (let directory = resolve(path); ; directory = dirname(directory)) {
    try {
      await readFile(join(directory, ownerFile), "utf8");
      return directory;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (directory === dirname(directory)) return undefined;
  }
}

const registrations = new Map();
export async function registerVerificationDaemon(root) {
  const directory = await verificationDirectoryFor(root);
  if (!directory) return;
  const previous = registrations.get(directory) ?? Promise.resolve();
  const pending = previous.then(async () => {
    const file = join(directory, ownerFile);
    const owner = JSON.parse(await readFile(file, "utf8"));
    if (!owner.daemonRoots.includes(root)) {
      owner.daemonRoots.push(root);
      await writeOwner(directory, owner);
    }
  });
  registrations.set(directory, pending);
  await pending;
}
