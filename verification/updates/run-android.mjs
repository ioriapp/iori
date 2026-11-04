import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate, adb } from "../native/remote.mjs";
import { openAndroidLauncherApp } from "../native/android-launcher.mjs";
import { evidence } from "../connection/build.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import { startAndroidClient, androidPackage } from "../connection/client.mjs";
import {
  setAndroidInstallPermission,
  androidInstallerControl,
  androidInstallerControls,
  androidActivityResumed,
  waitForAndroidForeground,
  tapAndroidSystemControl,
} from "../native/android-system-ui.mjs";
import { verificationConfig } from "../config.mjs";
import {
  register,
  openSidebar,
  openSettingsSection,
} from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";
import { startDistribution, port } from "./distribution.mjs";
await lockEntry(import.meta.url);
gate({ devices: ["android", verificationLocal.linux.host] });
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const root = state.updateRoot;
const output = path.join(evidence, "updates", `android-${Date.now()}`);
await mkdir(output, { recursive: true });
const result = { passed: false, steps: [], cleanupErrors: [] };
const clientPids = new Set();
async function navigationHost(screen) {
  await screen.wait('[data-iori-view="workspace"]');
  if (await screen.visible('[data-iori-action="settings-close"]'))
    await screen.click('[data-iori-action="settings-close"]');
  const row = ".nav-host-title[data-iori-host-key]";
  if (!(await screen.visible(row))) await openSidebar(screen);
  await screen.wait(row);
  return screen.text(row + " .nav-host-name");
}
let distribution,
  reverse,
  host,
  invitation,
  client,
  installed = false;
