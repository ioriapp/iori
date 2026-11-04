import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { evidence } from "./build.mjs";
import { gate, adb } from "../native/remote.mjs";
import { startHost } from "./host.mjs";
import { startAndroidClient } from "./client.mjs";
import { lockEntry } from "../native/locks.mjs";
import { cleanupFolders } from "./cleanup.mjs";
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
gate();
let host, client;
try {
  host = await startHost("windows", state.windowsRoot);
  client = await startAndroidClient(process.argv[2], {
    install: !process.argv.includes("--reuse-android"),
  });
  await client.screen.wait('[data-iori-state="connected"]');
  await client.screen.click('[data-iori-action="open-devices"]');
  await client.screen.wait('[data-iori-state="this-device"]');
  assert.equal(
    await client.screen.visible('[data-iori-field="issued-invitation"]'),
    false,
  );
  const dimensions = await client.browser.evaluate(
    `JSON.stringify({viewportHeight:innerHeight,navHeight:document.querySelector('.connection-settings nav').getBoundingClientRect().height,devicesVisible:!!document.querySelector('[data-iori-state="this-device"]')})`,
  );
  await writeFile(evidence + "/android-layout-final.json", dimensions + "\n");
  await writeFile(
    evidence + "/android-layout-final.png",
    adb(["exec-out", "screencap", "-p"], { encoding: null }),
  );
  console.log(dimensions);
} finally {
  if (client) await client.stop();
  if (host) await host.stop();
  cleanupFolders(state);
}
