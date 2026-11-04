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
  windows,
  windowsBuildNode,
  ps,
} from "../native/remote.mjs";
import { register } from "../../e2e/connection/scenario.mjs";
import { evaluateAsync, terminalState } from "../../e2e/terminal/scenario.mjs";
import { repeatedResize } from "../../e2e/terminal/resize-scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import { loadedWindowsConpty } from "./conpty.mjs";

import { lockEntry } from "../native/locks.mjs";
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const apk = process.argv[2];
if (!apk) throw new Error("検証専用APKを指定してください");
const hostOption = process.argv.indexOf("--host");
const selectedHost = hostOption < 0 ? undefined : process.argv[hostOption + 1];
if (hostOption >= 0 && selectedHost !== "linux" && selectedHost !== "windows")
  throw new Error("--host は linux または windows を指定してください");
const hosts = selectedHost ? [selectedHost] : ["windows", "linux"];
gate();
const runRoot = `.local/evidence/terminal/resize-${Date.now()}`;
await mkdir(runRoot, { recursive: true });
const results = { cycles: [], screenshots: [], cleanup: {} };
let runtime, win, android, host;
const clis = new Set();
const save = () =>
  writeFile(runRoot + "/results.json", JSON.stringify(results, null, 2));
const record = async (os, cycle, details) => {
  if (os === "windows" && cycle === 1) {
    results.windowsConptyLoaded = loadedWindowsConpty();
  }
  results.cycles.push({
    host: os,
    cycle,
    automaticResult: "passed",
    ...details,
  });
  await save();
  console.log(`${os}: resize cycle ${cycle} passed`);
};
const shot = async (client, name) => {
  assert.equal(
    await client.screen.visible('[data-iori-field="issued-invitation"]'),
    false,
  );
  assert.equal(
    Boolean(await client.screen.value('[data-iori-field="invitation"]')),
    false,
  );
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
  results.screenshots.push({
    file: name + ".png",
    result: "awaiting-visual-review",
  });
  await save();
};
try {
  results.windowsRelease = windows(
    `& ${ps(windowsBuildNode)} -p ${ps("require('node:os').release()")}`,
  );
  results.storage = prepareWindowsClientStorage(state);
  runtime = prepareWindowsRuntime();
  console.log("Windows検証Clientを起動");
  win = await startWindowsClient(state);
  console.log("Android検証Clientを準備");
  android = await startAndroidClient(apk, {
    install: !process.argv.includes("--reuse-android"),
  });
  for (const os of hosts) {
    console.log(`${os}: 専用Hostを起動`);
    const root = os === "windows" ? state.windowsRoot : state.linuxRoot;
    host = await startHost(os, root, "terminal-resize-data");
    for (const [client, name] of [
      [win, "Windows"],
      [android, "Android"],
    ]) {
      const cli = await inviteCli(os, root, host.dataHome);
      clis.add(cli);
      await register(
        client.screen,
        cli.invitation,
        `Terminal幅検証 ${name} ${os}`,
      );
      await cli.registered(`Terminal幅検証 ${name} ${os}`);
      // Registration returns to the devices settings; Terminals open from the
      // folder in the sidebar.
      await client.screen.click('[data-iori-action="settings-close"]');
      await openFolder(
        client.screen,
        root,
        client === android,
        os === "linux"
          ? verificationLocal.linux.host
          : verificationLocal.windows.host,
      );
    }
    await repeatedResize(
      os,
      [win, android],
      root,
      record,
      shot,
      (host, client, frames) =>
        writeFile(
          `${runRoot}/${host}-${client}-frames.json`,
          JSON.stringify(frames),
        ),
    );
    await host.stop();
    host = undefined;
  }
  results.automaticResult = "passed-awaiting-visual-review";
} catch (error) {
  results.failure = error.message;
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
  for (const [client, name] of [
    [win, "windows"],
    [android, "android"],
  ]) {
    try {
      results[name] = client
        ? await terminalState(client)
        : { available: false };
    } catch {
      results[name] = { available: false };
    }
  }
  process.exitCode = 1;
  console.error(results.failure);
} finally {
  for (const cli of clis) if (!cli.closed) cli.stop();
  for (const [name, cleanup] of [
    ["host", () => host?.stop()],
    ["android", () => android?.stop()],
    ["windows", () => win?.stop()],
    ["windowsTask", () => stopWindowsClientTask(state)],
    ["windowsProcesses", () => stopOwnedWindowsProcesses(state.windowsRoot)],
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
  await save();
  console.log("evidence: " + runRoot);
}
