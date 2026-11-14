import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alreadyLocked, withDeviceLocks } from "../native/locks.mjs";
import { gate, windows, ps } from "../native/remote.mjs";
import { writeWindows } from "../connection/build.mjs";
import {
  stopOwnedWindowsProcesses,
  startWindowsInteractiveTask,
  stopWindowsInteractiveTask,
} from "../native/processes.mjs";
import { findWindowsInteractiveSession } from "../connection/client.mjs";
import { waitFor, waitForOperation } from "../ui.mjs";

const previousInstaller = process.argv
  .find((argument) => argument.startsWith("--previous-installer="))
  ?.slice(21);
const targetInstaller = process.argv
  .find((argument) => argument.startsWith("--target-installer="))
  ?.slice(19);
if (!previousInstaller || !targetInstaller)
  throw new Error(
    "--previous-installer と --target-installer を両方指定してください",
  );

const plan = [{ device: verificationLocal.windows.host, shared: false }];
if (!alreadyLocked(plan)) {
  process.exit(
    await withDeviceLocks(plan, process.execPath, [
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ]),
  );
}

gate({ devices: [verificationLocal.windows.host], requireFreePorts: false });

const config = JSON.parse(
  await readFile(
    new URL("../../apps/client/src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const productName = config.productName;
const identifier = config.identifier;
const scheme = config.plugins["deep-link"].desktop.schemes[0];
const evidence = path.resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
    ".local/evidence/client-overwrite",
  `windows-${Date.now()}`,
);
await mkdir(evidence, { recursive: true });

const root = `${verificationLocal.windows.home}\\iori-development\\client-overwrite-${Date.now()}-${process.pid}`;
const installed = `${root}\\installed`;
const installedExe = `${installed}\\iori-client.exe`;
const sessionId = findWindowsInteractiveSession();
const user = `${verificationLocal.windows.host}\\${verificationLocal.windows.user}`;

function makeTask(label) {
  return {
    task: `iori-client-overwrite-${label}-${Date.now()}-${process.pid}`,
    script: `${root}\\launch-${label}.ps1`,
    user,
    sessionId,
  };
}

function readWindowsInstallationState({ includeStorageAndProcs = false } = {}) {
  return JSON.parse(
    windows(`
$links = @()
foreach ($folder in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'),[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'))) {
  $links += @(Get-ChildItem -LiteralPath $folder -Filter ${ps(productName + ".lnk")} -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
}
$uninstall = @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq ${ps(productName)} } | ForEach-Object { $_.PSPath })
$schemeExists = Test-Path -LiteralPath ${ps("Registry::HKEY_CLASSES_ROOT\\" + scheme)}
$result = @{ links = $links; uninstall = $uninstall; schemeExists = $schemeExists }
if (${includeStorageAndProcs ? "$true" : "$false"}) {
  $appData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) ${ps(identifier)}
  $localAppData = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ${ps(identifier)}
  $result.appDataExists = Test-Path -LiteralPath $appData
  $result.localAppDataExists = Test-Path -LiteralPath $localAppData
  $result.procs = @(Get-CimInstance Win32_Process -Filter "Name = 'iori-client.exe'" | ForEach-Object { $_.ExecutablePath })
}
$result | ConvertTo-Json -Compress
`),
  );
}

function readClientObservation(taskName) {
  return JSON.parse(
    windows(`
$all = @(Get-CimInstance Win32_Process)
$exe = ${ps(installedExe)}
$roots = @($all | Where-Object { $_.ExecutablePath -eq $exe })
$owned = [Collections.Generic.List[object]]::new()
foreach ($p in $roots) { $owned.Add($p) }
for ($i = 0; $i -lt $owned.Count; $i++) {
  foreach ($c in $all) {
    if ($c.ParentProcessId -eq $owned[$i].ProcessId -and $c.CreationDate -ge $owned[$i].CreationDate -and -not ($owned.ProcessId -contains $c.ProcessId)) {
      $owned.Add($c)
    }
  }
}
$webview2 = @($owned | Where-Object { $_.Name -ieq 'msedgewebview2.exe' })
$appData = Join-Path ([Environment]::GetFolderPath('ApplicationData')) ${ps(identifier)}
$keyFile = Join-Path $appData 'client-key.dpapi'
$dbFile = Join-Path $appData 'registrations.sqlite3'
$keyHash = $null
if (Test-Path -LiteralPath $keyFile -PathType Leaf) {
  $keyHash = (Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash
}
$taskState = (Get-ScheduledTask -TaskName ${ps(taskName)} -ErrorAction SilentlyContinue).State.ToString()
@{
  task = $taskState
  clientCount = $roots.Count
  clientPids = @($roots | ForEach-Object { $_.ProcessId })
  webview2Count = $webview2.Count
  keyHash = $keyHash
  dbExists = Test-Path -LiteralPath $dbFile -PathType Leaf
  productVersion = if (Test-Path -LiteralPath $exe -PathType Leaf) { (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion } else { $null }
} | ConvertTo-Json -Compress
`),
  );
}

async function launchAndObserve(label, observationName) {
  const task = makeTask(label);
  await writeWindows(
    task.script,
    `$ErrorActionPreference='Stop';$p=Start-Process -FilePath ${ps(installedExe)} -WorkingDirectory ${ps(installed)} -PassThru;$p.WaitForExit()`,
  );
  startWindowsInteractiveTask(task);
  let latest;
  try {
    const state = await waitForOperation(
      observationName,
      () => {
        latest = readClientObservation(task.task);
        return latest;
      },
      (state) =>
        state.clientCount > 0 &&
        state.webview2Count > 0 &&
        Boolean(state.keyHash) &&
        state.dbExists,
      () =>
        latest && latest.task !== "Running" && latest.clientCount === 0
          ? `起動した Client が終了しました (task=${latest.task})`
          : undefined,
    );
    return { task, state };
  } catch (error) {
    stopWindowsInteractiveTask(task);
    throw error;
  }
}

const result = {
  passed: false,
  previousInstaller: path.resolve(previousInstaller),
  targetInstaller: path.resolve(targetInstaller),
  steps: [],
  cleanupErrors: [],
};
let activeTask;
let installedOnce = false;
let cleanupAppData = false;
let cleanupLocalAppData = false;

try {
  const preflight = readWindowsInstallationState({
    includeStorageAndProcs: true,
  });
  if (
    preflight.links.length ||
    preflight.uninstall.length ||
    preflight.schemeExists ||
    preflight.appDataExists ||
    preflight.localAppDataExists ||
    preflight.procs.length
  ) {
    throw new Error(
      `検証機に既存の iori 環境が残っているため停止します: ${JSON.stringify(preflight)}`,
    );
  }
  cleanupAppData = true;
  cleanupLocalAppData = true;

  windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
  await writeWindows(
    `${root}\\previous.exe`,
    await readFile(previousInstaller),
  );
  await writeWindows(`${root}\\target.exe`, await readFile(targetInstaller));

  // 1. Silent install of previous release (/S).
  windows(
    `$p=Start-Process -FilePath ${ps(root + "\\previous.exe")} -ArgumentList ${ps("/S /D=" + installed)} -Wait -PassThru;if($p.ExitCode -ne 0){throw ('前のバージョンのインストールに失敗しました: exit ' + $p.ExitCode)};if(-not (Test-Path -LiteralPath ${ps(installedExe)} -PathType Leaf)){throw '前のバージョンの実行ファイルが見つかりません'}`,
  );
  installedOnce = true;
  result.steps.push("previous: silent NSIS install (/S)");

  // 2. Launch previous version so it creates Client storage files.
  const previousRun = await launchAndObserve(
    "previous",
    "前のバージョンの Windows Client 起動",
  );
  activeTask = previousRun.task;
  result.previous = previousRun.state;
  result.steps.push(
    "previous: started with WebView2 child process and saved client-key.dpapi + registrations.sqlite3",
  );

  stopWindowsInteractiveTask(activeTask);
  activeTask = undefined;
  stopOwnedWindowsProcesses(root);
  await waitFor(
    () =>
      Number(
        windows(
          `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${ps(installedExe)} }).Count`,
        ),
      ),
    (count) => count === 0,
    45000,
    "前のバージョンの Windows Client 停止",
  );

  // 3. Overwrite install with target installer (/S).
  windows(
    `$p=Start-Process -FilePath ${ps(root + "\\target.exe")} -ArgumentList ${ps("/S /D=" + installed)} -Wait -PassThru;if($p.ExitCode -ne 0){throw ('今回のバージョンの上書きインストールに失敗しました: exit ' + $p.ExitCode)};if(-not (Test-Path -LiteralPath ${ps(installedExe)} -PathType Leaf)){throw '今回のバージョンの実行ファイルが見つかりません'}`,
  );
  result.steps.push("target: overwrite silent NSIS install (/S)");

  // 4. Launch target version and verify process + WebView2 + preserved storage.
  const targetRun = await launchAndObserve(
    "target",
    "今回の Windows Client 起動",
  );
  activeTask = targetRun.task;
  result.target = targetRun.state;
  assert.equal(
    targetRun.state.keyHash,
    previousRun.state.keyHash,
    "上書きインストール後も client-key.dpapi が維持される必要があります",
  );
  assert.equal(targetRun.state.dbExists, true);
  assert.ok(targetRun.state.clientCount > 0);
  assert.ok(targetRun.state.webview2Count > 0);
  result.steps.push(
    "target: started with WebView2 child process and preserved client-key.dpapi + registrations.sqlite3",
  );
  result.passed = true;
} catch (error) {
  result.error = error.message;
  process.exitCode = 1;
} finally {
  if (activeTask) {
    try {
      stopWindowsInteractiveTask(activeTask);
    } catch (error) {
      result.cleanupErrors.push(error.message);
    }
  }
  try {
    stopOwnedWindowsProcesses(root);
    windows(
      `$exe=${ps(installedExe)};$all=@(Get-CimInstance Win32_Process);$owned=@($all | Where-Object { $_.ExecutablePath -eq $exe });for($i=0;$i -lt $owned.Count;$i++){foreach($c in $all){if($c.ParentProcessId -eq $owned[$i].ProcessId -and $c.CreationDate -ge $owned[$i].CreationDate -and -not ($owned.ProcessId -contains $c.ProcessId)){$owned+=$c}}};for($i=$owned.Count-1;$i -ge 0;$i--){Stop-Process -Id $owned[$i].ProcessId -Force -ErrorAction SilentlyContinue}`,
    );
  } catch (error) {
    result.cleanupErrors.push(error.message);
  }
  if (installedOnce) {
    try {
      windows(
        `if(Test-Path -LiteralPath ${ps(installed + "\\uninstall.exe")} -PathType Leaf){$p=Start-Process -FilePath ${ps(installed + "\\uninstall.exe")} -ArgumentList ${ps("/S _?=" + installed)} -Wait -PassThru;if($p.ExitCode -ne 0){throw ('アンインストールに失敗しました: exit ' + $p.ExitCode)}}`,
      );
      const remaining = readWindowsInstallationState();
      if (
        remaining.links.length ||
        remaining.uninstall.length ||
        remaining.schemeExists
      ) {
        result.cleanupErrors.push(
          `アンインストール後の残存があります: ${JSON.stringify(remaining)}`,
        );
      }
    } catch (error) {
      result.cleanupErrors.push(error.message);
    }
  }
  for (const [enabled, folder] of [
    [cleanupAppData, "ApplicationData"],
    [cleanupLocalAppData, "LocalApplicationData"],
  ]) {
    if (!enabled) continue;
    try {
      windows(
        `$p=Join-Path ([Environment]::GetFolderPath(${ps(folder)})) ${ps(identifier)};if(Test-Path -LiteralPath $p){cmd.exe /c ('rd /s /q "\\\\?\\'+$p+'"');if(Test-Path -LiteralPath $p){throw '検証用 Client 保存先が残っています'}}`,
      );
    } catch (error) {
      result.cleanupErrors.push(error.message);
    }
  }
  try {
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Windows 検証用フォルダーが残っています'}}`,
    );
  } catch (error) {
    result.cleanupErrors.push(error.message);
  }
  if (result.cleanupErrors.length) {
    result.passed = false;
    process.exitCode = 1;
  }
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify({ evidence, ...result }));
}
assert.equal(result.passed, true);
