import { local as verificationLocal } from "../native/local.mjs";
import { startRelay, isolateDirectConnection } from "./relay.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import {
  openAgents,
  returnToWorktree,
} from "../../e2e/web/agents-navigation.mjs";
import {
  observe,
  create,
  open,
  observed,
  clearObserved,
} from "../../e2e/terminal/scenario.mjs";
import { waitForPiInput } from "../../e2e/cli-screen/scenario.mjs";
import { submitToCli } from "../../e2e/cli-screen/input.mjs";

import { webViewSecurity } from "./webview-security.mjs";
import { prepareWindowsClientStorage } from "./client-storage.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { evidence } from "./build.mjs";
import {
  gate,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
  windows,
  ps,
  adb,
  linux,
  sh,
} from "../native/remote.mjs";
import { startHost } from "./host.mjs";
import { inviteCli } from "./cli.mjs";
import {
  startWindowsClient,
  startAndroidClient,
  stopWindowsClientTask,
} from "./client.mjs";
import { stopOwnedWindowsProcesses, cleanupFolders } from "./cleanup.mjs";
import {
  register,
  invite,
  revoke,
  registrationNotice,
  rejectUsedInvitation,
  openSettingsSection,
  openSidebar,
  closeSidebar,
  relayConnection,
  dismissNotificationPrompt,
} from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";

import { lockEntry } from "../native/locks.mjs";
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const apk = process.argv[2];
if (!apk) throw new Error("Android検証専用APKのpathを指定してください");
const hostOption = process.argv.indexOf("--host");
const selectedHost = hostOption < 0 ? undefined : process.argv[hostOption + 1];
if (hostOption >= 0 && selectedHost !== "linux" && selectedHost !== "windows")
  throw new Error("--host は linux または windows を指定してください");
const hosts = selectedHost ? [selectedHost] : ["linux", "windows"];
gate();
const runRoot = evidence + "/run-" + Date.now();
await mkdir(runRoot, { recursive: true });
const results = { matrix: [], steps: [], cleanup: {}, webView2: {} };
const record = async (host, step, details = {}) => {
  results.steps.push({ host, step, result: "passed", ...details });
  await writeFile(runRoot + "/results.json", JSON.stringify(results, null, 2));
  console.log(host + ": " + step);
};
let runtime, win, android, host;
const relays = [];
const direct = isolateDirectConnection(String(Date.now()));
const cliTerminals = new Map();
const activeClis = new Set();
const relayHostOptions = {
  rustLog: "warn,iroh::_events=debug,iroh::socket::remote_map=debug",
};
async function cliForHost() {
  const cli = await inviteCli(host.os, host.root, host.dataHome);
  activeClis.add(cli);
  return cli;
}
async function relayCli(client, cwd, prompt) {
  const screen = client.screen;
  await screen.click('[data-iori-action="settings-close"]');
  if (client === android) {
    await dismissNotificationPrompt(client);
    await closeSidebar(screen);
  }
  if (!cliTerminals.has(client)) {
    await openFolder(
      screen,
      cwd,
      client === android,
      verificationLocal.linux.host,
    );
    await observe(client);
    await openSidebar(screen);
    await openAgents(screen);
    const row = '[data-iori-cli-row="pi"]';
    if ((await screen.attribute(row, "data-state")) !== "open")
      await screen.click(`${row} .team-agent-toggle`);
    const argumentsField = `${row} [data-iori-field="cli-arguments"]`;
    const argumentsValue = '--model "openai/gpt-6-luna"';
    if ((await screen.value(argumentsField)) !== argumentsValue) {
      await screen.input(argumentsField, argumentsValue);
      await screen.click(`${row} [data-iori-action="save-cli-settings"]`);
    }
    await openSidebar(screen);
    await returnToWorktree(screen, cwd);
    if (client === android) await closeSidebar(screen);
    await create(client);
    const panes = () =>
      screen.evaluate(
        `[...document.querySelectorAll('[data-iori-view="terminal"]')].map(pane=>pane.getAttribute('data-iori-terminal-id'))`,
      );
    const before = await panes();
    await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click('[data-iori-cli-id="pi"]');
    const id = await waitFor(async () =>
      (await panes()).find((id) => !before.includes(id)),
    );
    cliTerminals.set(client, id);
    await waitForPiInput(client, id);
  } else await open(client, cliTerminals.get(client));
  if (prompt) {
    await clearObserved(client);
    const suffix = client === android ? "ANDROID_RELAY_OK" : "WINDOWS_RELAY_OK";
    await submitToCli(
      client,
      `Reply only with the concatenation of IORI_ and ${suffix}.`,
    );
    await observed(client, `IORI_${suffix}`);
  }
}

