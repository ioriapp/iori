import { local as verificationLocal } from "../native/local.mjs";
import { powerShellHistoryBaseline } from "./history.mjs";
import { cliStatusScenario } from "../../e2e/cli-screen/status.mjs";
import assert from "node:assert/strict";
import { lockEntry } from "../native/locks.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evidence, command, writeWindows } from "../connection/build.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import {
  startWindowsClient,
  stopWindowsClientTask,
} from "../connection/client.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import {
  cleanupFolders,
  stopOwnedWindowsProcesses,
} from "../connection/cleanup.mjs";
import {
  gate,
  windows,
  ps,
  windowsBuildNode,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
  waitUntil,
} from "../native/remote.mjs";
import { register } from "../../e2e/connection/scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import { create, observe } from "../../e2e/terminal/scenario.mjs";
import { cliScenario } from "../../e2e/cli-screen/scenario.mjs";
import { cliResumeScenario } from "../../e2e/cli-screen/resume.mjs";
import { claudeStatusScenario } from "../../e2e/cli-screen/claude-status.mjs";
import { readClaudeToken } from "./claude-token.mjs";
import {
  windowsClaudeDirectory,
  windowsClaudeInstall,
} from "./windows-claude-install.mjs";

await lockEntry(import.meta.url);
// Keep Windows verification machine locked through startup, UI operations and all cleanup.
const state = JSON.parse(
  await readFile(join(evidence, "build-state.json"), "utf8"),
);
const runRoot = join(evidence, `run-${Date.now()}`);
await mkdir(runRoot, { recursive: true });
const result = { passed: false, steps: [], cleanup: {} };
const shell = process.argv.includes("--shell=cmd") ? "cmd" : "powershell";
result.shell = shell;
const shellOnly = process.argv.includes("--shell-only");
const resumeOnly = process.argv.includes("--resume-only");
const claudeStatus = process.argv.includes("--claude-status");
const keepBuild = process.argv.includes("--keep-build");
result.shellOnly = shellOnly;
let storage, runtime, client, host, invite, cliHome, rules, hooksBefore;
const realCliHome = process.argv.includes("--real-cli-home");
const recordsSince = Date.now();
let hooksInstalled = false;
try {
  gate();
  if (claudeStatus) {
    const token = await readClaudeToken();
    cliHome = state.windowsRoot + "\\cli-home";
    const directory = windowsClaudeDirectory(state.windowsRoot);
    windows(
      `[IO.Directory]::CreateDirectory(${ps(cliHome + "\\.claude")}) | Out-Null;${windowsClaudeInstall(state.windowsRoot)}`,
    );
    result.cli = {
      version: windows(`& ${ps(directory + "\\claude.exe")} --version`),
    };
    await writeWindows(
      cliHome + "\\.claude\\settings.json",
      JSON.stringify({
        model: "claude-haiku-4-5",
        permissions: {
          ask: ["Bash"],
          deny: ["mcp__*"],
          defaultMode: "default",
        },
      }),
    );
    await writeWindows(
      cliHome + "\\.claude\\.claude.json",
      JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }),
    );
    await writeWindows(
      state.windowsRoot + "\\sample.txt",
      "Verification sample.\n",
    );
    storage = prepareWindowsClientStorage(state);
    runtime = prepareWindowsRuntime();
    client = await startWindowsClient(state);
    host = await startHost("windows", state.windowsRoot, "cli-data", {
      windowsPathEntries: [
        directory,
        windowsBuildNode.slice(0, windowsBuildNode.lastIndexOf("\\")),
      ],
      windowsCliHome: cliHome,
      windowsClaudeToken: token,
    });
    invite = await inviteCli("windows", state.windowsRoot, host.dataHome);
    await register(client.screen, invite.invitation, "CLI検証 Windows");
    await invite.registered("CLI検証 Windows");
    await client.screen.click('[data-iori-action="settings-close"]');
    await openFolder(
      client.screen,
      state.windowsRoot,
      false,
      verificationLocal.windows.host,
    );
    await observe(client);
    await claudeStatusScenario({
      client,
      windows: true,
      record: async (step) => {
        result.steps.push(step);
        console.log(step);
        await writeFile(
          join(runRoot, `step-${result.steps.length}.png`),
          Buffer.from(await client.browser.screenshot(), "base64"),
        );
      },
      preventHookInstall: async () => {
        const directory = cliHome + "\\.iori\\hooks";
        const backup = cliHome + "\\.iori\\hooks-verification-backup";
        windows(
          `[IO.Directory]::CreateDirectory(${ps(directory)}) | Out-Null;Move-Item -LiteralPath ${ps(directory)} -Destination ${ps(backup)};[IO.File]::WriteAllText(${ps(directory)},'verification filesystem conflict')`,
        );
        return async () =>
          windows(
            `Remove-Item -LiteralPath ${ps(directory)} -Force;Move-Item -LiteralPath ${ps(backup)} -Destination ${ps(directory)}`,
          );
      },
    });
    result.passed = true;
  } else {
    // Require an actual npm .cmd shim; no simulation or alias of an .exe.
    const runtimeDirectory = windowsBuildNode.slice(
      0,
      windowsBuildNode.lastIndexOf("\\"),
    );
    let probe = JSON.parse(
      windows(
        `$env:PATH=${ps(runtimeDirectory + ";")}+$env:PATH;$c=Get-Command codex.cmd -ErrorAction Stop;$v=& $c.Source --version;if($LASTEXITCODE -ne 0){throw 'Codex version probe failed'};ConvertTo-Json -InputObject @{path=$c.Source;version=[string]$v;node=(Get-Command node.exe -ErrorAction Stop).Source} -Compress`,
      ),
    );
    const pathEntries = [runtimeDirectory];
    result.cli = probe;
    cliHome = realCliHome
      ? windows("$env:USERPROFILE")
      : state.windowsRoot + "\\cli-home";
    if (!realCliHome) {
      windows(
        `[IO.Directory]::CreateDirectory(${ps(cliHome + "\\.codex")}) | Out-Null;New-Item -ItemType HardLink -Path ${ps(cliHome + "\\.codex\\auth.json")} -Target '${verificationLocal.windows.home}\\.codex\\auth.json' -ErrorAction Stop | Out-Null`,
      );
      await writeWindows(
        cliHome + "\\.codex\\config.toml",
        'check_for_update_on_startup = false\ncli_auth_credentials_store = "file"\nmodel = "gpt-6-luna"\nmodel_reasoning_effort = "low"\napproval_policy = "on-request"\nsandbox_mode = "read-only"\napprovals_reviewer = "user"\n[projects.' +
          JSON.stringify(state.windowsRoot) +
          ']\ntrust_level = "trusted"\n',
      );
    } else {
      // Arguments belong only to this verification's shim; user settings stay intact.
      const directory = state.windowsRoot + "\\cli-test-bin";
      windows(`[IO.Directory]::CreateDirectory(${ps(directory)}) | Out-Null`);
      await writeWindows(
        directory + "\\codex.cmd",
        `@echo off
if "%1"=="app-server" goto plain
if "%1"=="--version" goto plain
if "%1"=="login" goto plain
"${windowsBuildNode}" "${probe.path.slice(0, probe.path.lastIndexOf("\\"))}\\node_modules\\@openai\\codex\\bin\\codex.js" -m gpt-6-luna -c model_reasoning_effort=low -c approval_policy=on-request -c approvals_reviewer=user -c sandbox_mode=read-only %*
exit /b %errorlevel%
:plain
"${windowsBuildNode}" "${probe.path.slice(0, probe.path.lastIndexOf("\\"))}\\node_modules\\@openai\\codex\\bin\\codex.js" %*
exit /b %errorlevel%
`,
      );
      pathEntries.unshift(directory);
      probe.path = directory + "\\codex.cmd";
    }
    windows(
      `[IO.Directory]::CreateDirectory(${ps(cliHome + "\\.codex\\rules")}) | Out-Null`,
    );
    rules =
      cliHome + "\\.codex\\rules\\iori-verification-" + state.id + ".rules";
    await writeWindows(
      rules,
      'prefix_rule(pattern=["node"], decision="prompt")\n',
    );
    hooksBefore =
      state.windowsRoot + `\\before-codex-hooks-${recordsSince}.json`;
    windows(
      `$p=${ps(cliHome + "\\.codex\\hooks.json")};if(Test-Path -LiteralPath $p){[IO.File]::Copy($p,${ps(hooksBefore)},$false)}else{[IO.File]::WriteAllText(${ps(hooksBefore)},'{}')}`,
    );
    await writeWindows(
      state.windowsRoot + "\\verification\\cli\\records.mjs",
      await readFile(new URL("./records.mjs", import.meta.url), "utf8"),
    );
    windows(
      `$env:CODEX_HOME=${ps(cliHome + "\\.codex")};$env:PATH=${ps(pathEntries.join(";") + ";")}+$env:PATH;& ${ps(probe.path)} login status;if($LASTEXITCODE -ne 0){throw 'Codex authentication is unavailable'}`,
    );
    hooksInstalled = true;
    storage = prepareWindowsClientStorage(state);
    runtime = prepareWindowsRuntime();
    client = await startWindowsClient(state);
    for (const name of ["click", "wait", "input"]) {
      const operation = client.screen[name].bind(client.screen);
      client.screen[name] = async (selector, ...args) => {
        result.step = selector;
        return operation(selector, ...args);
      };
    }
    host = await startHost("windows", state.windowsRoot, "cli-data", {
      windowsPathEntries: pathEntries,
      windowsCliHome: cliHome,
    });
    invite = await inviteCli("windows", state.windowsRoot, host.dataHome);
    await register(client.screen, invite.invitation, "CLI検証 Windows");
    await invite.registered("CLI検証 Windows");
    await client.screen.click('[data-iori-action="open-connection"]');
    await client.screen.click('[data-iori-action="default-shell-select"]');
    await client.screen.click(`[data-iori-shell-id="${shell}"]`);
    await client.screen.click('[data-iori-action="settings-close"]');
    await openFolder(
      client.screen,
      state.windowsRoot,
      false,
      verificationLocal.windows.host,
    );
    await observe(client);
    await create(client);
    await client.screen.wait(
      '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
    );
    const history =
      shell === "powershell"
        ? await powerShellHistoryBaseline(client)
        : undefined;
    if (history) result.historyBaseline = history;
    let cliId = "codex";
    // Let detection finish through the real settings screen before the status
    // scenario: --no-daemon is selected from the detected installed version.
    await client.screen.click('[data-iori-action="workspace-add-tab"]');
    await client.screen.click('[data-iori-action="add-cli"]');
    await client.screen.wait('[data-iori-cli-version="codex"]');
    await client.screen.click('[data-iori-action="settings-close"]');
    if (shell === "cmd" && !resumeOnly) {
      await client.screen.click('[data-iori-action="workspace-add-tab"]');
      await client.screen.wait('[data-iori-cli-id="codex"]');
      await client.screen.click('[data-iori-action="add-cli"]');
      await client.screen.wait('[data-iori-cli-version="codex"]');
      await client.screen.click('[data-iori-action="cli-add-open"]');
      await client.screen.input('[data-iori-field="cli-name"]', "Cmd Codex");
      await client.screen.input(
        '[data-iori-field="cli-command"]',
        `"${probe.path}"`,
      );
      await client.screen.click('[data-iori-action="cli-add-submit"]');
      result.step = "登録したCLIが一覧に現れる";
      cliId = await waitUntil(
        () =>
          client.screen.evaluate(
            "[...document.querySelectorAll('[data-iori-cli-row]')].find(e=>e.textContent.includes('Cmd Codex'))?.getAttribute('data-iori-cli-row')??''",
          ),
        Boolean,
      );
      await client.screen.click('[data-iori-action="settings-close"]');
      result.steps.push(
        "cmdの既定shellでCodexを検出し、引用した.cmdの起動コマンドを登録",
      );
    }
    await cliScenario({
      client,
      cliId: resumeOnly ? "codex" : cliId,
      shell,
      settings: false,
      resize: true,
      record: async (step) => {
        result.steps.push(step);
        console.log(step);
      },
      shot: async (name) => {
        await writeFile(
          join(runRoot, `${name}.png`),
          Buffer.from(await client.browser.screenshot(), "base64"),
        );
      },
    });
    if (!shellOnly && !resumeOnly)
      await cliStatusScenario({
        client,
        windows: true,
        record: async (step) => {
          result.steps.push(step);
          console.log(step);
        },
        shot: async (name) =>
          writeFile(
            join(runRoot, `${name}.png`),
            Buffer.from(await client.browser.screenshot(), "base64"),
          ),
      });
    if (history) {
      // PSReadLine can flush after the command's screen output. Observe its
      // positive control before judging the absence of our startup wrapper.
      const historyResult = await waitUntil(
        () =>
          JSON.parse(
            windows(
              String.raw`$p=${ps(history.path)};$s=[IO.File]::Open($p,'Open','Read','ReadWrite');try{$s.Position=${Number(history.size)};$r=[IO.StreamReader]::new($s);$added=$r.ReadToEnd();ConvertTo-Json -InputObject @{clean=($added -notmatch '777|133;D;|try \{.*finally|\[Console\]::Write');continuation=($added -match 'から戻ったshell')} -Compress}finally{$s.Dispose()}`,
            ),
          ),
        (value) => value.continuation,
      );
      assert.equal(
        historyResult.continuation,
        true,
        "今回shellで実行した行がPSReadLineの履歴にあること",
      );
      assert.equal(
        historyResult.clean,
        true,
        "PSReadLineの履歴にioriの起動用の行が無いこと",
      );
      result.history = {
        ...historyResult,
        baselineBytes: Number(history.size),
      };
      result.steps.push("PSReadLineの履歴に包んだ起動行が入らない");
    }
    if (!shellOnly) {
      await writeWindows(
        state.windowsRoot + "\\verification\\cli\\resume-records.mjs",
        await readFile(
          new URL("./resume-records.mjs", import.meta.url),
          "utf8",
        ),
      );
      await cliResumeScenario({
        client,
        shell,
        restartHostLosingTerminals: async () => {
          await host.stop();
          host = await startHost("windows", state.windowsRoot, "cli-data", {
            windowsPathEntries: pathEntries,
            windowsCliHome: cliHome,
          });
        },
        records: async () =>
          JSON.parse(
            windows(
              `Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} --input-type=module -e ${ps(`import {resumeRecords} from './verification/cli/resume-records.mjs';console.log(JSON.stringify(await resumeRecords(${JSON.stringify(cliHome.replaceAll("\\", "/") + "/.codex/sessions")},${recordsSince})));`)}`,
            ),
          ),
        record: async (step) => {
          result.steps.push(step);
          console.log(step);
        },
        shot: async (name) =>
          writeFile(
            join(runRoot, `${name}.png`),
            Buffer.from(await client.browser.screenshot(), "base64"),
          ),
      });
      result.resumeRecords = JSON.parse(
        windows(
          `Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} --input-type=module -e ${ps(`import {resumeRecords} from './verification/cli/resume-records.mjs';console.log(JSON.stringify(await resumeRecords(${JSON.stringify(cliHome.replaceAll("\\", "/") + "/.codex/sessions")},${recordsSince})));`)}`,
        ),
      );
    }
    const recordScript = `import {cliRecordSummary} from './verification/cli/records.mjs';console.log(JSON.stringify(await cliRecordSummary(${JSON.stringify(cliHome.replaceAll("\\", "/") + "/.codex")},undefined,{since:${recordsSince}})))`;
    result.cliRecords = JSON.parse(
      windows(
        `Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} --input-type=module -e ${ps(recordScript)};if($LASTEXITCODE -ne 0){throw 'CLI record summary failed'}`,
      ),
    );
    // Cost accounting only: not evidence of product acceptance.
    assert.deepEqual(
      result.cliRecords.codex.models,
      shellOnly ? [] : ["gpt-6-luna"],
    );
    result.passed = true;
  }
} catch (error) {
  result.error = String(error.message)
    .replace(/iori:\/\/\S+|[a-zA-Z0-9_-]{64,}/g, "[redacted]")
    .slice(0, 1024);
  process.exitCode = 1;
  if (client && (await client.screen.visible('[data-iori-view="workspace"]')))
    await writeFile(
      join(runRoot, "failure.png"),
      Buffer.from(await client.browser.screenshot(), "base64"),
    ).catch(() => {});
  if (claudeStatus && cliHome) {
    try {
      const projects = cliHome + "\\.claude\\projects";
      result.conversationFiles = JSON.parse(
        windows(
          `$p=${ps(projects)};$items=@(if(Test-Path -LiteralPath $p){Get-ChildItem -LiteralPath $p -Recurse -File | ForEach-Object {@{path=$_.FullName;bytes=$_.Length;modified=$_.LastWriteTimeUtc.ToString('o')}}});ConvertTo-Json -InputObject $items -Compress`,
        ),
      );
      if (result.conversationFiles.length)
        await command("scp", [
          "-r",
          "-o",
          "BatchMode=yes",
          `${verificationLocal.windows.host}:${projects.replaceAll("\\", "/")}`,
          runRoot,
        ]);
      if (
        windows(
          `Test-Path -LiteralPath ${ps(state.windowsRoot + "\\host.log")}`,
        ) === "True"
      )
        await command("scp", [
          "-o",
          "BatchMode=yes",
          `${verificationLocal.windows.host}:${(state.windowsRoot + "\\host.log").replaceAll("\\", "/")}`,
          join(runRoot, "host.log"),
        ]);
    } catch (evidenceError) {
      result.evidenceError = String(evidenceError.message).slice(0, 512);
    }
  }
} finally {
  invite?.stop();
  for (const [name, cleanup] of [
    ["host", () => host?.stop()],
    [
      "CLI hooks",
      async () => {
        if (!cliHome || claudeStatus) return;
        if (rules)
          windows(
            `Remove-Item -LiteralPath ${ps(rules)} -ErrorAction SilentlyContinue`,
          );
        if (!hooksInstalled) return;
        windows(
          `$env:USERPROFILE=${ps(cliHome)};$env:HOME=${ps(cliHome)};$env:CODEX_HOME=${ps(cliHome + "\\.codex")};$env:LOCALAPPDATA=${ps(host.dataHome)};Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} apps/host/src/cli/remove-hooks.ts;if($LASTEXITCODE -ne 0){throw 'hook removal failed'};if(Test-Path -LiteralPath ${ps(cliHome + "\\.codex\\hooks.json")}){$c=Get-Content -LiteralPath ${ps(cliHome + "\\.codex\\hooks.json")} -Raw | ConvertFrom-Json;if(($c | ConvertTo-Json -Depth 30) -match 'iori-cli-hook'){throw 'iori hooks remain'}}`,
        );
        windows(
          `Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} --input-type=module -e ${ps(`import assert from 'node:assert/strict';import {readConfig,removeOwned} from './apps/host/src/cli/hook-config.ts';const expected=await readConfig(${JSON.stringify(hooksBefore.replaceAll("\\", "/"))});for(const [event,entries] of Object.entries(expected.hooks??{})){if(!Array.isArray(entries))continue;const clean=removeOwned(entries);if(clean.length)expected.hooks[event]=clean;else delete expected.hooks[event];}if(expected.hooks&&!Object.keys(expected.hooks).length)delete expected.hooks;assert.deepEqual(await readConfig(${JSON.stringify((cliHome + "\\.codex\\hooks.json").replaceAll("\\", "/"))}),expected);`)};if($LASTEXITCODE -ne 0){throw 'User hook preservation failed'}`,
        );
        result.userHooksPreserved = true;
        result.realCliHome = realCliHome;
        result.hookRemoval = true;
      },
    ],
    ["client", () => client?.stop()],
    ["task", () => stopWindowsClientTask(state)],
    ["processes", () => stopOwnedWindowsProcesses(state.windowsRoot)],
    ["runtime", () => cleanupWindowsRuntime(runtime)],
    // A failed storage preparation has no ownership, so leave it alone.
    [
      "folders",
      () => {
        if (!storage) return;
        if (!keepBuild) return cleanupFolders(state);
        cleanupWindowsClientStorage(state);
        const paths = [
          "cli-home",
          "cli-data",
          "cli-tools",
          "sample.txt",
          "host.log",
        ]
          .map((name) => ps(state.windowsRoot + "\\" + name))
          .join(",");
        windows(
          `foreach($p in @(${paths})){if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Recurse -Force;if(Test-Path -LiteralPath $p){throw 'Verification run folder remains'}}}`,
        );
      },
    ],
  ]) {
    if (name === "folders" && !storage) {
      result.cleanup[name] = "preserved: client storage ownership not acquired";
      continue;
    }
    try {
      await cleanup();
      result.cleanup[name] = "recovered";
    } catch (error) {
      result.cleanup[name] = String(error.message).slice(0, 512);
      process.exitCode = 1;
    }
  }
  await writeFile(
    join(runRoot, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(`${result.passed ? "PASS" : "FAIL"}: ${runRoot}`);
}
