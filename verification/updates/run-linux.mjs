import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate, linux, sh } from "../native/remote.mjs";
import { evidence, command } from "../connection/build.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  register,
  openSettingsSection,
} from "../../e2e/connection/scenario.mjs";
import { waitForOperation } from "../ui.mjs";
import { startLinuxClient, asUser } from "../linux-client/client.mjs";
import { startDistribution } from "./distribution.mjs";
import { writeDraft, assertDraft } from "./draft.mjs";

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.linux.host] });
const format = process.argv
  .find((arg) => arg.startsWith("--format="))
  ?.slice(9);
if (!["deb", "AppImage"].includes(format))
  throw new Error("--format=deb または --format=AppImage を指定してください");
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const output = path.join(evidence, "updates", `linux-${format}-${Date.now()}`);
await mkdir(output, { recursive: true });
const result = { passed: false, phases: [], cleanupErrors: [] };
const root = state.linuxRoot + "/client-" + Date.now();
const asset = `iori-linux-x64.${format}`;
const old = path.join(state.updateRoot, "old", asset);
const packageName =
  format === "deb"
    ? execFileSync("dpkg-deb", ["-f", old, "Package"], {
        encoding: "utf8",
      }).trim()
    : undefined;
const rule = `/etc/polkit-1/rules.d/49-iori-verification-${process.pid}.rules`;
let distribution,
  host,
  invitation,
  client,
  installed = false,
  ruleInstalled = false;
const stage = (name) => {
  result.operationAtFailure = name;
};
try {
  stage("old package preparation");
  linux(asUser(`mkdir -p ${sh(root)}`));
  await command("scp", [
    old,
    verificationLocal.linux.host + ":/tmp/iori-old-client-" + process.pid,
  ]);
  const remoteAsset = root + "/" + asset;
  linux(
    `sudo install -o iori-dev -g iori-dev -m 755 /tmp/iori-old-client-${process.pid} ${sh(remoteAsset)} && rm /tmp/iori-old-client-${process.pid}`,
  );
  if (format === "deb") {
    if (
      linux(
        `dpkg-query -W -f='\${db:Status-Status}' ${sh(packageName)} 2>/dev/null || true`,
      ) === "installed"
    )
      throw new Error("既存の検証用debが入っています。上書きせず停止します");
    linux(`sudo dpkg -i ${sh(remoteAsset)}`);
    installed = true;
    const policy = `polkit.addRule(function(action, subject) {
  if (subject.user === "iori-dev" && action.id === "org.freedesktop.policykit.exec" && action.lookup("program") === "/usr/bin/dpkg" && /^\\/usr\\/bin\\/dpkg -i \\/tmp\\/iori-client-update-[A-Za-z0-9]+\\/update\\.deb$/.test(action.lookup("command_line"))) return polkit.Result.YES;
});\n`;
    const policyFile = path.join(output, "verification.rules");
    await writeFile(policyFile, policy);
    await command("scp", [
      policyFile,
      verificationLocal.linux.host + ":/tmp/iori-policy-" + process.pid,
    ]);
    linux(
      `sudo install -m 644 /tmp/iori-policy-${process.pid} ${sh(rule)} && rm /tmp/iori-policy-${process.pid}`,
    );
    ruleInstalled = true;
  }
  distribution = await startDistribution(state.updateRoot, {
    keepCredentials: true,
  });
  host = await startHost(
    "linux",
    state.linuxRoot,
    "client-update-host-" + Date.now(),
  );
  invitation = await inviteCli("linux", state.linuxRoot, host.dataHome);
  const executable =
    format === "deb" ? "/usr/bin/iori-linux-verification" : remoteAsset;
  stage("old Client launch and registration");
  client = await startLinuxClient({
    root,
    executable,
    evidence: output,
    result,
  });
  await register(client.screen, invitation.invitation, "更新検証Linux");
  await invitation.registered("更新検証Linux");
  result.phases.push("old version registered Host through invitation UI");
  const teamId = await writeDraft(client.screen);
  result.phases.push("team draft saved before update");
  distribution.publish();
  const action = (name) => `[data-iori-action="${name}"]`;
  stage("download new version");
  await client.screen.click(action("update-check"));
  await client.screen.wait('[data-iori-state="update-version"]');
  assert.equal(
    await client.screen.text('[data-iori-state="update-version"]'),
    state.updateVersions.next,
  );
  await waitForOperation(
    "update downloaded",
    () => client.screen.text(action("update-install")),
    (text) => /再起動して更新|Restart to update/u.test(text),
    async () =>
      (await client.screen.text('[data-iori-state="update-error"]')) ||
      undefined,
  );
  // This scenario checks the Client replacement; leave the source Host running.
  const connected = '[data-iori-field="update-connected-hosts"]';
  if (await client.screen.visible(connected))
    await client.screen.click(connected);
  await client.screenshot("before");
  const before = await client.processes();
  result.phases.push(
    "new version downloaded with format-specific updater manifest",
  );
  stage("restart to update");
  try {
    await client.screen.click(action("update-install"));
  } catch {
    /* Process can exit before the response. */
  }
  await waitForOperation(
    "Client reopened by updater",
    () => client.processes(),
    (pids) => Boolean(pids) && pids !== before,
    async () => {
      try {
        return await client.screen.text('[data-iori-state="update-error"]');
      } catch {
        return undefined;
      }
    },
  );
  await client.reconnect();
  const version = await client.browser.evaluateAsync(
    "window.__TAURI_INTERNALS__.invoke('native_update_options').then(x=>x.version)",
  );
  assert.equal(version, state.updateVersions.next);
  result.phases.push(
    "updater reopened new installed version without runner launch",
  );
  stage("saved Host and draft after restart");
  await assertDraft(client.screen, teamId);
  await openSettingsSection(client.screen, "settings-general");
  await client.screenshot("after");
  result.phases.push("registered Host and draft retained");
  result.passed = true;
  delete result.operationAtFailure;
} catch (error) {
  result.error = error.message;
  try {
    await client?.screenshot("failure");
  } catch {
    /* Keep original failure. */
  }
  process.exitCode = 1;
} finally {
  for (const [name, cleanup] of [
    ["Client", () => client?.stop()],
    ["polkit rule", () => ruleInstalled && linux(`sudo rm ${sh(rule)}`)],
    ["deb", () => installed && linux(`sudo dpkg -r ${sh(packageName)}`)],
    ["invitation", () => invitation?.stop()],
    ["Host", () => host?.stop()],
    ["distribution", () => distribution?.close()],
    ["Client directory", () => linux(asUser(`rm -rf ${sh(root)}`))],
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
