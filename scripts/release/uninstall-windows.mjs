import { stopHostScript } from "./stop-windows.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { writeFile, rm } from "node:fs/promises";
const run = promisify(execFile);
const quote = (value) =>
  "'" + value.replace(/['‘’‚‛]/gu, (character) => character + character) + "'";
const encode = (script) => Buffer.from(script, "utf16le").toString("base64");
const ps = (script) =>
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encode(
        "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" +
          script,
      ),
    ],
    { windowsHide: true },
  );
export async function prepareUnregister(_unit, bundle) {
  const key = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const { stdout } =
    await ps(`$item=Get-ItemProperty -LiteralPath ${quote(key)} -Name 'iori Host' -ErrorAction SilentlyContinue
@{run=$item.'iori Host';entries=@([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -eq ${quote(bundle)} })} | ConvertTo-Json -Compress`);
  const previous = JSON.parse(stdout);
  return {
    remove: () =>
      ps(`if((Get-ItemProperty -LiteralPath ${quote(key)} -Name 'iori Host' -ErrorAction SilentlyContinue)) { Remove-ItemProperty -LiteralPath ${quote(key)} -Name 'iori Host' }
[Environment]::SetEnvironmentVariable('Path', (([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -ne ${quote(bundle)} }) -join ';'), 'User')`),
    restore: () =>
      ps(`${previous.run === null ? "" : `Set-ItemProperty -LiteralPath ${quote(key)} -Name 'iori Host' -Value ${quote(previous.run)}`}
${
  previous.entries.length
    ? `$path=[Environment]::GetEnvironmentVariable('Path','User')
foreach($entry in @(${previous.entries.map(quote).join(",")})) {
  if(($path -split ';') -notcontains $entry) {
    $path=if([string]::IsNullOrEmpty($path)){$entry}else{$path+';'+$entry}
  }
}
[Environment]::SetEnvironmentVariable('Path', $path, 'User')`
    : ""
}`),
  };
}
export async function launchRemoval(request) {
  const { bundle, storage, receipt, backups } = request;
  const serialized = Buffer.from(
    JSON.stringify({ hostKey: request.hostKey, status: request.status }),
  ).toString("base64");
  const paths = [
    bundle,
    join(storage, "terminal-daemon"),
    join(storage, "team-command-bin"),
  ];
  const workerPath = receipt + ".ps1";
  const worker = `$ErrorActionPreference='Stop'
$result=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${quote(serialized)})) | ConvertFrom-Json
$stage='stop'
$failedPaths=[Collections.Generic.List[string]]::new()
$processErrors=[Collections.Generic.List[string]]::new()
$firstRemovalError=$null
function Remove-Path($path) {
  $timer=[Diagnostics.Stopwatch]::StartNew();$backoff=0
  while(Test-Path -LiteralPath $path) {
    try { Remove-Item -LiteralPath $path -Recurse -Force;return }
    catch {
      $code=$_.Exception.HResult -band 65535
      if(($code -notin @(5,32,33) -and $_.CategoryInfo.Category -ne 'PermissionDenied') -or $timer.ElapsedMilliseconds -ge 60000){throw}
      Start-Sleep -Milliseconds $backoff
      $backoff=[Math]::Min($backoff+10,100)
    }
  }
}
function Record-RemovalFailure($path,$failure) {
  $failedPaths.Add($path)
  if(-not $script:firstRemovalError){$script:firstRemovalError=$failure}
}
function Remove-Paths($paths) {
  foreach($path in $paths) {
    try { Remove-Path $path } catch { Record-RemovalFailure $path $_ }
  }
}
function Complete-RemovalStage {
  if($failedPaths.Count) {
    $result.status | Add-Member -NotePropertyName failedPaths -NotePropertyValue @($failedPaths.ToArray()) -Force
    throw $script:firstRemovalError
  }
}
function Stop-ProgramProcesses {
  $roots=@(${[bundle, join(storage, "terminal-daemon")].map((path) => quote(path + "\\")).join(",")})
  $owned=@(Get-CimInstance Win32_Process | Where-Object {
    $exe=$_.ExecutablePath
    $exe -and @($roots | Where-Object { $exe.StartsWith($_,[StringComparison]::OrdinalIgnoreCase) }).Count
  })
  # The measured daemon exit took 1039ms after shutdown; allow the next whole second.
  $timer=[Diagnostics.Stopwatch]::StartNew()
  foreach($item in $owned) {
    $p=$null
    try {
      $p=[Diagnostics.Process]::GetProcessById($item.ProcessId);$null=$p.Handle
      if($p.HasExited){continue}
      # The handle and its executable protect against PID reuse after the CIM snapshot.
      $exe=$p.Path
      if(-not @($roots | Where-Object { $exe.StartsWith($_,[StringComparison]::OrdinalIgnoreCase) }).Count){continue}
      if(-not $p.WaitForExit([int][Math]::Max(0,2000-$timer.ElapsedMilliseconds))) {
        $p.Kill()
        if(-not $p.WaitForExit(2000)) {
          $processErrors.Add(($item.Name+' (PID '+$item.ProcessId+'): process did not exit after termination'))
        }
      }
    } catch {
      $failure=$_
      if(Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue) {
        $processErrors.Add(($item.Name+' (PID '+$item.ProcessId+'): '+$failure.FullyQualifiedErrorId))
      }
    } finally { if($p){$p.Dispose()} }
  }
}
try {
  ${stopHostScript(bundle)}
  $result.status.completed += 'stop'; $stage='program'
  try { Stop-ProgramProcesses } catch { $processErrors.Add(('Win32_Process: '+$_.FullyQualifiedErrorId)) }
  if($processErrors.Count) {
    $result.status | Add-Member -NotePropertyName processErrors -NotePropertyValue @($processErrors.ToArray()) -Force
  }
  Remove-Paths @(${paths.map(quote).join(",")})
  foreach($path in @(${backups.map(quote).join(",")})) {
    try {
      if(Test-Path -LiteralPath $path) {
        Remove-Paths @(Get-ChildItem -LiteralPath $path -Force | Where-Object { $_.Name -ne 'database' } | Select-Object -ExpandProperty FullName)
      }
    } catch { Record-RemovalFailure $path $_ }
  }
  Complete-RemovalStage
  $result.status.completed += 'program'
  ${request.status.deleteData ? `$stage='data'; Remove-Paths @(${[storage, ...backups].map(quote).join(",")}); Complete-RemovalStage; $result.status.completed += 'data'` : ""}
  $result.status.phase='succeeded'
} catch {
  $result.status.phase='failed'
  $result.status | Add-Member -NotePropertyName reason -NotePropertyValue 'uninstall' -Force
  $result.status | Add-Member -NotePropertyName stage -NotePropertyValue $stage -Force
  $result.status | Add-Member -NotePropertyName osError -NotePropertyValue $_.FullyQualifiedErrorId -Force
}
if($result.status.phase -eq 'failed' -and $stage -eq 'stop') {
  [IO.File]::WriteAllText(${quote(request.statusFile + ".tmp")}, ($result.status | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath ${quote(request.statusFile + ".tmp")} -Destination ${quote(request.statusFile)} -Force
}
[IO.File]::WriteAllText(${quote(receipt + ".tmp")}, ($result | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath ${quote(receipt + ".tmp")} -Destination ${quote(receipt)} -Force
Remove-Item -LiteralPath ${quote(workerPath)} -Force`;
  // Keep the worker outside the bundle. A file avoids Windows' command-line
  // limit, including the expansion caused by nested UTF-16 base64 commands.
  await writeFile(workerPath, "\ufeff" + worker, { mode: 0o600 });
  try {
    await ps(
      `Start-Process -FilePath powershell.exe -WorkingDirectory ${quote(dirname(receipt))} -ArgumentList ${quote("-NoProfile -NonInteractive -EncodedCommand " + encode(`& ([scriptblock]::Create([IO.File]::ReadAllText(${quote(workerPath)})))`))} -WindowStyle Hidden | Out-Null`,
    );
  } catch (error) {
    await rm(workerPath, { force: true }).catch(() => {});
    throw error;
  }
}