try {
  if (
    adb(["shell", "pm", "list", "packages", androidPackage]).includes(
      "package:" + androidPackage,
    )
  )
    throw new Error(
      "The verification package already exists and is not owned by this run",
    );
  distribution = await startDistribution(root);
  adb(["reverse", "--no-rebind", `tcp:${port}`, `tcp:${port}`]);
  reverse = String(port);
  // This device's toybox requires a positive -q delay after stdin closes.
  adb(["shell", "toybox", "nc", "-q", "1", "127.0.0.1", String(port)], {
    input: "",
  });
  result.steps.push(
    "Android localhost reaches the distribution through this run's ADB reverse",
  );
  host = await startHost("linux", state.linuxRoot);
  invitation = await inviteCli("linux", state.linuxRoot, host.dataHome);
  installed = true;
  result.stage = "launch old Client";
  client = await startAndroidClient(path.join(root, "old.apk"));
  clientPids.add(client.pid);
  result.stage = "register Host through UI";
  await register(client.screen, invitation.invitation, "更新検証Android");
  await invitation.registered("更新検証Android");
  const identity = await client.screen.evaluate(
    "window.__TAURI_INTERNALS__.invoke('native_initial_state').then(s=>s.publicKey)",
  );
  const hostName = await navigationHost(client.screen);
  result.steps.push("old Client registered a Host through invitation UI");
  result.stage = "check for update";
  distribution.publish();
  const action = (name) => `[data-iori-action="${name}"]`;
  await openSettingsSection(client.screen, "settings-general");
  await client.screen.click(action("update-check"));
  await client.screen.wait('[data-iori-state="update-version"]');
  assert.equal(
    await client.screen.text('[data-iori-state="update-version"]'),
    state.updateVersions.next,
  );
  await client.screen.click(action("update-install"));
  result.stage = "allow this install source";
  await setAndroidInstallPermission(verificationConfig.productName, true);
  await client.nativeBack();
  result.stage = "cancel OS confirmation";
  const cancel = await androidInstallerControl(
    (node) => node["resource-id"] === "android:id/button2",
  );
  tapAndroidSystemControl(cancel);
  await client.screen.wait('[data-iori-state="update-error"]');
  assert.match(
    await client.screen.text('[data-iori-state="update-error"]'),
    /取り消し|cancelled/u,
  );
  result.steps.push("OS cancellation is shown and installation can be retried");
  const waitForCancellation = async () => {
    await client.screen.wait('[data-iori-state="update-error"]');
    assert.match(
      await client.screen.text('[data-iori-state="update-error"]'),
      /取り消し|cancelled/u,
    );
    await waitForAndroidForeground(androidPackage);
  };
  const confirmation = () =>
    androidInstallerControl(
      (node) => node["resource-id"] === "android:id/button2",
    );
  await client.screen.click(action("update-install"));
  result.stage = "back from OS confirmation";
  await confirmation();
  await client.nativeBack();
  await waitForCancellation();
  result.steps.push(
    "Back from OS confirmation returns to Client and permits retry",
  );
  await client.screen.click(action("update-install"));
  result.stage = "home and launcher return before cancellation";
  await confirmation();
  await client.nativeHome();
  await openAndroidLauncherApp(verificationConfig.productName);
  await waitForAndroidForeground(androidPackage);
  await client.screen.click(action("update-resume-installation"));
  tapAndroidSystemControl(await confirmation());
  await waitForCancellation();
  result.steps.push(
    "Home and launcher return allows explicit confirmation reopening; cancellation returns to Client",
  );
  await client.screen.click(action("update-install"));
  result.stage = "home and launcher return before installation";
  await confirmation();
  await client.nativeHome();
  await openAndroidLauncherApp(verificationConfig.productName);
  await waitForAndroidForeground(androidPackage);
  await client.screen.wait(action("update-resume-installation"));
  await writeFile(
    path.join(output, "continue-installation.png"),
    adb(["exec-out", "screencap", "-p"], { encoding: null }),
  );
  await client.screen.click(action("update-resume-installation"));
  result.stage = "confirm OS installation";
  const confirm = await androidInstallerControl(
    (node) => node["resource-id"] === "android:id/button1",
  );
  assert.equal(
    await client.screen.visible(action("update-resume-installation")),
    false,
    "Opening confirmation consumes the Continue installation action",
  );
  tapAndroidSystemControl(confirm);
  result.stage = "wait for update without repeated confirmation";
  const installedVersion = () =>
    adb(["shell", "dumpsys", "package", androidPackage]).match(
      /versionName=([^\s]+)/u,
    )?.[1];
  result.continuationChecksAfterAccept = 0;
  await waitFor(async () => {
    const controls = androidInstallerControls();
    assert.equal(
      controls.some((node) =>
        ["android:id/button1", "android:id/button2"].includes(
          node["resource-id"],
        ),
      ),
      false,
      "Android installation confirmation must not reappear after accepting update",
    );
    if (installedVersion() === state.updateVersions.next) return true;
    if (androidActivityResumed([androidPackage])) {
      let continuationVisible;
      try {
        continuationVisible = await client.screen.visible(
          action("update-resume-installation"),
        );
      } catch (error) {
        // Self-update may replace the WebView during this read.
        if (installedVersion() === state.updateVersions.next) return true;
        throw error;
      }
      assert.equal(
        continuationVisible,
        false,
        "Continue installation must not reappear after accepting update",
      );
      result.continuationChecksAfterAccept += 1;
    }
    return installedVersion() === state.updateVersions.next;
  });
  result.steps.push(
    "OS update confirmation was accepted once and did not reappear before update completed",
  );
  result.steps.push(
    "downloaded and verified the APK; allowed this source and confirmed the Android update",
  );
  await client.stop();
  result.stage = "launch new Client";
  client = await startAndroidClient(undefined, { install: false });
  clientPids.add(client.pid);
  const after = await client.screen.evaluate(
    "window.__TAURI_INTERNALS__.invoke('native_initial_state').then(s=>s.publicKey)",
  );
  assert.equal(after === identity, true, "device identity is preserved");
  assert.equal(await navigationHost(client.screen), hostName);
  assert.equal(
    await client.screen.evaluate(
      "window.__TAURI_INTERNALS__.invoke('native_update_options').then(x=>x.version)",
    ),
    state.updateVersions.next,
  );
  await writeFile(
    path.join(output, "after.png"),
    adb(["exec-out", "screencap", "-p"], { encoding: null }),
  );
  result.steps.push(
    "new version opened; device identity and registered Host remain",
  );
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  if (client)
    result.views = await client.screen
      .evaluate(
        "Array.from(document.querySelectorAll('[data-iori-view]')).map(e=>e.getAttribute('data-iori-view'))",
      )
      .catch(() => []);
  process.exitCode = 1;
} finally {
  for (const [name, cleanup] of [
    [
      "update log",
      async () => {
        if (clientPids.size) {
          const lines = [...clientPids].flatMap((pid) =>
            adb(["logcat", "-d", "--pid=" + pid])
              .split("\n")
              .filter((line) => line.includes("[client-update]")),
          );
          await writeFile(
            path.join(output, "native-update.log"),
            lines.join("\n"),
          );
        }
      },
    ],
    ["Client", () => client?.stop()],
    [
      "package",
      () => {
        if (
          installed &&
          adb(["shell", "pm", "list", "packages", androidPackage]).includes(
            "package:" + androidPackage,
          )
        )
          adb(["uninstall", androidPackage]);
      },
    ],
    ["invitation", () => invitation?.stop()],
    ["Host", () => host?.stop()],
    ["distribution", () => distribution?.close()],
    [
      "ADB reverse",
      () => {
        if (reverse) adb(["reverse", "--remove", `tcp:${reverse}`]);
      },
    ],
    [
      "TLS files",
      () => rm(path.join(root, "tls"), { recursive: true, force: true }),
    ],
    [
      "signing files",
      () => rm(path.join(root, "signing"), { recursive: true, force: true }),
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
