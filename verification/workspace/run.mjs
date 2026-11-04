import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  gate,
  windows,
  linux,
  adb,
  ps,
  sh,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
} from "../native/remote.mjs";
import { evidence } from "../connection/build.mjs";
import { prepareWindowsClientStorage } from "../connection/client-storage.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  startWindowsClient,
  startAndroidClient,
  androidPackage,
  stopWindowsClientTask,
} from "../connection/client.mjs";
import {
  stopOwnedWindowsProcesses,
  cleanupFolders,
} from "../connection/cleanup.mjs";
import { workspaceScenario } from "../../e2e/workspace/scenario.mjs";

import { lockEntry } from "../native/locks.mjs";
await lockEntry(import.meta.url);
const apk = process.argv[2];
if (!apk) throw new Error("検証専用Android APKを指定してください");
const clientFilter = process.argv
  .find((arg) => arg.startsWith("--client="))
  ?.slice(9);
if (clientFilter && clientFilter !== "Windows" && clientFilter !== "Android")
  throw new Error("--clientにはWindowsまたはAndroidを指定してください");
gate();
assert.equal(
  windows("@(Get-Process iori-client -ErrorAction SilentlyContinue).Count"),
  "0",
  "別のClient検証が使用中です",
);
if (clientFilter !== "Windows")
  assert.equal(
    adb(["shell", `pidof ${androidPackage} || true`]),
    "",
    "別のAndroid検証が使用中です",
  );
const updateAndroid = process.argv.includes("--update-android");
const reuseAndroid = updateAndroid || process.argv.includes("--reuse-android");
if (!reuseAndroid && clientFilter !== "Windows")
  assert.equal(
    adb(["shell", "pm", "list", "packages", androidPackage]).includes(
      "package:" + androidPackage,
    ),
    false,
    "別の作業のAndroid packageは置き換えません",
  );
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const runRoot = evidence + "/run-" + Date.now();
await mkdir(runRoot, { recursive: true });
const results = { matrix: [], steps: [], cleanup: {} };
let host, client, cli, runtime, captureFailure;
let androidRotation;
const save = () =>
  writeFile(runRoot + "/results.json", JSON.stringify(results, null, 2));

function hostCommand(os, command) {
  return os === "linux"
    ? linux(`sudo -u iori-dev -H bash -c ${sh(command)}`)
    : windows(command);
}

function prepareRepository(os, root) {
  if (os === "windows") root = root.replaceAll("\\\\", "\\");
  const sep = os === "linux" ? "/" : "\\";
  const runId = Date.now();
  const repository = root + sep + "workspace-fixture-" + runId;
  const worktree = root + sep + "other-worktree-" + runId;
  const addedWorktree = root + sep + "added-worktree-" + runId;
  if (os === "linux") {
    hostCommand(
      os,
      `mkdir ${sh(repository)} && git -C ${sh(repository)} init -q --initial-branch=main && git -C ${sh(repository)} -c user.name=iori-verification -c user.email=verification@example.invalid commit -q --allow-empty -m initial && git -C ${sh(repository)} worktree add -q -b feature ${sh(worktree)}`,
    );
  } else {
    hostCommand(
      os,
      `$ErrorActionPreference='Stop';[IO.Directory]::CreateDirectory(${ps(repository)}) | Out-Null;git -C ${ps(repository)} init -q --initial-branch=main;if($LASTEXITCODE -ne 0){throw 'git init failed'};git -C ${ps(repository)} -c user.name=iori-verification -c user.email=verification@example.invalid commit -q --allow-empty -m initial;if($LASTEXITCODE -ne 0){throw 'git commit failed'};git -C ${ps(repository)} worktree add -q -b feature ${ps(worktree)};if($LASTEXITCODE -ne 0){throw 'git worktree add failed'}`,
    );
  }
  return {
    repository,
    worktree,
    addedWorktree,
    add: () =>
      hostCommand(
        os,
        os === "linux"
          ? `git -C ${sh(repository)} worktree add -q -b added ${sh(addedWorktree)}`
          : `git -C ${ps(repository)} worktree add -q -b added ${ps(addedWorktree)};if($LASTEXITCODE -ne 0){throw 'git worktree add failed'}`,
      ),
    remove: () =>
      hostCommand(
        os,
        os === "linux"
          ? `git -C ${sh(repository)} worktree remove ${sh(addedWorktree)}`
          : `git -C ${ps(repository)} worktree remove ${ps(addedWorktree)};if($LASTEXITCODE -ne 0){throw 'git worktree remove failed'}`,
      ),
  };
}

