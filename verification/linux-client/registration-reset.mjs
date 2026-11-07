import { local } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate, linux, sh } from "../native/remote.mjs";
import { evidence, command } from "../connection/build.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import { register } from "../../e2e/connection/scenario.mjs";
import { startLinuxClient, asUser } from "./client.mjs";
import { cleanupFolders } from "../connection/cleanup.mjs";

await lockEntry(import.meta.url);
gate({ devices: [local.linux.host] });
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const output = path.join(evidence, "registration-reset-" + Date.now());
await mkdir(output, { recursive: true });
const root = state.linuxRoot + "/registration-reset-" + Date.now();
const result = { passed: false, phases: [], cleanupErrors: [] };
let client, host, invitation;
try {
  linux(asUser(`mkdir -p ${sh(root)}`));
  const temporary = "/tmp/iori-reset-client-" + process.pid;
  await command("scp", [
    path.join(evidence, "client/iori-linux-x64.AppImage"),
    local.linux.host + ":" + temporary,
  ]);
  const executable = root + "/iori-linux-verification.AppImage";
  linux(
    `sudo install -o iori-dev -g iori-dev -m 755 ${sh(temporary)} ${sh(executable)} && rm ${sh(temporary)}`,
  );
  host = await startHost(
    "linux",
    state.linuxRoot,
    "registration-reset-host-" + Date.now(),
  );
  invitation = await inviteCli("linux", state.linuxRoot, host.dataHome);
  client = await startLinuxClient({
    root,
    executable,
    evidence: output,
    result,
  });
  await register(client.screen, invitation.invitation, "Linux Client");
  await invitation.registered("Linux Client");
  result.phases.push("Host registered through invitation UI");
  await client.restartWithoutRegistrationKey();
  await client.screen.wait('[data-iori-view="initializing"]');
  await client.screen.wait('[data-iori-action="reset-registration"]');
  assert.match(
    await client.screen.text('[data-iori-view="initializing"]'),
    /Cannot read iori's key from the system keyring\.|OSのキーリングからioriの鍵を読み込めません。/u,
  );
  await client.screenshot("key-lost");
  result.phases.push("missing key with saved data shows recovery action");
  await client.screen.click('[data-iori-action="reset-registration"]');
  await client.screen.wait('[data-iori-action="confirm-reset-registration"]');
  await client.screenshot("confirmation");
  await client.screen.click('[data-iori-action="confirm-reset-registration"]');
  await client.screen.wait('[data-iori-view="first-run"]');
  assert.deepEqual(
    await client.browser.evaluateAsync(
      "window.__TAURI_INTERNALS__.invoke('native_initial_state').then(state => state.hosts)",
    ),
    [],
  );
  await client.screenshot("first-run");
  result.phases.push(
    "confirmed reset returns to first registration screen without saved Hosts",
  );
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
  try {
    await client?.screenshot("failure");
  } catch (captureError) {
    result.screenshotError = captureError.message;
  }
} finally {
  for (const [name, cleanup] of [
    ["Client", () => client?.stop()],
    ["invitation", () => invitation?.stop()],
    ["Host", () => host?.stop()],
    ["Client files", () => linux(asUser(`rm -rf ${sh(root)}`))],
    [
      "build files",
      () => !process.argv.includes("--keep-build") && cleanupFolders(state),
    ],
  ]) {
    try {
      await cleanup();
    } catch (error) {
      result.cleanupErrors.push({ name, message: error.message });
      process.exitCode = 1;
    }
  }
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, evidence: output }));
}
