import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowWindowsVerificationProgram,
  cleanupWindowsVerificationProgram,
} from "../native/windows-firewall.mjs";
import { lockEntry } from "../native/locks.mjs";
import { gate, windows, ps, windowsBuildNode } from "../native/remote.mjs";
import {
  command,
  writeWindows,
  windowsEnvironment,
} from "../connection/build.mjs";
import { createSourceArchive, windowsSourceMtimes } from "../native/source.mjs";
import { windowsCache } from "../native/cache.mjs";
import {
  stopOwnedWindowsProcesses,
  startWindowsInteractiveTask,
  stopWindowsInteractiveTask,
} from "../native/processes.mjs";
import { findWindowsInteractiveSession } from "../connection/client.mjs";
import { waitForOperation } from "../ui.mjs";
import { prepareTls } from "./distribution.mjs";
import { readClaudeToken } from "../cli/claude-token.mjs";
import {
  windowsClaudeDirectory,
  windowsClaudeInstall,
} from "../cli/windows-claude-install.mjs";

const previousZip = process.argv
  .find((arg) => arg.startsWith("--previous-zip="))
  ?.slice(15);
const targetZip = process.argv
  .find((arg) => arg.startsWith("--target-zip="))
  ?.slice(13);
const runningClis = process.argv.includes("--running-clis");
if (runningClis && !previousZip)
  throw new Error("--running-clis requires both release ZIPs");
if (Boolean(previousZip) !== Boolean(targetZip))
  throw new Error("--previous-zip and --target-zip must be supplied together");
await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.windows.host] });
const evidence = path.resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/host-update",
  `windows-${Date.now()}`,
);
await mkdir(evidence, { recursive: true });
await mkdir(".local", { recursive: true });
const temporary = await mkdtemp(path.resolve(".local/host-update-transfer-"));
const root = `${verificationLocal.windows.home}\\iori-development\\host-update-${Date.now()}-${process.pid}`;
const task = previousZip
  ? {
      task: `iori-host-update-${Date.now()}-${process.pid}`,
      script: root + "\\run.ps1",
      user:
        verificationLocal.windows.host + "\\" + verificationLocal.windows.user,
      sessionId: findWindowsInteractiveSession(),
    }
  : undefined;
