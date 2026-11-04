import { local as verificationLocal } from "../native/local.mjs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import semver from "semver";
import { lockEntry } from "../native/locks.mjs";
import { gate } from "../native/remote.mjs";
import { createSourceCopy } from "../native/source.mjs";
import { evidence, command, prepareBuild } from "../connection/build.mjs";
import { writeUpdater } from "../../scripts/release/updater.mjs";
import {
  prepareTls,
  verificationSource,
  verificationReleaseSource,
  endpoint,
} from "./distribution.mjs";
import { prepareSigning } from "./keys.mjs";

await lockEntry(import.meta.url);
gate({
  devices: [verificationLocal.windows.host, verificationLocal.linux.host],
  requireFreePorts: false,
});
const stateFile = path.join(evidence, "build-state.json");
const state = JSON.parse(await readFile(stateFile, "utf8"));
const directory = path.join(state.localRoot, "update-distribution");
const source = path.join(state.localRoot, "update-windows-source");
await mkdir(path.join(directory, "assets"), { recursive: true });
await prepareTls(directory, "Windows");
const publicKey = await prepareSigning(directory, "Windows");
await createSourceCopy(process.cwd(), source);
execFileSync("git", ["init", "-q"], { cwd: source });
execFileSync("git", ["add", "--force", "."], { cwd: source });
await writeFile(
  path.join(source, "apps/client/src-tauri/src/updates/mod.rs"),
  await verificationSource(
    process.cwd(),
    await readFile(path.join(directory, "tls/ca.pem"), "utf8"),
  ),
);
await writeFile(
  path.join(source, "apps/client/src-tauri/src/updates/release.rs"),
  await verificationReleaseSource(process.cwd()),
);
await writeFile(
  path.join(source, "release-source.txt"),
  endpoint("Windows").source + "\n",
);
const configPath = "verification/updates/tauri.conf.json";
const config = JSON.parse(await readFile(configPath, "utf8"));
config.plugins.updater = { pubkey: publicKey };
const current = JSON.parse(
  await readFile("release-version.json", "utf8"),
).version;
const next = semver.inc(current, "patch");
state.updateRoot = directory;
state.updateVersions = { current, next };
await writeFile(stateFile, JSON.stringify(state, null, 2));
process.env.IORI_VERIFICATION_WINDOWS_PROFILE = "release";
process.env.IORI_VERIFICATION_WINDOWS_BUNDLE = "nsis";
try {
  for (const version of [next, current]) {
    await writeFile(
      path.join(source, "release-version.json"),
      JSON.stringify({ version }),
    );
    await writeFile(
      path.join(source, configPath),
      JSON.stringify({ ...config, version }),
    );
    await prepareBuild(source);
    await command(process.execPath, [
      "scripts/run-bounded-check.mjs",
      process.execPath,
      "verification/connection/run-build.mjs",
    ]);
    await command("scp", [
      `${verificationLocal.windows.host}:${state.windowsRoot.replaceAll("\\", "/")}/target/release/notification-installer.exe`,
      path.join(
        directory,
        version === current ? "old.exe" : "assets/iori-setup-windows-x64.exe",
      ),
    ]);
  }
  await writeUpdater(
    path.join(directory, "assets"),
    next,
    path.join(directory, "signing/updater.key"),
    { "windows-x86_64": "iori-setup-windows-x64.exe" },
  );
  const updaterPath = path.join(directory, "assets/updater.json");
  const updater = JSON.parse(await readFile(updaterPath, "utf8"));
  updater.platforms["windows-x86_64"].url =
    `${endpoint("Windows").source}/download/v${next}/iori-setup-windows-x64.exe`;
  await writeFile(updaterPath, JSON.stringify(updater, null, 2));
} finally {
  await rm(source, { recursive: true, force: true });
}
