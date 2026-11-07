import { readFile } from "node:fs/promises";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { prepareBuild, command, evidence } from "../connection/build.mjs";
import { buildLinuxClient } from "../../scripts/release/linux-client.mjs";

await lockEntry(import.meta.url);
process.argv.push("--client", "Linux");
await prepareBuild();
await command(process.execPath, [
  "scripts/run-bounded-check.mjs",
  process.execPath,
  "verification/connection/prepare-linux.mjs",
]);
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
await buildLinuxClient({
  source: state.localRoot,
  directory: path.join(evidence, "client"),
  config: "verification/linux-client/tauri.conf.json",
});