let firewall, result;
try {
  const archive = path.join(temporary, "source.tar");
  await createSourceArchive(
    fileURLToPath(new URL("../../", import.meta.url)),
    archive,
  );
  await prepareTls(temporary, "Android");
  windows(
    `[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null;[IO.Directory]::CreateDirectory(${ps(root + "\\host-updates\\tls")}) | Out-Null`,
  );
  await writeWindows(root + "\\source.tar", await readFile(archive));
  for (const name of ["ca.pem", "key.pem", "cert.pem"])
    await writeWindows(
      root + "\\host-updates\\tls\\" + name,
      await readFile(path.join(temporary, "tls", name)),
    );
  if (runningClis) {
    const home = root + "\\cli-home";
    windows(
      `[IO.Directory]::CreateDirectory(${ps(home + "\\.codex")}) | Out-Null;[IO.Directory]::CreateDirectory(${ps(home + "\\.claude")}) | Out-Null;New-Item -ItemType HardLink -Path ${ps(home + "\\.codex\\auth.json")} -Target (Join-Path $env:USERPROFILE '.codex\\auth.json') | Out-Null`,
    );
    await writeWindows(
      home + "\\.codex\\config.toml",
      `model = "gpt-6-luna"\n[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`,
    );
    windows(windowsClaudeInstall(root));
    await writeWindows(
      home + "\\.claude\\settings.json",
      JSON.stringify({ model: "claude-haiku-4-5" }),
    );
    await writeWindows(
      home + "\\.claude\\.claude.json",
      JSON.stringify({
        hasCompletedOnboarding: true,
        theme: "dark",
      }),
    );
  }
  if (previousZip) {
    await writeWindows(root + "\\previous.zip", await readFile(previousZip));
    await writeWindows(root + "\\target.zip", await readFile(targetZip));
  }
  const buildScript = root + "\\build.ps1";
  const buildLog = root + "\\build.log";
  await writeWindows(
    buildScript,
    `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'extract failed'};Set-Location ${ps(root)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};$env:CARGO_BUILD_JOBS='2';pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};${previousZip ? `Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory(${ps(root + "\\previous.zip")}, ${ps(root + "\\native-input")});Copy-Item ${ps(root + "\\native-input\\node_modules\\@iori\\host-iroh-native\\iori_iroh_host_native.node")} ${ps(root + "\\apps\\host\\native\\iori_iroh_host_native.node")}` : "pnpm --filter @iori/host build:native;if($LASTEXITCODE -ne 0){throw 'native build failed'}"}`,
  );
  const buildCommand = `$ErrorActionPreference='Stop';$PSNativeCommandUseErrorActionPreference=$false;$ProgressPreference='SilentlyContinue';& pwsh -NoProfile -ExecutionPolicy Bypass -File ${ps(buildScript)} *> ${ps(buildLog)};exit $LASTEXITCODE`;
  try {
    await command("ssh", [
      "-o",
      "BatchMode=yes",
      verificationLocal.windows.host,
      "pwsh",
      "-NoProfile",
      "-EncodedCommand",
      Buffer.from(buildCommand, "utf16le").toString("base64"),
    ]);
  } finally {
    await writeFile(
      path.join(evidence, "build.log"),
      windows(
        `if(Test-Path -LiteralPath ${ps(buildLog)}){Get-Content -LiteralPath ${ps(buildLog)} -Raw}`,
      ),
    );
  }
  firewall = allowWindowsVerificationProgram(
    root + "\\host-updates\\bundle\\runtime\\node.exe",
    `iori-verification-host-update-${Date.now()}-${process.pid}`,
  );
  result = { passed: false };
  let failure;
  try {
    if (task) {
      await writeWindows(
        task.script,
        `$ErrorActionPreference='Stop';$env:PATH=${ps((runningClis ? windowsClaudeDirectory(root) + ";" : "") + path.win32.dirname(windowsBuildNode) + ";")}+$env:PATH;${runningClis ? `$env:USERPROFILE=${ps(root + "\\cli-home")};$env:HOME=$env:USERPROFILE;$env:CODEX_HOME=Join-Path $env:USERPROFILE '.codex';$env:CLAUDE_CONFIG_DIR=Join-Path $env:USERPROFILE '.claude';$pipe=[IO.Pipes.NamedPipeServerStream]::new(${ps(task.task)},[IO.Pipes.PipeDirection]::In);$pipe.WaitForConnection();$reader=[IO.StreamReader]::new($pipe);$env:CLAUDE_CODE_OAUTH_TOKEN=$reader.ReadLine();$reader.Dispose();$pipe.Dispose();` : ""}Set-Location ${ps(root)};& ${ps(windowsBuildNode)} verification/updates/host-windows-release.mjs ${ps(root)} 49172 ${runningClis ? "--running-clis" : ""} *> ${ps(root + "\\scenario.log")}`,
      );
      startWindowsInteractiveTask(task);
      if (runningClis) {
        windows(
          `$pipe=[IO.Pipes.NamedPipeClientStream]::new('.',${ps(task.task)},[IO.Pipes.PipeDirection]::Out);$pipe.Connect();$writer=[IO.StreamWriter]::new($pipe);$writer.WriteLine([Console]::In.ReadLine());$writer.Dispose();$pipe.Dispose()`,
          { input: (await readClaudeToken()) + "\n" },
        );
      }
      let lastStage, observed;
      await waitForOperation(
        "Windows Host更新の結果",
        () => {
          const state = JSON.parse(
            windows(
              `$progress=Join-Path ${ps(root)} 'host-update-progress.json';$stage=$null;if(Test-Path -LiteralPath $progress){$stage=(Get-Content -LiteralPath $progress -Raw | ConvertFrom-Json).waitingFor};$taskState=(Get-ScheduledTask -TaskName ${ps(task.task)}).State.ToString();@{done=(Test-Path -LiteralPath ${ps(root + "\\host-update-result.json")});stage=$stage;task=$taskState} | ConvertTo-Json -Compress`,
            ),
          );
          observed = state;
          if (state.stage !== lastStage) {
            lastStage = state.stage;
            console.log(JSON.stringify({ waitingFor: lastStage }));
          }
          return state;
        },
        (state) => state.done,
        () =>
          observed?.stage && observed.task !== "Running"
            ? "Windowsの更新確認が結果を残さず終了しました"
            : undefined,
      );
    } else
      windows(
        `${windowsEnvironment}Set-Location ${ps(root)};& ${ps(windowsBuildNode)} verification/updates/host-windows-scenario.mjs ${ps(root)} 49172;if($LASTEXITCODE -ne 0){throw 'Windows Host update verification failed'}`,
      );
  } catch (error) {
    failure = error.message;
  }
  result = JSON.parse(
    windows(
      `if(Test-Path -LiteralPath ${ps(root + "\\host-update-result.json")}){Get-Content -LiteralPath ${ps(root + "\\host-update-result.json")} -Raw}elseif(Test-Path -LiteralPath ${ps(root + "\\host-update-progress.json")}){$value=Get-Content -LiteralPath ${ps(root + "\\host-update-progress.json")} -Raw | ConvertFrom-Json;$value | Add-Member -NotePropertyName error -NotePropertyValue ${ps(failure ?? "No result")} -Force;$value | ConvertTo-Json -Depth 12}else{@{passed=$false;error=${ps(failure ?? "No result")}} | ConvertTo-Json}`,
    ),
  );
  if (previousZip) {
    result.runnerFailure = failure;
    result.installationAtCollection = JSON.parse(
      windows(
        `$base=[IO.Path]::GetFullPath(${ps(root)});$bundle=Join-Path $base 'host-updates\\bundle';$store=Join-Path $base 'data\\iori-host';$descriptor=Join-Path $store 'terminal-daemon\\connection.json';$daemon=$null;if(Test-Path -LiteralPath $descriptor){$daemon=Get-Content -LiteralPath $descriptor -Raw | ConvertFrom-Json | Select-Object pid,version};$version=$null;$versionFile=Join-Path $bundle 'release-version.json';if(Test-Path -LiteralPath $versionFile){$version=(Get-Content -LiteralPath $versionFile -Raw | ConvertFrom-Json).version};$folders=@(Get-ChildItem -LiteralPath (Split-Path $bundle) -Directory -Filter '.iori-host-update-*' | ForEach-Object {$work=$_.FullName;$requestFile=Join-Path $work 'request.json';$request=$null;$status=$null;if(Test-Path -LiteralPath $requestFile){$request=Get-Content -LiteralPath $requestFile -Raw | ConvertFrom-Json;if(Test-Path -LiteralPath $request.statusFile){$status=Get-Content -LiteralPath $request.statusFile -Raw | ConvertFrom-Json}};@{path=$work;request=$request;status=$status;staged=(Test-Path -LiteralPath (Join-Path $work 'host'));previous=(Test-Path -LiteralPath (Join-Path $work 'previous'));database=(Test-Path -LiteralPath (Join-Path $work 'database'))}});@{bundleVersion=$version;daemon=$daemon;updateFolders=$folders} | ConvertTo-Json -Depth 12 -Compress`,
      ),
    );

    result.processesAtCollection = JSON.parse(
      windows(
        `$base=[IO.Path]::GetFullPath(${ps(root)});@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -like ($base+'*')} | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath,SessionId,CreationDate) | ConvertTo-Json -Depth 4 -Compress`,
      ) || "[]",
    );
    if (failure || !result.passed) {
      result.maintenanceAtCollection = JSON.parse(
        windows(
          `$dir=Join-Path ${ps(root)} 'data\\iori-host\\maintenance';if(Test-Path -LiteralPath $dir){@(Get-ChildItem -LiteralPath $dir -File | Where-Object Extension -in '.json','.txt' | ForEach-Object {@{name=$_.Name;content=Get-Content -LiteralPath $_.FullName -Raw}}) | ConvertTo-Json -Depth 12 -Compress}else{'[]'}`,
        ) || "[]",
      );
    }
    result.hostStderrAtCollection = windows(
      `$file=Join-Path ${ps(root)} 'host-stderr.log';if(Test-Path -LiteralPath $file){Get-Content -LiteralPath $file -Raw}`,
    );
  }
} finally {
  try {
    if (task) stopWindowsInteractiveTask(task);
    stopOwnedWindowsProcesses(root);
  } finally {
    if (firewall) {
      try {
        firewall.cleanup = cleanupWindowsVerificationProgram(firewall);
      } catch (error) {
        firewall.cleanup = { error: error.message };
      }
    }
    if (result) {
      result.firewall = firewall;
      await writeFile(
        path.join(evidence, "result.json"),
        JSON.stringify(result, null, 2),
      );
      console.log(JSON.stringify({ evidence, ...result }));
    }
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Windows verification folder remains'}}`,
    );
    await rm(temporary, { recursive: true, force: true });
  }
}

assert.equal(result?.passed, true);
if (firewall?.created) assert.equal(firewall.cleanup?.remaining, 0);
