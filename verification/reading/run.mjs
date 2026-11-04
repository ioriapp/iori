import { local as verificationLocal } from "../native/local.mjs";
import { startWindowsProcess } from "../native/processes.mjs";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evidence, writeWindows } from "../connection/build.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import {
  gate,
  linux,
  windows,
  sh,
  ps,
  windowsNode,
  adb,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
} from "../native/remote.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  startWindowsClient,
  startAndroidClient,
  stopWindowsClientTask,
  androidPackage,
} from "../connection/client.mjs";
import {
  cleanupFolders,
  stopOwnedWindowsProcesses,
} from "../connection/cleanup.mjs";
import { register } from "../../e2e/connection/scenario.mjs";
import { verificationIdentifier } from "../config.mjs";
import { readingScenario } from "./scenario.mjs";
if (verificationIdentifier !== "io.github.ioriapp.iori.readingtest")
  throw new Error(
    "IORI_VERIFICATION_CONFIG=verification/reading/tauri.conf.json で実行してください",
  );
import { lockEntry, heldDevices } from "../native/locks.mjs";
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const apk = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const keepBuild = process.argv.includes("--keep-build");
const clientArgument = process.argv.indexOf("--client");
const selectedClient =
  clientArgument === -1 ? undefined : process.argv[clientArgument + 1];
if (clientArgument !== -1 && !["Windows", "Android"].includes(selectedClient))
  throw new Error("--client は Windows または Android");
const hostArgument = process.argv.indexOf("--host");
const selectedHost =
  hostArgument === -1 ? undefined : process.argv[hostArgument + 1];
if (hostArgument !== -1 && !["linux", "windows"].includes(selectedHost))
  throw new Error("--host は linux または windows");
const matrix = [
  ["linux", "Windows"],
  ["windows", "Android"],
]
  .filter(([, client]) => !selectedClient || client === selectedClient)
  .map(([host, client]) => [selectedHost ?? host, client]);
const runId = Date.now();
if (matrix.some(([, client]) => client === "Android") && !apk)
  throw new Error("検証専用APKが必要です");
gate();
const evidenceArgument = process.argv.indexOf("--evidence");
const evidenceRoot =
  evidenceArgument === -1
    ? ".local/evidence/reading"
    : process.argv[evidenceArgument + 1];
const runRoot = evidenceRoot + "/run-" + runId;
await mkdir(runRoot, { recursive: true });
// The source this run used, so its result can be matched to a commit.
const result = {
  source: {
    head: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    uncommitted:
      execFileSync("git", ["status", "--porcelain"]).toString().trim() !== "",
  },
  matrix: [],
  steps: [],
  cleanup: {},
};
let host, client, runtime, cli;
let currentPhase = "setup";
const save = () =>
  writeFile(runRoot + "/results.json", JSON.stringify(result, null, 2));
