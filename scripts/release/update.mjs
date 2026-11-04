import { cp, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { moveBundle } from "./move-bundle.mjs";

if (process.argv.includes("--bootstrap")) {
  const child = spawn(
    process.execPath,
    process.argv.slice(1).filter((arg) => arg !== "--bootstrap"),
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: dirname(process.argv[2]),
    },
  );
  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  const request = JSON.parse(await readFile(process.argv[2], "utf8"));
  const { adapter } = await import(
    process.platform === "win32" ? "./update-windows.mjs" : "./update-linux.mjs"
  );
  const os = await adapter(request);
  if (process.argv.includes("--cleanup")) {
    try {
      await os.cleanup();
    } finally {
      await retain(request);
    }
  } else await update(request, os);
}

async function retain(request) {
  await writeFile(
    join(request.storage, "maintenance/previous-update.txt"),
    dirname(process.argv[2]),
    { mode: 0o600 },
  );
}

async function update(request, os) {
  const work = dirname(process.argv[2]);
  const staged = join(work, "host"),
    previous = join(work, "previous"),
    database = join(work, "database");
  const files = ["host.sqlite", "host.sqlite-wal", "host.sqlite-shm"];
  let backedUp = false,
    installed = false,
    stopRequested = false,
    ready = false;
  let stage = "extract";
  async function status(patch) {
    const value = { ...request.status, ...patch };
    const temporary = request.statusFile + ".tmp";
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, request.statusFile);
  }
  try {
    await os.extract(request.archive, staged);
    stage = "prepare";
    await os.prepare();
    stage = "stop";
    stopRequested = true;
    await os.stop();
    stage = "backup";
    await mkdir(database, { recursive: true, mode: 0o700 });
    for (const name of files) {
      await cp(join(request.storage, name), join(database, name)).catch(
        (error) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }
    stage = "replace";
    await moveBundle(request.bundle, previous);
    backedUp = true;
    await moveBundle(staged, request.bundle);
    installed = true;
    stage = "start";
    await os.start();
    ready = true;
    await status({ phase: "succeeded" });
  } catch (error) {
    // A ready Host stays running even if its result could not be persisted.
    if (ready) throw error;
    const failure = {
      stage,
      osError: String(error.code ?? error.signal ?? "unknown"),
    };
    if (backedUp) {
      let restoreFailure;
      let dataRestored = true;
      async function attempt(step, action) {
        try {
          await action();
          return true;
        } catch (error) {
          // A failed step must not prevent the remaining recovery attempts.
          restoreFailure ??= {
            stage: step,
            osError: String(error.code ?? error.signal ?? "unknown"),
          };
          return false;
        }
      }
      const outcome = () => ({
        phase: "failed",
        reason: !dataRestored
          ? "restore-data"
          : restoreFailure
            ? "restore"
            : "startup",
        restored: !restoreFailure,
        ...(restoreFailure ?? failure),
      });
      const stopped = await attempt("stop", () => os.stop());
      if (installed)
        await attempt("replace", () =>
          moveBundle(request.bundle, join(work, "failed")).catch((error) => {
            // An absent new bundle is already out of the old bundle's way.
            if (error.code !== "ENOENT") throw error;
          }),
        );
      await attempt("replace", () => moveBundle(previous, request.bundle));
      // A live Host may still write SQLite. Only this destructive step needs
      // confirmed stop; folder recovery and a start request must still run.
      if (!stopped) dataRestored = false;
      else
        for (const name of files)
          dataRestored =
            (await attempt("restore", async () => {
              // Overwrite directly: a failed copy must not first delete the data.
              await cp(join(database, name), join(request.storage, name)).catch(
                async (error) => {
                  if (error.code !== "ENOENT") throw error;
                  // WAL/SHM absent in the backup must also be absent after restore.
                  await rm(join(request.storage, name), { force: true });
                },
              );
            })) && dataRestored;
      // A status-write failure must not prevent bringing the old Host back.
      await attempt("restore", () => status(outcome()));
      await attempt("start", () => os.start());
      await status(outcome());
    } else {
      try {
        await status({ phase: "failed", reason: "install", ...failure });
      } finally {
        if (stopRequested)
          await os.start().catch(async (error) =>
            status({
              phase: "failed",
              reason: "restore",
              restored: false,
              stage: "start",
              osError: String(error.code ?? error.signal ?? "unknown"),
            }),
          );
      }
    }
  } finally {
    try {
      await os.cleanup();
    } finally {
      // Linux records the retained folder from ExecStopPost, after its final use.
      if (process.platform === "win32") await retain(request);
    }
  }
}
