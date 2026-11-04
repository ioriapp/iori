import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate, windows, ps } from "../native/remote.mjs";
import { evidence } from "../connection/build.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import {
  installWindowsNotificationClient,
  uninstallWindowsNotificationClient,
  startWindowsNotificationClient,
} from "../notifications/windows-install.mjs";
import { register } from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";
import { startDistribution } from "./distribution.mjs";
import { writeDraft, assertDraft } from "./draft.mjs";

await lockEntry(import.meta.url);
gate({
  devices: [verificationLocal.linux.host, verificationLocal.windows.host],
});
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const root = state.updateRoot;
const output = path.join(evidence, "updates", `run-${Date.now()}`);
await mkdir(output, { recursive: true });
const result = { passed: false, steps: [], cleanupErrors: [] };
let distribution, host, invitation, client;
try {
  distribution = await startDistribution(root);
  host = await startHost("linux", state.linuxRoot);
  invitation = await inviteCli("linux", state.linuxRoot, host.dataHome);
  prepareWindowsClientStorage(state);
  installWindowsNotificationClient(state);
  client = await startWindowsNotificationClient(state);
  await register(client.screen, invitation.invitation, "更新検証Windows");
  await invitation.registered("更新検証Windows");
  await client.screen.key("Escape");
  result.steps.push("old version registered a Host through invitation UI");
  const teamId = await writeDraft(client.screen);
  distribution.publish();
  const action = (name) => `[data-iori-action="${name}"]`;
  await client.screen.click(action("update-check"));
  await client.screen.wait('[data-iori-state="update-version"]');
  assert.equal(
    await client.screen.text('[data-iori-state="update-version"]'),
    state.updateVersions.next,
  );
  await client.screen.wait(action("update-install") + ":not(:disabled)");
  assert.match(
    await client.screen.text(action("update-install")),
    /再起動して更新|Restart to update/u,
  );
  await writeFile(
    path.join(output, "before.png"),
    Buffer.from(
      (await client.browser.call("Page.captureScreenshot", { format: "png" }))
        .data,
      "base64",
    ),
  );
  const connectedHosts = '[data-iori-field="update-connected-hosts"]';
  await client.screen.wait(connectedHosts);
  assert.equal(
    await client.screen.attribute(connectedHosts, "data-state"),
    "checked",
  );
  result.steps.push("connected Host update is selected by default");
  const debugPort = client.launched.debugPort;
  const oldPid = Number(
    windows(
      `(Get-CimInstance Win32_Process | Where-Object ExecutablePath -eq ${ps(state.windowsExecutable)} | Select-Object -First 1).ProcessId`,
    ),
  );
  try {
    await client.screen.click(action("update-install"));
  } catch {
    // The app can exit before its WebView acknowledges the click. The new
    // process and version below establish whether the operation completed.
  }
  await waitFor(
    () =>
      Number(
        windows(
          `@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ${ps(state.windowsExecutable)} -and $_.ProcessId -ne ${oldPid}}).Count`,
        ),
      ),
    (count) => count > 0,
  );

  await client.detach();
  client = undefined;
  // Attach to the updater's restarted process, without launching it ourselves.
  client = await startWindowsNotificationClient(state, debugPort);
  await waitFor(
    () =>
      client.screen.evaluate(
        "window.__TAURI_INTERNALS__.invoke('native_update_options').then(x=>x.version)",
      ),
    (version) => version === state.updateVersions.next,
  );
  await client.screen.wait('[data-iori-view="connected-host-updates"]');
  assert.equal(
    await client.screen.evaluate(
      "document.querySelectorAll('[data-iori-view=connected-host-updates]').length",
    ),
    1,
  );
  assert.equal(
    await client.screen.evaluate(
      "document.querySelectorAll('[data-iori-update-host]').length",
    ),
    1,
  );
  await writeFile(
    path.join(output, "connected-host-after-restart.png"),
    Buffer.from(
      (await client.browser.call("Page.captureScreenshot", { format: "png" }))
        .data,
      "base64",
    ),
  );
  result.steps.push(
    "NSIS restart resumed the connected Host update once; this source Host cannot update as an installed service",
  );
  await client.screen.key("Escape");
  await assertDraft(client.screen, teamId);
  await client.screen.click(action("settings-open"));
  await client.screen.click(action("settings-general"));
  await writeFile(
    path.join(output, "after.png"),
    Buffer.from(
      (await client.browser.call("Page.captureScreenshot", { format: "png" }))
        .data,
      "base64",
    ),
  );
  result.steps.push(
    "restart to update replaced the installed Client and restarted the new version; registered Host and team draft remain",
  );
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  for (const [name, cleanup] of [
    ["Client", () => client?.stop()],
    ["installer", () => uninstallWindowsNotificationClient(state)],
    ["storage", () => cleanupWindowsClientStorage(state)],
    ["invitation", () => invitation?.stop()],
    ["Host", () => host?.stop()],
    ["distribution", () => distribution?.close()],
    [
      "TLS files",
      () => rm(path.join(root, "tls"), { recursive: true, force: true }),
    ],
  ]) {
    try {
      await cleanup();
    } catch (error) {
      result.cleanupErrors.push({ name, message: error.message });
      process.exitCode = 1;
    }
  }
  result.requests = distribution?.requests;
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, evidence: output }));
}