async function hostChoices(client) {
  await openSettingsSection(client.screen, "open-connection");
  await client.screen.click('[data-iori-action="settings-host-select"]');
  const keys = await client.screen.evaluate(
    "[...document.querySelectorAll('[role=option][data-iori-host-key]')].map(e=>e.getAttribute('data-iori-host-key'))",
  );
  await client.screen.key("Escape");
  return keys;
}
async function selectedHostKey(client) {
  return client.screen.attribute(
    '[data-iori-action="settings-host-select"]',
    "data-iori-host-key",
  );
}
async function safeShot(client, name) {
  // Capture only screens without an issued/pasted invitation or QR.
  assert.equal(
    await client.screen.visible('[data-iori-field="issued-invitation"]'),
    false,
  );
  assert.equal(
    Boolean(await client.screen.value('[data-iori-field="invitation"]')),
    false,
  );
  if (client === win)
    await writeFile(
      runRoot + "/" + name + ".png",
      Buffer.from(await win.browser.screenshot(), "base64"),
    );
  else
    await writeFile(
      runRoot + "/" + name + ".png",
      Buffer.from(adb(["exec-out", "screencap", "-p"], { encoding: null })),
    );
}
async function captureFailure() {
  const redact = (value) => {
    let safe = value.replace(
      /iori:\/\/pair\?code=[^\s"'<>]+/gu,
      "[invitation removed]",
    );
    for (const relay of relays)
      if (relay.token) safe = safe.replaceAll(relay.token, "[token removed]");
    return safe;
  };
  const captures = {};
  for (const [name, client] of [
    ["windows", win],
    ["android", android],
  ]) {
    if (!client) continue;
    try {
      await safeShot(client, `${name}-failure`);
      captures[name] = await client.screen.evaluate(`(()=>({
        views:[...document.querySelectorAll('[data-iori-view]')].map(e=>e.getAttribute('data-iori-view')),
        states:[...document.querySelectorAll('[data-iori-state]')].filter(e=>e.getClientRects().length).map(e=>({state:e.getAttribute('data-iori-state'),route:e.getAttribute('data-iori-route')})),
        actions:[...document.querySelectorAll('[data-iori-action]')].filter(e=>e.getClientRects().length).map(e=>e.getAttribute('data-iori-action'))
      }))()`);
      const raw =
        client === win
          ? windows(
              `Get-Content -LiteralPath ${ps(state.windowsRoot + "\\driver.log")} -Raw`,
            )
          : adb(["logcat", "-d", "--pid=" + client.pid]);
      const native = raw
        .split("\n")
        .filter(
          (line) =>
            /\[connection\] native_connect failed:|iroh::|iroh_relay::|iori_client::/u.test(
              line,
            ) && !/execute_script|__TAURI__|invitation/iu.test(line),
        )
        .join("\n");
      await writeFile(`${runRoot}/${name}-failure-native.log`, redact(native));
    } catch {
      captures[name] ??= { unavailable: true };
    }
  }
  if (host?.os === "linux") {
    try {
      const journal = linux(
        `sudo -u iori-dev -H env XDG_RUNTIME_DIR=/run/user/1001 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus journalctl --user --no-pager -o short-iso -u ${sh(host.unit + ".service")}`,
      );
      await writeFile(runRoot + "/host-failure.log", redact(journal));
    } catch {
      captures.host = { unavailable: true };
    }
  }
  await writeFile(
    runRoot + "/failure-clients.json",
    JSON.stringify(captures, null, 2),
  );
}
try {
  results.windowsClientStorage = prepareWindowsClientStorage(state);
  runtime = prepareWindowsRuntime();
  results.runtime = runtime;
  await writeFile(runRoot + "/results.json", JSON.stringify(results, null, 2));
  const before = windows('[DateTime]::UtcNow.ToString("o")');
  win = await startWindowsClient(state);
  android = await startAndroidClient(apk, {
    install: !process.argv.includes("--reuse-android"),
  });
  await win.screen.wait('[data-iori-view="first-run"]');
  await android.screen.wait('[data-iori-view="first-run"]');
  await safeShot(win, "windows-first-run");
  await safeShot(android, "android-first-run");
  const after = windows('[DateTime]::UtcNow.ToString("o")');
  try {
    const events = webViewSecurity(before, after);
    const count = events.length;
    results.webView2 = {
      result: count === 0 ? "起きなかった" : "記録あり",
      count,
      events,
      before,
      after,
    };
  } catch {
    results.webView2 = {
      result: "未確認",
      reason: "Security log取得に失敗",
      before,
      after,
    };
  }
  for (const os of hosts) {
    host = await startHost(
      os,
      os === "linux" ? state.linuxRoot : state.windowsRoot,
      "data",
      relayHostOptions,
    );
    const wn = "Windows 検証端末 " + os,
      an = "Android 検証端末 " + os;
    let cli = await cliForHost();
    await register(win.screen, cli.invitation, wn);
    await record(
      os,
      "CLI招待・Windows登録・完了通知",
      await cli.registered(wn),
    );
    await rejectUsedInvitation(android.screen, cli.invitation, an);
    await record(os, "使用済み招待の再利用を拒否・新しい招待の案内");
    await openSettingsSection(win.screen, "open-connection");
    cli = await cliForHost();
    if (os === "linux") {
      await cli.interrupt();
      await record(os, "Ctrl+C後も招待を使用可能");
    }
    await register(android.screen, cli.invitation, an);
    if (os !== "linux")
      await record(
        os,
        "CLI招待・Android登録・完了通知",
        await cli.registered(an),
      );
    else await record(os, "Android登録");
    if (os === "linux") {
      for (const authenticated of [false, true]) {
        const relay = await startRelay(runRoot, authenticated);
        relays.push(relay);
        await relayConnection({
          clients: [win, android],
          relay,
          direct,
          cwd: host.root,
          record: (step, details) => record(os, step, details),
          cli: relayCli,
          restartClients: async () => {
            await win.stop();
            Object.assign(win, await startWindowsClient(state));
            await observe(win);
            await android.stop();
            Object.assign(
              android,
              await startAndroidClient(apk, { install: false }),
            );
            await observe(android);
          },
          restartHost: async () => {
            await host.stop({ stopTerminals: false });
            host = undefined;
            host = await startHost(
              os,
              state.linuxRoot,
              "data",
              relayHostOptions,
            );
          },
          observeRoutes: async (phase) => {
            const journal = linux(
              `sudo -u iori-dev -H env XDG_RUNTIME_DIR=/run/user/1001 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus journalctl --user --no-pager -o short-iso -u ${sh(host.unit + ".service")}`,
            );
            const safe = relays.reduce(
              (log, relay) =>
                relay.token
                  ? log.replaceAll(relay.token, "[token removed]")
                  : log,
              journal,
            );
            await writeFile(
              `${runRoot}/host-relay-${authenticated ? "auth" : "open"}-${phase}.log`,
              safe,
            );
          },
        });
        await relay.stop();
        relays.pop();
      }
    }
    await openSettingsSection(win.screen, "open-devices");
    await win.screen.wait('[data-iori-state="new-device"]');
    await record(os, "この端末・新しい端末の印");
    await safeShot(win, os + "-windows-devices");
    await safeShot(android, os + "-android-connected-devices");
    await revoke(win.screen, an);
    await android.screen.wait('[data-iori-view="revoked"]');
    await safeShot(android, os + "-android-revoked");
    await record(os, "WindowsからAndroidの登録を取り消す・取り消された案内");
    const previousInvite = await invite(win.screen);
    cli = await cliForHost();
    await win.screen.wait('[data-iori-action="new-invitation"]');
    await win.screen.click('[data-iori-action="new-invitation"]');
    const fromWin = await waitFor(async () => {
      const value = await win.screen.value(
        '[data-iori-field="issued-invitation"]',
      );
      return value && value !== previousInvite ? value : undefined;
    });
    await record(
      os,
      "別発行の無効表示・画面から再発行・CLIに無効を表示して終了",
      await cli.invalidated(),
    );
    await register(android.screen, fromWin, an);
    await registrationNotice(win.screen, an);
    await record(os, "Windows画面の招待・Android再登録・名前と取り消す");
    await revoke(android.screen, wn);
    await win.screen.wait('[data-iori-view="revoked"]');
    await safeShot(win, os + "-windows-revoked");
    await record(os, "AndroidからWindowsの登録を取り消す・取り消された案内");
    const fromAndroid = await invite(android.screen);
    await register(win.screen, fromAndroid, wn);
    await registrationNotice(android.screen, wn);
    await record(os, "Android画面の招待・Windows再登録・名前と取り消す");
    await android.screen.click('[data-iori-action="undo-registration"]');
    await android.screen.click('[data-iori-action="confirm-revoke"]');
    await win.screen.wait('[data-iori-view="revoked"]');
    await record(os, "招待した画面から登録を取り消す");
    cli = await cliForHost();
    await register(win.screen, cli.invitation, wn);
    await cli.registered(wn);
    await openSettingsSection(win.screen, "open-connection");
    await openSettingsSection(android.screen, "open-connection");
    await host.stop();
    host = undefined;
    await waitFor(
      async () =>
        !(await win.screen.visible('[data-iori-state="connected"]')) &&
        !(await android.screen.visible('[data-iori-state="connected"]')),
    );
    host = await startHost(
      os,
      os === "linux" ? state.linuxRoot : state.windowsRoot,
    );
    const readyAt = Date.now();
    const recovery = await Promise.all(
      [win, android].map(async (client) => {
        await waitFor(
          () => client.screen.visible('[data-iori-state="connected"]'),
          Boolean,
          12_000,
        );
        return Date.now() - readyAt;
      }),
    );
    await openSettingsSection(win.screen, "open-devices");
    await openSettingsSection(android.screen, "open-devices");
    for (const client of [win, android]) {
      await waitFor(() =>
        client.screen.evaluate(
          `document.querySelectorAll('[data-iori-row="device"]').length===2`,
        ),
      );
    }
    await record(os, "Host再起動・登録を維持した自動再接続", {
      windowsRecoveryMs: recovery[0],
      androidRecoveryMs: recovery[1],
    });
    await host.stop();
    host = undefined;
    host = await startHost(
      os,
      os === "linux" ? state.linuxRoot : state.windowsRoot,
      "replacement-data",
    );
    for (const [client, name] of [
      [win, wn],
      [android, an],
    ]) {
      const previousKeys = await hostChoices(client);
      await openSettingsSection(client.screen, "open-connection");
      await client.screen.click('[data-iori-action="register-new-host"]');
      cli = await cliForHost();
      await register(client.screen, cli.invitation, name);
      await cli.registered(name);
      const currentKeys = await hostChoices(client);
      assert.equal(currentKeys.length, previousKeys.length + 1);
      assert.equal(
        previousKeys.every((key) => currentKeys.includes(key)),
        true,
      );
      assert.equal(previousKeys.includes(await selectedHostKey(client)), false);
      assert.equal(currentKeys.includes(await selectedHostKey(client)), true);
    }
    await record(
      os,
      "登録済みの接続画面から別のHost鍵へ登録し直す・新Hostを選択",
    );
    await win.stop();
    win = await startWindowsClient(state);
    await openSettingsSection(win.screen, "open-devices");
    await win.screen.wait('[data-iori-state="connected"]');
    await win.screen.wait('[data-iori-state="this-device"]');
    await android.stop();
    android = await startAndroidClient(apk, { install: false });
    await openSettingsSection(android.screen, "open-devices");
    await android.screen.wait('[data-iori-state="connected"]');
    await android.screen.wait('[data-iori-state="this-device"]');
    await record(os, "Clientを開き直して新Hostの選択を維持");
    results.matrix.push(
      { host: os, client: "Windows", flow: "1〜7", result: "passed" },
      {
        host: os,
        client: "Android",
        flow: "1〜7（QRは貼り付け）",
        result: "passed",
      },
    );
    await record(os, "組合せの受入完了");
    await host.stop();
    host = undefined;
  }
} catch (error) {
  results.failure = error instanceof Error ? error.message : "scenario failed";
  if (error instanceof Error)
    results.failureFrames = error.stack
      ?.split("\n")
      .filter((line) => line.includes("file://") && !line.includes("eval"));
  process.exitCode = 1;
  console.error(results.failure);
  await captureFailure();
} finally {
  direct.restore();
  for (const relay of relays) await relay.stop();
  for (const cli of activeClis) if (!cli.closed) cli.stop();
  if (host)
    try {
      await host.stop();
      results.cleanup.hostStopped = true;
    } catch {
      results.cleanup.hostStopped = false;
    }
  if (android)
    try {
      await android.stop();
      results.cleanup.androidStopped = true;
    } catch {
      results.cleanup.androidStopped = false;
    }
  if (win)
    try {
      await win.stop();
      results.cleanup.windowsStopped = true;
    } catch {
      results.cleanup.windowsStopped = false;
    }
  try {
    stopWindowsClientTask(state);
  } catch {
    results.cleanup.scheduledTaskRemoved = false;
  }
  try {
    stopOwnedWindowsProcesses(state.windowsRoot);
    results.cleanup.ownedWindowsProcessesStopped = true;
  } catch {
    results.cleanup.ownedWindowsProcessesStopped = false;
  }
  try {
    cleanupWindowsRuntime(runtime);
  } catch {
    results.cleanup.runtimeRemoved = false;
  }
  try {
    results.cleanup.folders = cleanupFolders(state);
  } catch (error) {
    results.cleanup.foldersFailure = error.message;
    process.exitCode = 1;
  }
  await writeFile(runRoot + "/results.json", JSON.stringify(results, null, 2));
  console.log("evidence: " + runRoot);
}
