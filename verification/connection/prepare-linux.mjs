import { local as verificationLocal } from "../native/local.mjs";
import { readFile, mkdir, mkdtemp, rm, cp, chmod } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { evidence, command } from "./build.mjs";
import { sh } from "../native/remote.mjs";
import { lockEntry } from "../native/locks.mjs";
import { localCache, linuxCache } from "../native/cache.mjs";
import { createSourceCopy, refreshSourceMtimes } from "../native/source.mjs";
await lockEntry(import.meta.url);
const addonOnlyArgument = process.argv.indexOf("--addon-only");
const addonOnly = addonOnlyArgument >= 0;
const source = addonOnly
  ? path.resolve(process.argv[addonOnlyArgument + 1] ?? ".")
  : undefined;
let copyRoot;
if (addonOnly) {
  const runs = path.resolve(".local/verification-runs");
  await mkdir(runs, { recursive: true });
  copyRoot = await mkdtemp(path.join(runs, "addon-"));
}
const state = addonOnly
  ? { localRoot: copyRoot }
  : JSON.parse(await readFile(evidence + "/build-state.json", "utf8"));
const cache = path.join(localCache, "linux-host");
const binaries = [
  "native/iori_iroh_host_native.node",
  "terminal-native/iori_terminal_native.node",
  "terminal-native/iori",
];
try {
  if (addonOnly) await createSourceCopy(source, copyRoot);
  await mkdir(cache, { recursive: true });
  const env = {
    ...process.env,
    CI: "1",
    PATH: "/root/.cargo/bin:" + process.env.PATH,
    CARGO_HOME: path.join(cache, "cargo-home"),
    CARGO_TARGET_DIR: path.join(cache, "cargo-target"),
    RUSTUP_HOME: process.env.RUSTUP_HOME ?? "/root/.rustup",
  };
  await command(
    "pnpm",
    [
      "install",
      "--frozen-lockfile",
      "--store-dir",
      path.join(cache, "pnpm-store"),
    ],
    { cwd: state.localRoot, env },
  );
  // The source may have been extracted before another worktree's build.
  // Refresh immediately before Cargo while this entry still holds the lock.
  await refreshSourceMtimes(state.localRoot);
  await command("pnpm", ["--filter", "@iori/host", "build:native"], {
    cwd: state.localRoot,
    env,
  });
  if (addonOnly) {
    for (const binary of binaries)
      await cp(
        path.join(state.localRoot, "apps/host", binary),
        path.join(source, "apps/host", binary),
      );
    await chmod(path.join(source, "apps/host/terminal-native/iori"), 0o755);
    console.log(
      JSON.stringify({
        source,
        sourceCopy: state.localRoot,
        cache,
        addon: "built",
      }),
    );
  } else {
    const install = `cd ${sh(state.linuxRoot)} && corepack pnpm install --frozen-lockfile --store-dir ${sh(linuxCache + "/pnpm-store")}`;
    await command("ssh", [
      "-o",
      "BatchMode=yes",
      verificationLocal.linux.host,
      `sudo -u iori-dev -H env XDG_RUNTIME_DIR=/run/user/1001 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 bash -c ${sh(install)}`,
    ]);
    for (const binary of binaries) {
      const file = state.linuxRoot + "/apps/host/" + binary;
      const child = spawn(
        "ssh",
        [
          "-o",
          "BatchMode=yes",
          verificationLocal.linux.host,
          `sudo -u iori-dev -H bash -c ${sh(`cat > ${sh(file)}${binary === "terminal-native/iori" ? ` && chmod 755 ${sh(file)}` : ""}`)}`,
        ],
        { stdio: ["pipe", "inherit", "inherit"] },
      );
      child.stdin.end(
        await readFile(path.join(state.localRoot, "apps/host", binary)),
      );
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("Linux addon transfer failed")),
        );
      });
    }
    console.log("Linux verification dependencies and addon ready");
  }
} finally {
  if (copyRoot) await rm(copyRoot, { recursive: true, force: true });
}
