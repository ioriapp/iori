import assert from "node:assert/strict";
import { windows, ps } from "../native/remote.mjs";
import { writeWindows } from "../connection/build.mjs";
import { writeWindowsPrivateKey } from "../native/ssh.mjs";
import {
  startWindowsInteractiveTask,
  stopWindowsInteractiveTask,
  stopOwnedWindowsProcesses,
} from "../native/processes.mjs";
import { findWindowsInteractiveSession } from "../connection/client.mjs";
import { local } from "../native/local.mjs";
import { waitForOperation } from "../ui.mjs";

// Windows has no unattended desktop sign-in in this lab. Keep a secondary
// interactive logon in the existing verification desktop, then let the product
// start the Host with that user's own Interactive task. This is the explicitly
// permitted substitute for signing in through the Windows sign-in screen.
export async function interactiveWindowsUser({
  user,
  password,
  hostRoot,
  workRoot,
  installer,
}) {
  const hold = hostRoot + "\\interactive-logon.ps1";
  const ready = hostRoot + "\\interactive-logon.json";
  const script = workRoot + "\\interactive-user.ps1";
  const secret = workRoot + "\\interactive-user.secret";
  const task = "iori-ssh-interactive-" + user;
  const errorFile = workRoot + "\\interactive-user-error.txt";
  let registered = false;
  async function stop() {
    stopOwnedWindowsProcesses(hold);
    if (registered) stopWindowsInteractiveTask({ task, script });
    windows(
      `@(${[script, secret, errorFile, hold, ready].map(ps).join(",")}) | ForEach-Object {if(Test-Path -LiteralPath $_){Remove-Item -LiteralPath $_ -Force}}`,
    );
  }
  try {
    await writeWindowsPrivateKey(secret, password);
    await writeWindows(
      hold,
      `$ErrorActionPreference='Stop';try {$env:LOCALAPPDATA=${ps(hostRoot)};& {${installer}} -Bundle ${ps(hostRoot + "\\Programs\\iori-host")} -StartOnly -Ssh;[IO.File]::WriteAllText(${ps(ready)},(ConvertTo-Json -Compress @{user=[Security.Principal.WindowsIdentity]::GetCurrent().Name;session=[Diagnostics.Process]::GetCurrentProcess().SessionId}));$event=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,${ps(task)});$null=$event.WaitOne()} catch {[IO.File]::WriteAllText(${ps(ready)},(ConvertTo-Json -Compress @{error=$_.Exception.Message}))}`,
    );
    await writeWindows(
      script,
      `$ErrorActionPreference='Stop';try {$password=ConvertTo-SecureString ([IO.File]::ReadAllText(${ps(secret)})) -AsPlainText -Force;$credential=[Management.Automation.PSCredential]::new(${ps(user)},$password);Start-Process -FilePath (Get-Command pwsh.exe -CommandType Application).Source -ArgumentList ${ps('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + hold + '"')} -Credential $credential -LoadUserProfile -WindowStyle Hidden | Out-Null} catch {[IO.File]::WriteAllText(${ps(errorFile)},$_.Exception.Message)}`,
    );
    startWindowsInteractiveTask({
      task,
      script,
      sessionId: findWindowsInteractiveSession(),
      user: local.windows.host + "\\" + local.windows.user,
    });
    registered = true;
    await waitForOperation(
      "disposable user interactive logon",
      () => windows(`Test-Path -LiteralPath ${ps(ready)}`),
      (value) => value === "True",
      () =>
        windows(
          `if(Test-Path -LiteralPath ${ps(errorFile)}){[IO.File]::ReadAllText(${ps(errorFile)})}`,
        ),
    );
    const logon = JSON.parse(windows(`[IO.File]::ReadAllText(${ps(ready)})`));
    assert.ok(!logon.error, logon.error);
    assert.ok(logon.user.endsWith("\\" + user));
    assert.notEqual(logon.session, 0);
    windows(`Remove-Item -LiteralPath ${ps(secret)} -Force`);
    return { logon, stop };
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error.message}; cleanup: ${cleanupError.message}`,
      );
    }
    throw error;
  }
}
