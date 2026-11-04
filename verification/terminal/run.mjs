import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evidence } from "../connection/build.mjs";
import { prepareWindowsClientStorage } from "../connection/client-storage.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  startWindowsClient,
  startAndroidClient,
  stopWindowsClientTask,
} from "../connection/client.mjs";
import {
  stopOwnedWindowsProcesses,
  cleanupFolders,
} from "../connection/cleanup.mjs";
import {
  gate,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
  adb,
  linux,
  windows,
} from "../native/remote.mjs";
import {
  register,
  dismissNotificationPrompt,
} from "../../e2e/connection/scenario.mjs";
import {
  terminalSession,
  nativeTerminalTextSelection,
  beginMobileInput,
  create,
  observe,
  closing,
  closingOutput,
  closingOtherTerminal,
  observed,
  typeTerminal,
  say,
  open,
  clearObserved,
  terminalState,
  evaluateAsync,
  beginRenderObservation,
  observedRenderFrames,
} from "../../e2e/terminal/scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import { loadedWindowsConpty } from "./conpty.mjs";
import { waitFor, wheelWithin } from "../ui.mjs";

import { terminalMouseScroll } from "../../e2e/terminal/mouse-scroll.mjs";
import { androidClipboardImage } from "../../e2e/terminal/android-clipboard.mjs";

import { lockEntry } from "../native/locks.mjs";
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const clientOption = process.argv.indexOf("--client");
const selectedClient =
  process.argv.find((arg) => arg.startsWith("--client="))?.slice(9) ??
  (clientOption < 0 ? undefined : process.argv[clientOption + 1]);
if (
  selectedClient !== undefined &&
  !["Windows", "Android"].includes(selectedClient)
)
  throw new Error("--client は Windows または Android を指定してください");
const needWindows = selectedClient !== "Android";
const needAndroid = selectedClient !== "Windows";
const apk = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
if (needAndroid && !apk) throw new Error("検証専用APKを指定してください");
const hostOption = process.argv.indexOf("--host");
const selectedHost = hostOption < 0 ? undefined : process.argv[hostOption + 1];
if (hostOption >= 0 && selectedHost !== "linux" && selectedHost !== "windows")
  throw new Error("--host は linux または windows を指定してください");
const hosts = selectedHost ? [selectedHost] : ["linux", "windows"];
gate();
const runRoot = `${process.env.IORI_VERIFICATION_EVIDENCE_ROOT ? evidence + "/terminal" : ".local/evidence/terminal"}/run-${Date.now()}`;
await mkdir(runRoot, { recursive: true });
const results = {
  startedAt: new Date().toISOString(),
  matrix: [],
  steps: [],
  phaseTrace: [],
  restartFixtures: [],
  cleanup: {},
  ime: { microsoft: "未確認", gboard: "未確認" },
};
let runtime, win, android, host;
const clients = () =>
  [
    [win, "Windows"],
    [android, "Android"],
  ].filter(([client]) => client);
let activePhase, failedPhase;
const clis = new Set();
const saveResults = () =>
  writeFile(runRoot + "/results.json", JSON.stringify(results, null, 2));
