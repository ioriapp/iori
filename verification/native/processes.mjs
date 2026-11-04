import { windows, ps } from "./remote.mjs";
import { readFileSync } from "node:fs";

function stopTreeScript(predicate) {
  return `$all=@(Get-CimInstance Win32_Process);$owned=[Collections.Generic.List[object]]::new();foreach($p in $all){if(${predicate}){$owned.Add($p)}};for($i=0;$i -lt $owned.Count;$i++){foreach($c in $all){if($c.ParentProcessId -eq $owned[$i].ProcessId -and $c.CreationDate -ge $owned[$i].CreationDate -and -not($owned.ProcessId -contains $c.ProcessId)){$owned.Add($c)}}};$count=0;for($i=$owned.Count-1;$i -ge 0;$i--){$p=$owned[$i];$now=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.ProcessId);if($now -and $now.CreationDate -eq $p.CreationDate -and $now.CommandLine -eq $p.CommandLine){try{Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop;$count++}catch{if(Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue){throw}}}};$count`;
}

/** ShellExecute can launch Edge without our root in its command line. Its
 * exclusive profile files still prove which browser belongs to this run. */
export function stopOwnedWindowsBrowser(profile) {
  const source = readFileSync(
    new URL("./windows-file-users.ps1", import.meta.url),
    "utf8",
  );
  const paths = [
    "lockfile",
    "Default\\History",
    "Default\\Network\\Cookies",
  ].map((name) => profile + "\\" + name);
  return Number(
    windows(
      `$users=@(& {${source}} -Paths @(${paths.map(ps).join(",")}));$starts=@{};foreach($user in $users){$starts[[uint32]$user.Id]=$user.Started};${stopTreeScript("$starts.ContainsKey([uint32]$p.ProcessId) -and $p.Name -eq 'msedge.exe' -and ([Diagnostics.Process]::GetProcessById($p.ProcessId)).StartTime.ToUniversalTime().ToFileTimeUtc() -eq $starts[[uint32]$p.ProcessId]")}`,
    ),
  );
}

export function stopOwnedWindowsProcesses(root, onlyBuild = false) {
  const predicate = onlyBuild
    ? `$p.CommandLine -like ${ps("*" + root + "\\build.ps1*")}`
    : `$p.CommandLine -like ${ps("*" + root + "*")}`;
  return Number(windows(stopTreeScript(predicate)));
}

/** Start outside the SSH session so its exit does not kill the verification process. */
export function startWindowsProcess(command) {
  return Number(
    windows(
      `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=${ps(command)}};if($r.ReturnValue -ne 0){throw 'Verification process launch failed'};$r.ProcessId`,
    ),
  );
}

/** Run native Windows tools in the verification user's existing desktop. */
export function startWindowsInteractiveTask({ task, script, sessionId, user }) {
  windows(
    `if(Get-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue){throw 'Verification task already exists'};$action=New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument ${ps('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + script + '"')};$principal=New-ScheduledTaskPrincipal -UserId ${ps(user)} -LogonType Interactive -RunLevel Limited;$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;Register-ScheduledTask -TaskName ${ps(task)} -Action $action -Principal $principal -Settings $settings | Out-Null;$service=New-Object -ComObject 'Schedule.Service';$service.Connect();$null=$service.GetFolder('\\').GetTask(${ps(task)}).RunEx($null,4,[int]${sessionId},$null)`,
  );
}

export function stopWindowsInteractiveTask({ task, script }) {
  stopOwnedWindowsProcesses(script);
  const remaining = windows(
    `$t=Get-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue;if($t){if($t.Actions.Arguments -notlike ${ps("*" + script + "*")}){throw 'Scheduled Task ownership does not match'};Stop-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName ${ps(task)} -Confirm:$false};@(Get-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue).Count`,
  );
  if (remaining !== "0") throw new Error("検証Scheduled Taskが残っています");
}