try {
  prepareWindowsClientStorage(state);
  runtime = prepareWindowsRuntime();
  for (const [os, clientOs] of [
    ["linux", "Windows"],
    ["windows", "Android"],
  ]) {
    if (clientFilter && clientOs !== clientFilter) continue;
    const root = os === "linux" ? state.linuxRoot : state.windowsRoot;
    const fixture = prepareRepository(os, root);
    host = await startHost(os, root);
    client =
      clientOs === "Windows"
        ? await startWindowsClient(state)
        : await startAndroidClient(apk, {
            install: !reuseAndroid || updateAndroid,
          });
    cli = await inviteCli(os, host.root, host.dataHome);
    const record = async (step, details = {}) => {
      results.steps.push({
        host: os,
        client: clientOs,
        step,
        result: "passed",
        ...details,
      });
      await save();
      console.log(`${clientOs} × ${os}: ${step}`);
    };
    const shot = async (name) => {
      if (name === "maximized") {
        results.maximizedPanelObservation ??= {};
        results.maximizedPanelObservation[clientOs] =
          await client.screen.evaluate(
            `({viewport:{width:innerWidth,height:innerHeight,visualWidth:visualViewport.width,visualHeight:visualViewport.height,scale:visualViewport.scale},panels:[...document.querySelectorAll('[data-iori-workspace-panel]')].map(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),overlay=e.closest('.dv-render-overlay');return {id:e.getAttribute('data-iori-workspace-panel'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},pointerEvents:getComputedStyle(e).pointerEvents,overlayPointerEvents:overlay?getComputedStyle(overlay).pointerEvents:undefined,hit:hit?{tag:hit.tagName,className:hit.className,panelId:hit.closest('[data-iori-workspace-panel]')?.getAttribute('data-iori-workspace-panel')}:null}})})`,
          );
      }
      assert.equal(
        await client.screen.visible('[data-iori-field="issued-invitation"]'),
        false,
      );
      assert.equal(
        Boolean(await client.screen.value('[data-iori-field="invitation"]')),
        false,
      );
      const bytes =
        clientOs === "Windows"
          ? Buffer.from(await client.browser.screenshot(), "base64")
          : Buffer.from(
              adb(["exec-out", "screencap", "-p"], { encoding: null }),
            );
      await writeFile(
        `${runRoot}/${clientOs.toLowerCase()}-${name}.png`,
        bytes,
      );
    };
    const restart = async () => {
      await client.stop();
      client =
        clientOs === "Windows"
          ? await startWindowsClient(state)
          : await startAndroidClient(apk, { install: false });
      return client.screen;
    };
    captureFailure = () => shot("failure");
    const viewport = async (wide) => {
      if (clientOs !== "Android") return;
      androidRotation ??= Object.fromEntries(
        ["accelerometer_rotation", "user_rotation"].map((key) => [
          key,
          adb(["shell", "settings", "get", "system", key]),
        ]),
      );
      adb([
        "shell",
        "settings",
        "put",
        "system",
        "accelerometer_rotation",
        "0",
      ]);
      adb([
        "shell",
        "settings",
        "put",
        "system",
        "user_rotation",
        wide ? "1" : "0",
      ]);
    };
    await workspaceScenario({
      screen: client.screen,
      invitation: cli.invitation,
      registered: () => cli.registered(`iori frame ${clientOs}`),
      deviceName: `iori frame ${clientOs}`,
      fixture,
      mobile: clientOs === "Android",
      restart,
      record,
      shot,
      back: () => adb(["shell", "input", "keyevent", "4"]),
      viewport,
      client: () => client,
      hostOs: os,
    });
    results.matrix.push({ host: os, client: clientOs, result: "passed" });
    await client.stop();
    client = undefined;
    await host.stop();
    host = undefined;
    await save();
  }
} catch (error) {
  results.failure =
    error instanceof Error ? error.message : "workspace scenario failed";
  results.failureStack = error instanceof Error ? error.stack : undefined;
  if (client) {
    results.screenState = await client.screen
      .evaluate(
        `({width:innerWidth,height:innerHeight,sidebarButtons:[...document.querySelectorAll('[data-iori-action="sidebar-toggle"]')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,expanded:e.getAttribute('aria-expanded')}}),drawers:[...document.querySelectorAll('[data-sidebar]')].map(e=>({role:e.getAttribute('data-sidebar'),state:e.getAttribute('data-state')}))})`,
      )
      .catch(() => undefined);
  }
  try {
    await captureFailure?.();
  } catch {
    // Invitation screens are deliberately not recorded.
  }
  console.error(results.failure);
  process.exitCode = 1;
} finally {
  if (cli && !cli.closed) cli.stop();
  for (const [name, operation] of [
    ["clientStopped", () => client?.stop()],
    [
      "androidRotationRestored",
      () => {
        for (const [key, value] of Object.entries(androidRotation ?? {}))
          adb(
            value === "null"
              ? ["shell", "settings", "delete", "system", key]
              : ["shell", "settings", "put", "system", key, value],
          );
      },
    ],
    ["hostStopped", () => host?.stop()],
    ["windowsTaskRemoved", () => stopWindowsClientTask(state)],
    [
      "ownedWindowsProcessesStopped",
      () => stopOwnedWindowsProcesses(state.windowsRoot),
    ],
    ["runtimeRemoved", () => cleanupWindowsRuntime(runtime)],
    ["foldersRemoved", () => cleanupFolders(state)],
  ]) {
    try {
      await operation();
      results.cleanup[name] = true;
    } catch {
      results.cleanup[name] = false;
      process.exitCode = 1;
    }
  }
  await save();
  console.log("evidence: " + runRoot);
}
