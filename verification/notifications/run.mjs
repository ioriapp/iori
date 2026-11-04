import { local as verificationLocal } from "../native/local.mjs";
import { openWorkspaceView } from "../workspace/interaction.mjs";
import { openSidebar } from "../../e2e/connection/scenario.mjs";
import { verifyTeamCandidateNotification } from "./team-candidate.mjs";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { lockEntry } from "../native/locks.mjs";
import {
  gate,
  linux,
  sh,
  windows,
  ps,
  adb,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
} from "../native/remote.mjs";
import { clickAndroidCliNotification } from "../native/android-notifications.mjs";
import { windowsDesktop } from "../native/windows-desktop.mjs";
import {
  installWindowsNotificationClient,
  uninstallWindowsNotificationClient,
  startWindowsNotificationClient,
} from "./windows-install.mjs";
import { evidence } from "../connection/build.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import { prepareWindowsClientStorage } from "../connection/client-storage.mjs";
import {
  startAndroidClient,
  stopWindowsClientTask,
} from "../connection/client.mjs";
import {
  cleanupFolders,
  stopOwnedWindowsProcesses,
} from "../connection/cleanup.mjs";
import { verificationAndroidPackage } from "../config.mjs";
import { verificationConfig } from "../config.mjs";
import { register } from "../../e2e/connection/scenario.mjs";
import { openFolder, selectWorktree } from "../../e2e/workspace/scenario.mjs";
import { observe, observed } from "../../e2e/terminal/scenario.mjs";
import { finishCli } from "../../e2e/cli-screen/scenario.mjs";
import { waitFor } from "../ui.mjs";

const candidateOnly = process.argv.includes("--candidate-only");
const ownerMode = process.argv.includes("--owner-batch");
if (ownerMode && !process.stdin.isTTY)
  throw new Error(
    "Owner observation requires an interactive terminal (tty=true)",
  );
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const selected = process.argv
  .find((arg) => arg.startsWith("--client="))
  ?.slice(9);
const needWindows = selected !== "Android",
  needAndroid = selected !== "Windows";
const apk = process.argv[2];
if (needAndroid) {
  // Keep the exact APK source owned by this run in its cleanup metadata too.
  state.androidRoot = path.dirname(path.resolve(apk));
  state.androidPackage = verificationAndroidPackage;
}
gate();
const output = evidence + "/notifications-" + Date.now();
await mkdir(output, { recursive: true });
const result = {
  fixture: "recorded CLI hook shapes through Host; real native OS delivery",
  steps: [],
  cleanup: {},
  failures: [],
};
let host, win, android, runtime, invitation;
state.removeNotificationRegistration = process.argv.includes(
  "--remove-notification-registration",
);
let ownerInput;
let ownerStarted = false;
let cancelOwner;
const ownerCancelled = new Promise((_, reject) => {
  cancelOwner = reject;
});
void ownerCancelled.catch(() => {});
const ownerConsole = () => {
  const reader = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  reader.on("SIGINT", () =>
    cancelOwner(new Error("Owner verification cancelled")),
  );
  return reader;
};
const waitOwner = async (read, predicate = Boolean) => {
  for (;;) {
    const value = await Promise.race([read(), ownerCancelled]);
    if (predicate(value)) return value;
    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 200)),
      ownerCancelled,
    ]);
  }
};
const ownerNotification = async (label, trigger) => {
  if (!ownerStarted)
    await ownerInput.question(`Owner: 準備ができたらEnter（${label}）: `);
  ownerStarted = true;
  const pendingBefore = await evaluate(win, "window.__ioriNotificationTargets");
  await trigger?.();
  await waitOwner(() =>
    evaluate(
      win,
      `window.__ioriNotificationTargets>${pendingBefore}&&document.hasFocus()&&Boolean(document.querySelector('[data-iori-view="terminal"][data-iori-displayed="true"]'))`,
    ),
  );
  return {
    found: true,
    activationObserved: true,
    ownerObservationPending: true,
  };
};
// Automatic acceptance reads the OS notification history and invokes its protocol
// route. It does not claim a human saw or physically clicked a live toast.
const windowsNotification = async (kind, trigger) => {
  await trigger?.();
  const hostKey = await evaluate(
    win,
    "window.__TAURI__.core.invoke('native_initial_state').then(state=>state.hosts[0].publicKey)",
  );
  const identity = await waitFor(
    async () => {
      const value = await windowsDesktop(state, "identity");
      result.windowsLastIdentity = value;
      await save();
      return value;
    },
    (value) =>
      value.notifications.some(
        (item) =>
          item.appId === verificationConfig.identifier &&
          item.tag === id &&
          item.kind === kind,
      ),
  );
  const scheme = verificationConfig.plugins["deep-link"].desktop.schemes[0];
  await windowsDesktop(state, "protocol-open", {
    activationUrl: `${scheme}://cli?host=${hostKey}&terminal=${id}`,
  });
  await win.screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
  );
  return {
    found: true,
    kind,
    identity,
    protocolActivated: true,
    liveToastObserved: false,
  };
};
const ownerConfirm = async (instruction) => {
  ownerInput ??= ownerConsole();
  const answer = await ownerInput.question(
    `Owner: ${instruction}。確認できたら y、できなければ n: `,
  );
  assert.equal(
    answer.trim().toLowerCase(),
    "y",
    "Ownerによる実画面の確認が未達",
  );
};
const cliHome = state.linuxRoot + "/notification-cli-home";
const fixture = state.linuxRoot + "/notification-fixture";
const workspace = state.linuxRoot + "/notification-worktree";
const action = (name) => `[data-iori-action="${name}"]`;
const save = () =>
  writeFile(output + "/results.json", JSON.stringify(result, null, 2));
