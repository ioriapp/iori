import { local as verificationLocal } from "../native/local.mjs";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { lockEntry } from "../native/locks.mjs";
import { gate } from "../native/remote.mjs";
import { evidence, prepareBuild, command } from "../connection/build.mjs";
import { buildLinuxClient } from "../../scripts/release/linux-client.mjs";
import { writeUpdater } from "../../scripts/release/updater.mjs";
import { prepareSigning } from "./keys.mjs";
import {
  endpoint,
  prepareTls,
  verificationSource,
  verificationReleaseSource,
} from "./distribution.mjs";

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.linux.host], requireFreePorts: false });
// --client Linux selects the common Linux Host preparation only.
process.argv.push("--client", "Linux");
await prepareBuild();
const stateFile = path.join(evidence, "build-state.json");
const state = JSON.parse(await readFile(stateFile, "utf8"));
const source = state.localRoot;
const directory = path.join(source, "update-distribution");
await mkdir(path.join(directory, "assets"), { recursive: true });
await prepareTls(directory, "Linux");
const publicKey = await prepareSigning(directory, "Linux");
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
  endpoint("Linux").source + "\n",
);
const config = JSON.parse(
  await readFile("verification/linux-client/tauri.conf.json", "utf8"),
);
config.plugins = { updater: { pubkey: publicKey } };
const current = JSON.parse(
  await readFile("release-version.json", "utf8"),
).version;
const next = semver.inc(current, "patch");
state.updateRoot = directory;
state.updateVersions = { current, next };
await writeFile(stateFile, JSON.stringify(state, null, 2));
await command(process.execPath, [
  "scripts/run-bounded-check.mjs",
  process.execPath,
  "verification/connection/prepare-linux.mjs",
]);
for (const version of [next, current]) {
  await writeFile(
    path.join(source, "release-version.json"),
    JSON.stringify({ version }),
  );
  await writeFile(
    path.join(source, "verification/linux-client/tauri.conf.json"),
    JSON.stringify({ ...config, version }),
  );
  await buildLinuxClient({
    source,
    directory:
      version === next
        ? path.join(directory, "assets")
        : path.join(directory, "old"),
    config: "verification/linux-client/tauri.conf.json",
  });
}
await writeUpdater(
  path.join(directory, "assets"),
  next,
  path.join(directory, "signing/updater.key"),
  {
    "linux-x86_64-deb": "iori-linux-x64.deb",
    "linux-x86_64-appimage": "iori-linux-x64.AppImage",
  },
);
const updaterPath = path.join(directory, "assets/updater.json");
const updater = JSON.parse(await readFile(updaterPath, "utf8"));
for (const platform of Object.values(updater.platforms))
  platform.url = platform.url.replace(
    /^.*\/download\//u,
    endpoint("Linux").source + "/download/",
  );
await writeFile(updaterPath, JSON.stringify(updater, null, 2));
// Keep only runnable artifacts and the dedicated distribution credentials.
await rm(path.join(source, ".local/linux-client-bundle"), {
  recursive: true,
  force: true,
});
