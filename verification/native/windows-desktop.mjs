import { local as verificationLocal } from "./local.mjs";
import { lockEntry } from "./locks.mjs";
import { readFile } from "node:fs/promises";
import { command, writeWindows } from "../connection/build.mjs";
import { windows as remoteWindows, ps, gate } from "./remote.mjs";
import { findWindowsInteractiveSession } from "../connection/client.mjs";
import { waitFor } from "../ui.mjs";
import { verificationIdentifier, verificationConfig } from "../config.mjs";

const windows = (script) =>
  remoteWindows(
    `try { ${script} } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
  );

// Tao's undecorated shadow keeps the side/bottom frame outside the client,
// but WM_NCHITTEST handles its top resize strip inside the client (y >= 0).
export function windowsResizePoint({ width, height }, edge) {
  return {
    left: { x: -3, y: height / 2 },
    right: { x: width + 3, y: height / 2 },
    bottom: { x: width / 2, y: height + 3 },
    "top-right": { x: width + 3, y: 1 },
    top: { x: width / 2, y: 1 },
  }[edge];
}

// Resolve the button before consent. The Windows task owns the click, waits for
// consent to close and records native state before any browser call resumes.
export async function windowsConsentOperation(
  state,
  client,
  selector,
  program,
) {
  await client.screen.reveal(selector);
  const pointer = await client.screen.evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
  );
  return windowsDesktop(state, "window-consent-click", { pointer, program });
}

/** Execute OS UI automation in the same existing desktop session as the
 * verification Client. A task, scripts and pictures belong to this run only. */
export async function windowsDesktop(
  state,
  operation,
  { screenshot, trigger, activationUrl, pointer, program } = {},
) {
  const sessionId = findWindowsInteractiveSession();
  const task = `iori-desktop-${state.id}`;
  const script = state.windowsRoot + "\\desktop-ui.ps1";
  const output = state.windowsRoot + "\\desktop-ui.json";
  const png = state.windowsRoot + "\\desktop-ui.png";
  const ready = state.windowsRoot + "\\desktop-ui-ready";
  const source = await readFile(
    new URL("./windows-desktop.ps1", import.meta.url),
    "utf8",
  );
  await writeWindows(
    script,
    `\uFEFF$operation=${ps(operation)};$outputFile=${ps(output)};$imageFile=${ps(png)};$readyFile=${ps(ready)};$clientPath=${ps(state.windowsExecutable ?? state.windowsRoot + "\\target\\debug\\iori-client.exe")};$activationUrl=${ps(activationUrl ?? "")};$applicationId=${ps(verificationIdentifier)};$productName=${ps(verificationConfig.productName)};$pointerJson=${ps(JSON.stringify(pointer ?? null))};$programPath=${ps(program ?? "")};$windowHandle=${ps(String(state.windowHandle ?? ""))};\n` +
      source,
  );
  try {
    windows(
      `try { Remove-Item -LiteralPath ${ps(output)},${ps(png)},${ps(ready)} -Force -ErrorAction SilentlyContinue;$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${ps('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + script + '"')};$p=New-ScheduledTaskPrincipal -UserId '${verificationLocal.windows.host + "\\" + verificationLocal.windows.user}' -LogonType Interactive -RunLevel Limited;$s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;Register-ScheduledTask -TaskName ${ps(task)} -Action $a -Principal $p -Settings $s | Out-Null;$service=New-Object -ComObject Schedule.Service;$service.Connect();$null=$service.GetFolder('\\').GetTask(${ps(task)}).RunEx($null,4,[int]${sessionId},$null); } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`,
    );
    if (trigger) {
      await waitFor(
        () => windows(`Test-Path -LiteralPath ${ps(ready)}`),
        (value) => value === "True",
      );
      await trigger();
    }
    const value = await waitFor(
      () =>
        windows(
          `if(Test-Path -LiteralPath ${ps(output)}){Get-Content -LiteralPath ${ps(output)} -Raw}`,
        ),
      Boolean,
      operation === "window-consent-click" ? Number.POSITIVE_INFINITY : 45000,
    );
    const result = JSON.parse(value);
    if (result.error) throw new Error(result.error);
    // Later calls in this run reuse the window first resolved for the Client.
    if (result.handle) state.windowHandle = result.handle;
    if (screenshot && result.captured)
      await command("scp", [
        "-o",
        "BatchMode=yes",
        `${verificationLocal.windows.host}:${png.replaceAll("\\", "/")}`,
        screenshot,
      ]);
    return result;
  } finally {
    windows(
      `$t=Get-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue;if($t){if($t.Actions.Arguments -notlike ${ps("*" + script + "*")}){throw 'Desktop task ownership mismatch'};Stop-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName ${ps(task)} -Confirm:$false};foreach($file in @(${ps(script)},${ps(output)},${ps(png)},${ps(ready)})){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file -Force}};[Console]::WriteLine('recovered')`,
    );
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await lockEntry(import.meta.url);
  gate({ devices: [verificationLocal.windows.host], requireFreePorts: false });
  const state = JSON.parse(await readFile(process.argv[2], "utf8"));
  windows(
    `if(Test-Path -LiteralPath ${ps(state.windowsRoot)}){throw 'Standalone desktop operation requires a new dedicated folder'};[IO.Directory]::CreateDirectory(${ps(state.windowsRoot)}) | Out-Null`,
  );
  try {
    console.log(
      JSON.stringify(await windowsDesktop(state, process.argv[3] ?? "probe")),
    );
  } finally {
    windows(
      `Remove-Item -LiteralPath ${ps(state.windowsRoot)} -Recurse -Force`,
    );
  }
}