try {
  if (heldDevices().includes(verificationLocal.windows.host)) {
    result.clientStorage = prepareWindowsClientStorage(state);
    runtime = prepareWindowsRuntime();
  }
  for (const [hostOs, clientOs] of matrix) {
    currentPhase = `${clientOs}:setup`;
    const source = hostOs === "linux" ? state.linuxRoot : state.windowsRoot;
    const folder =
      source +
      (hostOs === "linux" ? "/reading-fixture-" : "\\reading-fixture-") +
      runId;
    const fixtureOutput =
      hostOs === "linux"
        ? linux(
            `sudo -u iori-dev -H bash -c ${sh(`cd ${sh(source)} && node verification/reading/fixtures.mjs ${sh(folder)}`)}`,
          )
        : windows(
            `Set-Location ${ps(source)};& ${ps(windowsNode)} verification/reading/fixtures.mjs ${ps(folder)};if($LASTEXITCODE -ne 0){throw 'Fixture failed'}`,
          );
    const fixture = JSON.parse(String(fixtureOutput).trim().split("\n").at(-1));
    host = await startHost(hostOs, source, "reading-data-" + runId);
    client =
      clientOs === "Windows"
        ? await startWindowsClient(state)
        : await startAndroidClient(apk);
    cli = await inviteCli(hostOs, source, host.dataHome);
    const deviceName = "Reading verification " + clientOs;
    currentPhase = `${clientOs}:registration`;
    await register(client.screen, cli.invitation, deviceName);
    await cli.registered(deviceName);
    if (await client.screen.visible('[data-iori-view="settings"]'))
      await client.screen.key("Escape");
    currentPhase = `${clientOs}:registered`;
    const join = (base, file) =>
      hostOs === "linux"
        ? base + "/" + file
        : base + "\\" + file.split("/").join("\\");
    // What an Agent does on the Host: write files, append to a log, run Git.
    const hostActions = {
      async write(file, contents, base = fixture.root) {
        if (hostOs === "linux")
          linux(
            `sudo -u iori-dev -H bash -c ${sh(`printf %s ${sh(contents)} > ${sh(join(base, file))}`)}`,
          );
        else await writeWindows(join(base, file), contents);
      },
      async append(file, count) {
        const target = join(fixture.root, file);
        if (hostOs === "linux")
          linux(
            `sudo -u iori-dev -H bash -c ${sh(`nohup bash -c ${sh(`for i in $(seq 1 ${count}); do echo appended $i >> ${sh(target)}; sleep 0.2; done`)} >/dev/null 2>&1 &`)}`,
          );
        else {
          // A process started from the SSH session ends with it; WMI starts one outside the session.
          const script = source + "\\reading-append-" + runId + ".ps1";
          await writeWindows(
            script,
            `1..${count} | ForEach-Object { Add-Content -LiteralPath ${ps(target)} -Value ('appended ' + $_); Start-Sleep -Milliseconds 200 }`,
          );
          const command = `pwsh -NoProfile -ExecutionPolicy Bypass -File "${script}"`;
          startWindowsProcess(command);
        }
      },
      async git(directory, args) {
        if (hostOs === "linux")
          linux(
            `sudo -u iori-dev -H git -C ${sh(directory)} ${args.map(sh).join(" ")}`,
          );
        else
          windows(
            `& git -C ${ps(directory)} ${args.map(ps).join(" ")};if($LASTEXITCODE -ne 0){throw 'git failed'}`,
          );
      },
    };
    const clipboard = () =>
      client.screen.evaluate(
        "window.__TAURI__.core.invoke('plugin:clipboard-manager|read_text').catch(error=>{const message=String(error);if(message.includes('Clipboard is empty')||message.includes('The clipboard contents were not available in the requested format or the clipboard is empty.'))return '';throw error})",
      );
    const capture = async () =>
      clientOs === "Windows"
        ? Buffer.from(await client.browser.screenshot(), "base64")
        : Buffer.from(adb(["exec-out", "screencap", "-p"], { encoding: null }));
    // The same screen in the light and the dark theme, as the display setting gives them.
    const theme = (dark) =>
      client.screen.evaluateAsync(
        `(async()=>{document.documentElement.classList.toggle('dark',${dark});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;})()`,
      );
    const shot = async (name) => {
      const prefix = runRoot + "/" + clientOs.toLowerCase() + "-" + name;
      const wasDark = await client.screen.evaluate(
        "document.documentElement.classList.contains('dark')",
      );
      try {
        for (const dark of [false, true]) {
          await theme(dark);
          // Buttons animate their colors; capture after the change has settled.
          await new Promise((resolve) => setTimeout(resolve, 500));
          await writeFile(
            prefix + (dark ? "-dark.png" : "-light.png"),
            await capture(),
          );
        }
      } finally {
        await theme(wasDark);
      }
    };
    const record = async (step, details = {}) => {
      result.steps.push({
        host: hostOs,
        client: clientOs,
        step,
        result: "passed",
        ...details,
      });
      await save();
      console.log(hostOs + "/" + clientOs + ": " + step);
    };
    const restart = async () => {
      await client.stop();
      client =
        clientOs === "Windows"
          ? await startWindowsClient(state)
          : await startAndroidClient(apk, { install: false });
      return client.screen;
    };
    currentPhase = `${clientOs}:reading`;
    await readingScenario({
      client: () => client,
      fixture,
      host: hostActions,
      clipboard,
      record,
      restart,
      shot,
      back: () => adb(["shell", "input", "keyevent", "4"]),
      mobile: clientOs === "Android",
      hostOs,
      watchOnly: process.argv.includes("--watch-only"),
      pathDragOnly: process.argv.includes("--path-drag-only"),
    });
    result.matrix.push({ host: hostOs, client: clientOs, result: "passed" });
    await client.stop();
    client = undefined;
    await host.stop();
    host = undefined;
    await save();
  }
} catch (error) {
  result.failure = error instanceof Error ? error.message : "scenario failed";
  result.failureStack = error instanceof Error ? error.stack : undefined;
  process.exitCode = 1;
  console.error(result.failure);
  if (client) {
    try {
      result.failureState = await client.screen.evaluate(
        `(()=>({phase:${JSON.stringify(currentPhase)},readyState:document.readyState,identifiers:Array.from(document.querySelectorAll('[data-iori-view],[data-iori-state]')).filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(node).visibility!=='hidden'}).map(node=>({view:node.getAttribute('data-iori-view'),state:node.getAttribute('data-iori-state')}))}))()`,
      );
    } catch {
      result.failureState = { phase: currentPhase, identifiers: [] };
    }
    try {
      await writeFile(
        runRoot + "/reading-viewport.json",
        JSON.stringify(
          await client.screen.evaluate(
            `Array.from(document.querySelectorAll('[data-iori-scroll]')).filter(node=>node.getBoundingClientRect().height>0).map(node=>({view:node.dataset.ioriScroll,base:node.dataset.ioriWindowStart,count:node.dataset.ioriRowCount,top:node.scrollTop,height:node.clientHeight,total:node.scrollHeight,rows:Array.from(node.querySelectorAll(':scope > div > .reading-virtual-row')).map(row=>({index:row.dataset.index,top:row.getBoundingClientRect().top,height:row.getBoundingClientRect().height}))}))`,
          ),
          null,
          2,
        ),
      );
      const diagnostic = await client.screen.evaluate(
        `Array.from(document.querySelectorAll('[data-iori-view="files"],[data-iori-view="git"]')).filter(node=>node.getBoundingClientRect().height>0).map(node=>({view:node.dataset.ioriView,text:node.innerText.slice(0,4096),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))`,
      );
      if (diagnostic.length) {
        await writeFile(
          runRoot + "/failure-view.json",
          JSON.stringify(diagnostic, null, 2),
        );
        const shot = client.task
          ? Buffer.from(await client.browser.screenshot(), "base64")
          : Buffer.from(
              adb(["exec-out", "screencap", "-p"], { encoding: null }),
            );
        await writeFile(runRoot + "/failure.png", shot);
      }
    } catch {
      /* Keep the original failure if diagnostic collection cannot run. */
    }
  }
} finally {
  if (cli && !cli.closed) cli.stop();
  if (client)
    try {
      await client.stop();
      result.cleanup.client = true;
    } catch {
      result.cleanup.client = false;
    }
  if (host)
    try {
      await host.stop();
      result.cleanup.host = true;
    } catch {
      result.cleanup.host = false;
    }
  try {
    if (heldDevices().includes(verificationLocal.windows.host)) {
      stopWindowsClientTask(state);
      stopOwnedWindowsProcesses(state.windowsRoot);
      cleanupWindowsRuntime(runtime);
    }
    if (keepBuild) {
      if (heldDevices().includes(verificationLocal.windows.host)) {
        cleanupWindowsClientStorage(state);
        windows(
          `foreach($leaf in @('client-data','client-local')){$path=Join-Path ${ps(state.windowsRoot)} $leaf;if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force}}`,
        );
      }
      if (
        heldDevices().includes("android") &&
        adb(["shell", "pm", "list", "packages", androidPackage]).includes(
          "package:" + androidPackage,
        )
      )
        adb(["uninstall", androidPackage]);
      result.cleanup.buildCopiesRetained = true;
    } else Object.assign(result.cleanup, cleanupFolders(state));
  } catch (error) {
    result.cleanup.failure =
      error instanceof Error ? error.message : "cleanup failed";
  }
  await save();
  console.log("evidence: " + runRoot);
}