const trace = (operation) =>
  appendFileSync(
    output + "/operations.jsonl",
    JSON.stringify({ at: new Date().toISOString(), operation }) + "\n",
  );
const record = async (step) => {
  result.steps.push(step);
  console.log(step);
  await save();
};
const asUser = (command) =>
  linux(`sudo -u iori-dev -H bash -lc ${sh(command)}`);
const emit = (payload) => {
  trace("hook " + payload.hook_event_name);
  return asUser(
    `node --input-type=module -e ${sh(`import { writeFileSync, renameSync } from 'node:fs'; writeFileSync(${JSON.stringify(fixture + "/event.tmp")}, ${JSON.stringify(JSON.stringify(payload))}); renameSync(${JSON.stringify(fixture + "/event.tmp")},${JSON.stringify(fixture + "/event.json")});`)}`,
  );
};
const waiting = {
  hook_event_name: "PermissionRequest",
  tool_name: "shell",
  tool_input: { command: 'node -e "console.log(42)"' },
};
const active = { hook_event_name: "UserPromptSubmit" };
const done = {
  hook_event_name: "Stop",
  last_assistant_message: "通知の表示と移動を確認する準備ができました。",
};
const evaluate = (client, expr) => client.browser.evaluateAsync(expr);
const shot = async (client, name) => {
  if (client === android)
    assert.equal(
      await evaluate(client, "document.visibilityState"),
      "visible",
      "背面の他アプリの画面は収集しない",
    );
  assert.equal(
    await client.screen.visible('[data-iori-field="issued-invitation"]'),
    false,
  );
  await client.screen.scrollPageToTop();
  await writeFile(
    output + "/" + name + ".png",
    client === win
      ? Buffer.from(
          win.browser.webdriver
            ? await win.browser.screenshot()
            : (
                await win.browser.call("Page.captureScreenshot", {
                  format: "png",
                })
              ).data,
          "base64",
        )
      : Buffer.from(adb(["exec-out", "screencap", "-p"], { encoding: null })),
  );
};
const openCli = async (client) => {
  const before = await evaluate(
    client,
    "[...document.querySelectorAll('[data-iori-view=terminal]')].map(pane=>pane.dataset.ioriTerminalId)",
  );
  if (!(await client.screen.visible('[data-iori-cli-id="codex"]')))
    await client.screen.click(action("workspace-add-tab"));
  await client.screen.click('[data-iori-cli-id="codex"]');
  const id = await waitFor(() =>
    evaluate(
      client,
      `[...document.querySelectorAll('[data-iori-view="terminal"][data-iori-displayed="true"]')].map(pane=>pane.dataset.ioriTerminalId).find(id=>!${JSON.stringify(before)}.includes(id))`,
    ),
  );
  await client.screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await observed(client, "iori notification fixture ready");
  return id;
};
let id;
let secondWindowsId;
if (ownerMode) ownerInput = ownerConsole();
try {
  asUser(
    `git init -b main ${sh(state.linuxRoot + "/notification-repository")}; git -C ${sh(state.linuxRoot + "/notification-repository")} -c user.name=iori-test -c user.email=iori-test@invalid commit --allow-empty -m 'Notification fixture'; git -C ${sh(state.linuxRoot + "/notification-repository")} worktree add -b cli-notify ${sh(workspace)}`,
  );
  asUser(
    `mkdir -p ${sh(fixture)}; cd ${sh(state.linuxRoot)}; node --input-type=module -e ${sh(`import { prepareCliHome } from './verification/cli/home.mjs'; import { rename } from 'node:fs/promises'; const home = await prepareCliHome(${JSON.stringify(state.linuxRoot)}, {clis:["codex"]}); await rename(home.home,${JSON.stringify(cliHome)});`)}`,
  );
  // A fixture shim delegates version and app-server hook trust to the installed
  // Codex, and replaces only the interactive run. It never calls a model.
  const realCodex = asUser("command -v codex");
  asUser(
    `mkdir -p ${sh(cliHome + "/bin")}; node --input-type=module -e ${sh(`import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(cliHome + "/bin/codex")}, ${JSON.stringify(`#!/bin/sh\ncase "$1" in --version|app-server|login) exec ${sh(realCodex)} "$@";; esac\nexec node ${sh(state.linuxRoot + "/verification/notifications/cli-events.mjs")} ${sh(fixture)}\n`)}, {mode:0o700}); writeFileSync(${JSON.stringify(cliHome + "/.profile")}, ${JSON.stringify(`export PATH=${sh(cliHome + "/bin")}:"$PATH"\n`)});`)}`,
  );
  if (needWindows) {
    prepareWindowsClientStorage(state);
    runtime = prepareWindowsRuntime();
    result.windowsBeforeInstall = await windowsDesktop(state, "identity");
    await save();
    installWindowsNotificationClient(state);
    result.windowsInstalledIdentity = await windowsDesktop(state, "identity");
    assert.equal(
      result.windowsInstalledIdentity.shortcuts.some(
        (item) => item.appId === verificationConfig.identifier,
      ),
      true,
      "Installed Start menu shortcut must have the Client AUMID",
    );
    await save();
    win = await startWindowsNotificationClient(state);
    if (win.launched) result.windowsStartMenuLaunch = win.launched;
    result.windowsStartup = await evaluate(
      win,
      "({origin:location.origin,ready:document.readyState,globalTauri:Boolean(window.__TAURI__),internalTauri:Boolean(window.__TAURI_INTERNALS__)})",
    );
    await save();
  }
  if (needAndroid) android = await startAndroidClient(apk, { install: true });
  for (const [client, name] of [
    [win, "Windows"],
    [android, "Android"],
  ])
    if (client) {
      await waitFor(() => evaluate(client, "Boolean(window.__TAURI__?.event)"));
      for (const method of ["click", "wait"]) {
        const original = client.screen[method];
        client.screen[method] = async (...args) => {
          result.phase = `${name} ${method} ${args[0]}`;
          await save();
          return original(...args);
        };
      }
      await evaluate(
        client,
        `(() => {
        window.__ioriNotificationStates = [];
        window.__ioriNativeNotifications = [];
        const originalInvoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = (command, args, options) => {
          const call = originalInvoke(command, args, options);
          if (command === 'native_notify') {
            const record = {target: args.notification.target};
            window.__ioriNativeNotifications.push(record);
            call.then(() => record.delivered = true, error => record.error = String(error));
          }
          return call;
        };
        window.__ioriUrlEvents = 0;
        window.__ioriUrlPaths = [];
        window.__ioriNotificationTargets = 0;
        window.__TAURI__.event.listen('deep-link://new-url', ({payload}) => { window.__ioriUrlEvents++; window.__ioriUrlPaths=payload.map(url=>new URL(url).pathname); });
        window.__TAURI__.event.listen('native://notification-pending', () => window.__ioriNotificationTargets++);
        return window.__TAURI__.event.listen('native://stream', ({payload}) => {
          window.__ioriNotificationConnectionId = payload.connectionId;
          const event = JSON.parse(payload.json);
          if (event.type === 'terminal.updated') window.__ioriNotificationStates.push({id:event.terminal.id,state:event.terminal.cliStatus?.state});
        }).then(() => true);
      })()`,
      );
    }
  host = await startHost("linux", state.linuxRoot, "notification-data", {
    linuxCliHome: cliHome,
  });
  for (const client of [win, android].filter(Boolean)) {
    invitation = await inviteCli("linux", state.linuxRoot, host.dataHome);
    await register(
      client.screen,
      invitation.invitation,
      "Notification verification",
    );
    await invitation.registered("Notification verification");
    if (await client.screen.visible(action("settings-close")))
      await client.screen.click(action("settings-close"));
    if (client === android) {
      await client.screen.wait('[data-iori-view="notification-permission"]');
      await shot(client, "android-first-notification-confirmation");
      await client.screen.click(action("notifications-allow-background"));
      await waitFor(
        () => adb(["shell", "dumpsys", "window"]),
        (value) =>
          value
            .split(/\r?\n/u)
            .some(
              (line) =>
                line.includes("mCurrentFocus") &&
                line.includes("permissioncontroller"),
            ),
      );
      // This is Android's actual permission dialog, not a grant through adb.
      // Android gives its permission dialog keyboard focus. Use native key
      // navigation to activate Allow; never collect other apps' UI hierarchy.
      await writeFile(
        output + "/android-os-permission.png",
        Buffer.from(adb(["exec-out", "screencap", "-p"], { encoding: null })),
      );
      adb(["shell", "input", "keyevent", "KEYCODE_TAB"]);
      adb(["shell", "input", "keyevent", "KEYCODE_ENTER"]);
      await waitFor(
        () =>
          evaluate(
            client,
            "window.__TAURI__.core.invoke('native_notification_permission')",
          ),
        (value) => value === "granted",
      );
      await record("Android: 初回の説明とOSの通知許可を実際の画面で選ぶ");
    }
    if (await client.screen.visible(action("settings-close")))
      await client.screen.click(action("settings-close"));
    await openFolder(
      client.screen,
      state.linuxRoot + "/notification-repository",
      client === android,
      verificationLocal.linux.host,
    );
    await selectWorktree(client.screen, workspace, client === android);
    await observe(client);
  }
  const primary = win ?? android;
  const first = await openCli(primary);
  await finishCli(primary, first);
  await waitFor(
    () =>
      asUser(
        `test -f ${sh(cliHome + "/.codex/config.toml")} && grep -c trusted_hash ${sh(cliHome + "/.codex/config.toml")} || true`,
      ),
    (value) => Number(value) > 0,
  );
  id = await openCli(primary);
  await waitFor(() =>
    evaluate(
      primary,
      `window.__ioriNotificationStates.some(event=>event.id==='${id}'&&event.state==='idle')`,
    ),
  );
  if (win && !ownerMode && !candidateOnly) {
    secondWindowsId = await openCli(win);
    assert.notEqual(secondWindowsId, id);
    await waitFor(() =>
      evaluate(
        win,
        `window.__ioriNotificationStates.some(event=>event.id==='${secondWindowsId}'&&event.state==='idle')`,
      ),
    );
  }
  if (win && candidateOnly) {
    // Both fixtures watch event.json; leave only the team parent listening
    // before sending its delegation command.
    await finishCli(win, id);
    try {
      await verifyTeamCandidateNotification({
        win,
        state,
        workspace,
        fixture,
        asUser,
        emit,
        evaluate,
        observed,
        result,
        save,
        shot,
        record,
      });
    } catch (error) {
      result.failures.push({ client: "Windows", error: error.message });
      await save();
    }
  }
  if (win && !candidateOnly) {
    try {
      await openWorkspaceView(win.screen, "files");
      const hostKey = await evaluate(
        win,
        "window.__TAURI__.core.invoke('native_initial_state').then(state=>state.hosts[0].publicKey)",
      );
      const scheme = verificationConfig.plugins["deep-link"].desktop.schemes[0];
      const targetUrl = `${scheme}://cli?host=${hostKey}&terminal=${id}`;
      await windowsDesktop(state, "protocol-open", {
        activationUrl: targetUrl,
      });
      await win.screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
      );
      assert.equal(
        Number(
          windows(
            `@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ${ps(state.windowsExecutable)}}).Count`,
          ),
        ),
        1,
      );
      await record("Windows: OSのURL起動で既存processの対象CLIへ移る");
      await openWorkspaceView(win.screen, "files");
      for (const url of [
        `${scheme}://cli?host=invalid&terminal=${id}`,
        `${scheme}://cli?host=${"ab".repeat(32)}&terminal=${id}`,
        `${scheme}://cli?host=${hostKey}&terminal=00000000-0000-0000-0000-000000000000`,
      ]) {
        await windowsDesktop(state, "protocol-open", { activationUrl: url });
      }
      assert.equal(
        await win.screen.visible(
          `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
        ),
        false,
      );
      await record(
        "Windows: 不正・未登録・存在しないURLの対象では画面を開かない",
      );
      const closed = await windowsDesktop(state, "window-close");
      result.windowsClose = closed;
      assert.equal(closed.found, true);
      assert.equal(closed.hidden, true);
      await record("Windows: ×で閉じてもプロセスと通知領域を保つ");
      const toast = ownerMode
        ? await ownerNotification(
            "Codex 承認待ち（本文にconsole.log(42)）",
            () => emit(waiting),
          )
        : await windowsNotification("waiting", () => emit(waiting));
      result.windowsApprovalToast = toast;
      assert.equal(toast.found, true);
      await win.screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
      );
      await record(
        ownerMode
          ? "Windows: 背面の承認トーストを押し、対象CLIへ戻る"
          : "Windows: 承認通知の保存とOSのURL起動による対象CLIへの移動",
      );
      result.windowsApprovalForeground = await windowsDesktop(
        state,
        "foreground-read",
      );
      assert.equal(
        result.windowsApprovalForeground.found,
        true,
        "Notification must focus the installed Client",
      );
      result.windowsNotificationIdentity = await windowsDesktop(
        state,
        "identity",
      );
      if (secondWindowsId) {
        await waitFor(
          () => windowsDesktop(state, "identity"),
          (value) =>
            [id, secondWindowsId].every((terminalId) =>
              value.notifications.some(
                (item) => item.tag === terminalId && item.kind === "waiting",
              ),
            ),
        );
        await record("Windows: 別CLIの承認通知をTagで区別し、両方を履歴へ残す");
      }
      await save();
      if (ownerMode)
        await waitOwner(() =>
          win.screen.visible('[data-iori-view="files"]:not([hidden])'),
        );
      emit(active);
      await openWorkspaceView(win.screen, "files");
      const hidden = await windowsDesktop(state, "window-close");
      assert.equal(hidden.found, true);
      assert.equal(hidden.hidden, true);
      const completion = ownerMode
        ? await ownerNotification("Codex 完了", () => emit(done))
        : await windowsNotification("done", () => emit(done));
      assert.equal(completion.found, true);
      result.windowsCompletionToast = completion;
      if (secondWindowsId) {
        result.windowsReplacement = await waitFor(
          () => windowsDesktop(state, "identity"),
          (value) =>
            [id, secondWindowsId].every(
              (terminalId) =>
                value.notifications.filter((item) => item.tag === terminalId)
                  .length === 1 &&
                value.notifications.some(
                  (item) => item.tag === terminalId && item.kind === "done",
                ),
            ),
        );
        await record(
          "Windows: 同じCLIの承認を完了で置き換え、別CLIの通知は保持する",
        );
      }
      await win.screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
      );
      await record(
        ownerMode
          ? "Windows: 完了のトーストを押し、対象CLIへ戻る"
          : "Windows: 完了通知の保存とOSのURL起動による対象CLIへの移動",
      );
      result.windowsCompletionForeground = await windowsDesktop(
        state,
        "foreground-read",
      );
      assert.equal(result.windowsCompletionForeground.found, true);
      if (ownerMode)
        await waitOwner(() =>
          win.screen.visible('[data-iori-view="files"]:not([hidden])'),
        );
      await openWorkspaceView(win.screen, "files");
      emit(active);
      emit(waiting);
      result.windowsMinimized = await windowsDesktop(state, "window-minimize");
      assert.equal(result.windowsMinimized.minimized, true);
      const history = ownerMode
        ? await ownerNotification("通知センターのCodex承認待ち（Win+Nで開く）")
        : await windowsNotification("waiting");
      assert.equal(history.found, true);
      result.windowsHistory = history;
      await win.screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
      );
      await record(
        ownerMode
          ? "Windows: 通知センターの履歴を押して対象CLIへ移る"
          : "Windows: 通知履歴の対象へのURL起動で最小化から戻る",
      );
      result.windowsHistoryForeground = await windowsDesktop(
        state,
        "foreground-read",
      );
      assert.equal(result.windowsHistoryForeground.found, true);
      if (ownerMode)
        await waitOwner(() =>
          win.screen.visible('[data-iori-view="files"]:not([hidden])'),
        );
      for (const section of ["notifications", "general"]) {
        await win.screen.click(action("settings-open"));
        await win.screen.click(action(`settings-${section}`));
        for (const theme of ["light", "dark"]) {
          await evaluate(
            win,
            `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
          );
          await shot(win, `windows-settings-${section}-${theme}`);
        }
        await win.screen.click(action("settings-close"));
      }
    } catch (error) {
      result.failures.push({ client: "Windows", error: error.message });
      await save();
    } finally {
      result.windowsNotificationStates = await evaluate(
        win,
        "window.__ioriNotificationStates",
      );
      result.windowsNotificationSeen = await evaluate(
        win,
        "window.__TAURI__.core.invoke('native_load_view', {scope:'notification-seen'}).then(value=>Object.values(value??{}))",
      );
      result.windowsActivationEvents = await evaluate(
        win,
        "({urls:window.__ioriUrlEvents,paths:window.__ioriUrlPaths,targets:window.__ioriNotificationTargets})",
      );
      await save();
    }
  }
  if (android) {
    try {
      // Open the same CLI through the ordinary sidebar row (Mobile drawer).
      if (!(await android.screen.visible(`[data-iori-terminal-row="${id}"]`)))
        await openSidebar(android.screen);
      await android.screen.click(`[data-iori-terminal-row="${id}"]`);
      await android.screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
      );
      emit(active);
      if (!(await android.screen.visible(action("sidebar-open-files"))))
        await openSidebar(android.screen);
      await openWorkspaceView(android.screen, "files");
      adb(["shell", "input", "keyevent", "KEYCODE_HOME"]);
      await waitFor(
        () =>
          adb([
            "shell",
            "dumpsys",
            "activity",
            "services",
            verificationAndroidPackage,
          ]),
        (value) => value.includes("IoriConnectionService"),
      );
      emit(waiting);
      await waitFor(
        () =>
          adb(["shell", "cmd notification list"])
            .split(/\r?\n/u)
            .filter((key) => key.split("|")[1] === verificationAndroidPackage)
            .map((key) => adb(["shell", `cmd notification get ${sh(key)}`]))
            .join("\n"),
        (value) => value.includes("Codex") && value.includes("console.log(42)"),
      );
      await clickAndroidCliNotification(
        verificationAndroidPackage,
        output + "/android-notification.png",
      );
      await android.screen.wait(
        `[data-iori-terminal-id="${id}"][data-iori-displayed="true"]`,
      );
      await record(
        "Android: 常駐接続の背面で承認通知を受け、押して対象CLIへ戻る",
      );
    } catch (error) {
      result.failures.push({ client: "Android", error: error.message });
      await save();
    }
  }
  if (
    win &&
    ownerMode &&
    !result.failures.some((failure) => failure.client === "Windows")
  ) {
    await windowsDesktop(state, "window-close");
    await waitOwner(() => evaluate(win, "document.hasFocus()"));
    await record("Windows: Ownerが通知領域のメニューと開くを確認する");
    await openWorkspaceView(win.screen, "files");
    emit(active);
    await waitFor(() =>
      evaluate(win, "window.__ioriNotificationStates.at(-1)?.state==='active'"),
    );
    if (ownerMode)
      await waitOwner(() =>
        evaluate(
          win,
          "window.__TAURI__.window.getCurrentWindow().isVisible().then(visible=>!visible)",
        ),
      );
    emit(waiting);
    await (ownerMode ? waitOwner : waitFor)(
      () =>
        Number(
          windows(
            `@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ${ps(state.windowsExecutable)}}).Count`,
          ),
        ) === 0,
    );
    await record("Windows: Ownerが通知領域から終了し、processの終了を確認する");
    await (ownerMode ? waitOwner : waitFor)(
      () =>
        Number(
          windows(
            `@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ${ps(state.windowsExecutable)}}).Count`,
          ),
        ) === 1,
    );
    await record(
      "Windows: OwnerがClient終了後の通知履歴から対象CLIへの起動を確認する",
    );
    result.windowsColdForeground = await (ownerMode ? waitOwner : waitFor)(
      () => windowsDesktop(state, "foreground-read"),
      (value) => value.found,
    );
    assert.equal(result.windowsColdForeground.found, true);
    if (ownerMode) {
      await ownerConfirm(
        "完了・最小化からの通知履歴・通知領域の開くと終了・×で閉じる・終了後の履歴から対象CLIと前面復帰を、一覧の手順ですべて目で確認しましたか",
      );
      result.windowsOwnerBatchConfirmed = true;
    }
  }
  if (result.failures.length)
    throw new Error(
      "実機通知の未達条件: " +
        result.failures.map((f) => f.client + ": " + f.error).join("; "),
    );
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = error.message;
  const lastHook = asUser(
    `if test -f ${sh(fixture + "/last-post.json")}; then cat ${sh(fixture + "/last-post.json")}; fi`,
  );
  if (lastHook) result.lastHook = JSON.parse(lastHook);
  for (const [client, name] of [
    [win, "windows"],
    [android, "android"],
  ])
    if (client) {
      try {
        result[name + "NativeNotifications"] = await evaluate(
          client,
          "window.__ioriNativeNotifications",
        );
        result[name + "NotificationStates"] = await evaluate(
          client,
          "window.__ioriNotificationStates",
        );
        result[name + "NotificationSeen"] = await evaluate(
          client,
          "window.__TAURI__.core.invoke('native_load_view', {scope:'notification-seen'}).then(value=>Object.values(value??{}))",
        );
        if (await client.screen.visible('[data-iori-view="workspace"]'))
          await shot(client, `${name}-failure`);
        result[name + "State"] = await evaluate(
          client,
          `({ visibility:document.visibilityState, focused:document.hasFocus(), dialogs:[...document.querySelectorAll('[role="dialog"]')].map(e=>e.dataset.ioriView), clis:[...document.querySelectorAll('[data-iori-cli-id]')].map(e=>e.dataset.ioriCliId), rows:[...document.querySelectorAll('[data-iori-terminal-row]')].map(e=>({id:e.dataset.ioriTerminalRow,status:[...e.querySelectorAll('[aria-label]')].map(x=>x.getAttribute('aria-label'))})), terminals:[...document.querySelectorAll('[data-iori-view="terminal"]')].map(e=>({id:e.dataset.ioriTerminalId,state:e.dataset.ioriStreamState})) })`,
        );
      } catch {
        /* Do not collect a registration screen. */
      }
    }
  process.exitCode = 1;
  console.error(error.message);
} finally {
  ownerInput?.close();
  if (android) adb(["shell", "cmd", "statusbar", "collapse"]);
  invitation?.stop();
  for (const [name, cleanup] of [
    ["host", () => host?.stop()],
    ["android", () => android?.stop()],
    ["windows", () => win?.stop()],
    ["windowsTask", () => needWindows && stopWindowsClientTask(state)],
    [
      "windowsProcesses",
      () => needWindows && stopOwnedWindowsProcesses(state.windowsRoot),
    ],
    ["runtime", () => cleanupWindowsRuntime(runtime)],
    [
      "windowsInstallation",
      () => needWindows && uninstallWindowsNotificationClient(state),
    ],
    ["folders", () => cleanupFolders(state)],
  ]) {
    try {
      trace("cleanup begin " + name);
      await cleanup();
      trace("cleanup end " + name);
      result.cleanup[name] = "recovered";
    } catch (error) {
      result.cleanup[name] = error.message;
      process.exitCode = 1;
    }
  }
  await save();
  console.log("evidence: " + output);
}