const record = async (os, client, step, details = {}) => {
  results.steps.push({ host: os, client, step, result: "passed", ...details });
  await saveResults();
  console.log(`${os} / ${client}: ${step}`);
};
const phase = async (name, action) => {
  activePhase = name;
  const entry = { phase: name, state: "running" };
  results.phaseTrace.push(entry);
  console.log(`[phase] ${name}: start`);
  await saveResults();
  try {
    const result = await action();
    entry.state = "passed";
    return result;
  } catch (error) {
    entry.state = "failed";
    failedPhase = name;
    throw error;
  } finally {
    if (activePhase === name) activePhase = undefined;
    await saveResults();
    console.log(`[phase] ${name}: ${entry.state}`);
  }
};
const shot = async (client, name, { prompt = false } = {}) => {
  if (prompt) {
    // The scenario has timed application/paint; image transfer is separate.
    // Android WebView's GPU-rendered Terminal can be blank in a CDP capture.
    await writeFile(
      runRoot + "/" + name + ".png",
      Buffer.from(adb(["exec-out", "screencap", "-p"], { encoding: null })),
    );
    return;
  }
  assert.equal(
    await client.screen.visible('[data-iori-field="issued-invitation"]'),
    false,
  );
  assert.equal(
    Boolean(await client.screen.value('[data-iori-field="invitation"]')),
    false,
  );
  // Input focus may scroll the page. Include the old rows and header in evidence.
  await client.screen.scrollPageToTop();
  await evaluateAsync(
    client,
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
  );
  await writeFile(
    runRoot + "/" + name + ".png",
    client === win
      ? Buffer.from(await win.browser.screenshot(), "base64")
      : Buffer.from(adb(["exec-out", "screencap", "-p"], { encoding: null })),
  );
};
try {
  if (needWindows) results.storage = prepareWindowsClientStorage(state);
  if (needWindows || hosts.includes("windows"))
    runtime = prepareWindowsRuntime();
  if (needWindows) win = await startWindowsClient(state);
  if (needAndroid)
    android = await startAndroidClient(apk, {
      install: !process.argv.includes("--reuse-android"),
    });
  for (const os of hosts) {
    const root = os === "linux" ? state.linuxRoot : state.windowsRoot;
    host = await startHost(os, root, "terminal-data");
    for (const [client, name] of clients()) {
      const cli = await inviteCli(os, root, host.dataHome);
      clis.add(cli);
      await register(
        client.screen,
        cli.invitation,
        `Terminal検証 ${name} ${os}`,
      );
      await cli.registered(`Terminal検証 ${name} ${os}`);
      // Registration returns to the devices settings; Terminals open from the
      // folder in the sidebar.
      await client.screen.click('[data-iori-action="settings-close"]');
      if (client === android) await dismissNotificationPrompt(client);
      await openFolder(
        client.screen,
        root,
        client === android,
        os === "linux"
          ? verificationLocal.linux.host
          : verificationLocal.windows.host,
      );
    }
    if (process.argv.includes("--clipboard-image-only")) {
      await observe(android);
      await androidClipboardImage({
        client: android,
        host,
        record,
        shot,
        saveEvidence: (name, data) =>
          writeFile(runRoot + "/android-clipboard-" + name, data),
      });
      results.matrix.push({ host: os, client: "Android", clipboard: "passed" });
      await host.stop();
      host = undefined;
      continue;
    }
    if (process.argv.includes("--case8-only")) {
      for (const [client, name] of clients()) {
        await observe(client);
        await closingOtherTerminal(os, client, root, record, name, phase);
        results.matrix.push({ host: os, client: name, case8: "passed" });
      }
      await host.stop();
      host = undefined;
      continue;
    }
    if (process.argv.includes("--case7-only")) {
      for (const [client, name] of clients()) {
        await observe(client);
        await closingOutput(os, client, root, record, name, phase, shot);
        results.matrix.push({ host: os, client: name, case7: "passed" });
      }
      await host.stop();
      host = undefined;
      continue;
    }
    if (android && os === "linux") {
      await observe(android);
      await create(android);
      const touchCoordinates = await terminalMouseScroll(android);
      await record(
        os,
        "Android",
        "上下スワイプと慣性が正しい座標のホイール報告として実PTYへ届く",
        { touchCoordinates },
      );
      await nativeTerminalTextSelection(android, shot);
      await record(
        os,
        "Android",
        "本物の長押しでメニューと押した行のテキスト選択が開く（まとめて入力・マウス報告あり）",
      );
    }
    if (process.argv.includes("--touch-only")) {
      assert.ok(
        android && os === "linux",
        "--touch-only requires Android × Linux",
      );
      results.matrix.push({ host: os, client: "Android", touch: "passed" });
      await host.stop();
      host = undefined;
      continue;
    }
    const clientNames = clients().map(([, name]) => name);
    const { id, restartMarker } = await terminalSession(
      os,
      clients().map(([client]) => client),
      root,
      record,
      shot,
      async (index, markPhase) => {
        if (clientNames[index] === "Windows") {
          await markPhase("restart/stop-client", () => win.stop());
          win = undefined;
          win = await markPhase("restart/start-client", () =>
            startWindowsClient(state),
          );
          await markPhase("restart/wait-connected", () =>
            win.screen.wait('[data-iori-state="connected"]'),
          );
          return win;
        }
        await markPhase("restart/stop-client", () => android.stop());
        android = undefined;
        android = await markPhase("restart/start-client", () =>
          startAndroidClient(apk, { install: false }),
        );
        await markPhase("restart/wait-connected", () =>
          android.screen.wait('[data-iori-state="connected"]'),
        );
        return android;
      },
      phase,
    );
    if (os === "windows") results.windowsConptyLoaded = loadedWindowsConpty();
    results.restartFixtures.push({ host: os, terminalId: id, restartMarker });
    await saveResults();
    for (const [client] of clients()) {
      await clearObserved(client);
      await beginRenderObservation(client);
    }
    await host.stop();
    host = undefined;
    host = await startHost(os, root, "terminal-data");
    for (const [client, name] of clients()) {
      const phasePrefix = `case5/${os}/${name}`;
      await observed(
        client,
        "Host の再起動で前の shell は終了しました",
        phase,
        `${phasePrefix}/wait-for-old-shell-exit`,
      );
      await observed(
        client,
        restartMarker,
        phase,
        `${phasePrefix}/wait-for-old-final-output`,
      );
      await typeTerminal(
        client,
        say(os, "Host再起動後の入力"),
        phase,
        `${phasePrefix}/input-after-host-restart`,
      );
      await observed(
        client,
        "Host再起動後の入力",
        phase,
        `${phasePrefix}/wait-for-post-restart-input`,
      );
      const frames = await observedRenderFrames(client);
      const framesFile = `${os}-${name.toLowerCase()}-restart-frames.json`;
      await writeFile(runRoot + "/" + framesFile, JSON.stringify(frames));
      const screenshot = os + "-" + name.toLowerCase() + "-restart";
      await shot(client, screenshot);
      const historyScreenshots = [];
      if (os === "windows") {
        // A fresh ConPTY draws at screen coordinates. The recovered viewport
        // is in history, directly above it. Capture that boundary with the
        // existing native wheel helper; the viewport and history captures show the boundary.
        // Other Terminals stay mounted in their tabs; scroll this one.
        const scroll = await wheelWithin(
          client,
          `[data-iori-view="terminal"][data-iori-terminal-id=${JSON.stringify(id)}] [data-iori-part="terminal-screen"]`,
          -0.5,
          4,
        );
        const historyShot = `${screenshot}-history`;
        await shot(client, historyShot);
        historyScreenshots.push({
          screenshot: historyShot + ".png",
          ...scroll,
        });
      }
      await record(os, name, "5 前画面・再起動区切り・表示時に新しいshell", {
        restartMarker,
        screenshot: screenshot + ".png",
        historyScreenshots,
        framesFile,
      });
    }
    for (const [client, name] of clients()) {
      await closing(
        os,
        client,
        root,
        record,
        name,
        async (hostOs, pid, descendants) => {
          assert.equal(Number.isSafeInteger(pid) && pid > 0, true);
          if (!descendants) {
            const rows =
              hostOs === "windows"
                ? JSON.parse(
                    windows(
                      "ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate) -Compress",
                    ),
                  ).map((p) => [
                    p.ProcessId,
                    p.ParentProcessId,
                    Date.parse(p.CreationDate),
                  ])
                : linux("ps -eo pid=,ppid=")
                    .split("\n")
                    .map((line) => line.trim().split(/\s+/u).map(Number));
            const owned = [pid];
            for (let index = 0; index < owned.length; index++) {
              for (const [child, parent, created] of rows)
                if (
                  parent === owned[index] &&
                  (hostOs !== "windows" ||
                    created >= rows.find((row) => row[0] === parent)?.[2]) &&
                  !owned.includes(child)
                )
                  owned.push(child);
            }
            assert.equal(owned.length > 1, true);
            return owned;
          }
          for (const pid of descendants)
            await waitFor(() =>
              hostOs === "windows"
                ? windows(
                    `@(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Count`,
                  ) === "0"
                : linux(
                    `if test -r /proc/${pid}/stat; then awk '{print $3}' /proc/${pid}/stat; else echo gone; fi`,
                  ).match(/^(gone|Z)$/u) !== null,
            );
        },
        phase,
      );
      results.matrix.push({
        host: os,
        client: name,
        result: "passed",
        automaticSteps: "passed",
        ime: "未確認",
      });
    }
    const primary = clients()[0][0];
    // PC focuses from the sidebar; Mobile still starts input by tapping.
    const fromSidebar = await open(primary, id);
    const closeKeyboard =
      fromSidebar && !primary.browser.webdriver
        ? await beginMobileInput(primary)
        : undefined;
    await typeTerminal(
      primary,
      say(os, "他Terminalを閉じても継続"),
      undefined,
      "type",
      { focus: !fromSidebar },
    );
    await observed(primary, "他Terminalを閉じても継続");
    await closeKeyboard?.();
    await host.stop();
    host = undefined;
    // The next Host is explicitly registered through the same UI flow.
    await waitFor(
      () => primary.screen.visible('[data-iori-state="connected"]'),
      (connected) => !connected,
    );
  }
  results.result = "passed";
} catch (error) {
  results.result = "failed";
  results.failure =
    error instanceof Error ? error.message : "Terminal scenario failed";
  results.failurePhase = failedPhase ?? activePhase ?? null;
  results.failureStack = error instanceof Error ? error.stack : undefined;
  for (const [client, name] of [
    [win, "windows-failure"],
    [android, "android-failure"],
  ]) {
    try {
      if (client) await shot(client, name);
    } catch {
      // Invitation screens are deliberately not recorded.
    }
  }
  const safeState = async (client) => {
    if (!client) return { available: false };
    try {
      return await terminalState(client);
    } catch {
      return { available: false };
    }
  };
  results.failureState = {
    windows: await safeState(win),
    android: await safeState(android),
  };
  process.exitCode = 1;
  console.error(results.failure);
} finally {
  for (const cli of clis) if (!cli.closed) cli.stop();
  for (const [name, cleanup] of [
    ["host", () => host?.stop()],
    ["android", () => android?.stop()],
    ["windows", () => win?.stop()],
    ["windowsTask", () => needWindows && stopWindowsClientTask(state)],
    [
      "windowsProcesses",
      () =>
        (needWindows || hosts.includes("windows")) &&
        stopOwnedWindowsProcesses(state.windowsRoot),
    ],
    ["runtime", () => cleanupWindowsRuntime(runtime)],
    ["folders", () => cleanupFolders(state)],
  ]) {
    try {
      await cleanup();
      results.cleanup[name] = "recovered";
    } catch {
      results.cleanup[name] = "failed";
      process.exitCode = 1;
    }
  }
  results.finishedAt = new Date().toISOString();
  await saveResults();
  console.log("evidence: " + runRoot);
}
