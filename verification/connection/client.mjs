import { local as verificationLocal } from "../native/local.mjs";
import { spawn } from "node:child_process";
import {
  windows,
  ps,
  adb,
  androidDevice,
  adbPath,
  waitUntil,
} from "../native/remote.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";
import { writeWindows } from "./build.mjs";
import { WebDriver, Cdp, ui, waitFor } from "../ui.mjs";

import {
  verificationIdentifier,
  verificationAndroidPackage,
} from "../config.mjs";
export const androidPackage = verificationAndroidPackage;
const driver =
  verificationLocal.windows.home +
  "\\iori-e0\\tools\\tauri-driver-2.0.6\\bin\\tauri-driver.exe";
const windowsPrincipal =
  verificationLocal.windows.host + "\\" + verificationLocal.windows.user;

function windowsEdgeDriver() {
  return windows(String.raw`
$application = 'C:\Program Files (x86)\Microsoft\EdgeWebView\Application'
$version = Get-ChildItem -LiteralPath $application -Directory |
  Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1 -ExpandProperty Name
if (-not $version) { throw 'WebView2の版を取得できません' }
$tools = '${verificationLocal.windows.home}\iori-e0\tools'
$destination = Join-Path $tools "edgedriver-$version"
$driver = Join-Path $destination 'msedgedriver.exe'
if (-not (Test-Path -LiteralPath $driver -PathType Leaf)) {
  $temporary = Join-Path $tools ('.edgedriver-' + [guid]::NewGuid().ToString())
  try {
    [IO.Directory]::CreateDirectory($temporary) | Out-Null
    $zip = Join-Path $temporary 'driver.zip'
    Invoke-WebRequest -Uri "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $temporary 'extracted')
    [IO.Directory]::CreateDirectory($destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $temporary 'extracted\msedgedriver.exe') -Destination $driver
  } catch {
    throw "WebView2 $version に合う msedgedriver がありません: $($_.Exception.Message)"
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  }
}
[Console]::WriteLine($driver)
`);
}

export function findWindowsInteractiveSession() {
  const expectedUser = windowsPrincipal.split("\\").at(-1);
  const result = JSON.parse(
    windows(String.raw`
$expectedUser=${ps(expectedUser)}
$lines = @(cmd.exe /c 'quser 2>nul')
$sessions = @()
foreach ($line in $lines) {
  if ([string]$line -match '^\s*>?(?<user>[^\s]+)\s+(?:(?<session>[^\s]+)\s+)?(?<id>[0-9]+)\s+(?<state>[^\s]+)(?:\s|$)') {
    $displayedUser = ([string]$Matches.user) -replace '^.*\\', ''
    $sessionName = [string]$Matches.session
    $state = [string]$Matches.state
    $idText = [string]$Matches.id
    $sessionId = 0
    $validSessionId = [int]::TryParse(
      $idText,
      [System.Globalization.NumberStyles]::None,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [ref]$sessionId
    )
    if ($displayedUser -ieq $expectedUser -and $state -ieq 'Active' -and $validSessionId -and $sessionId -gt 0) {
      $sessions += @{ sessionId = $sessionId; sessionName = $sessionName }
    }
  }
}
$console = @($sessions | Where-Object { [string]$_.sessionName -ieq 'console' })
if ($console.Count -eq 1) {
  $selected = $console[0]
} elseif ($sessions.Count -eq 1) {
  $selected = $sessions[0]
} else {
  $selected = $null
}
$selectedId = $null
if ($selected) { $selectedId = [int]$selected.sessionId }
[Console]::WriteLine((ConvertTo-Json -InputObject @{ sessionId = $selectedId } -Compress))
`),
  );
  if (result.sessionId === null)
    throw new Error(
      "検証用ユーザーのActive desktop sessionを一つ特定できません。既存の開発用ユーザーでデスクトップへログインしてください",
    );
  return result.sessionId;
}

export function stopWindowsClientTask(state) {
  const task = "iori-connection-ui-" + state.id;
  const script = state.windowsRoot + "\\driver.ps1";
  // Capture descendants while their dedicated launcher still exists.
  stopOwnedWindowsProcesses(script);
  const result = windows(
    `$t=Get-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue;if($t){if($t.Actions.Arguments -notlike ${ps("*" + script + "*")}){throw 'Scheduled Task ownership does not match'};Stop-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue;Unregister-ScheduledTask -TaskName ${ps(task)} -Confirm:$false};@(Get-ScheduledTask -TaskName ${ps(task)} -ErrorAction SilentlyContinue).Count`,
  );
  if (result !== "0") throw new Error("検証Scheduled Taskが残っています");
}
export async function startWindowsClient(
  state,
  executable = state.windowsRoot +
    "\\target\\" +
    (state.windowsProfile ?? "debug") +
    "\\iori-client.exe",
) {
  const sessionId = findWindowsInteractiveSession();
  const edgeDriver = windowsEdgeDriver();
  stopWindowsClientTask(state);
  const task = "iori-connection-ui-" + state.id;
  const script = state.windowsRoot + "\\driver.ps1";
  await writeWindows(
    script,
    `$ErrorActionPreference='Stop';[IO.File]::WriteAllText(${ps(state.windowsRoot + "\\driver.pid")},[string]$PID);$env:APPDATA=${ps(state.windowsRoot + "\\client-data")};$env:LOCALAPPDATA=${ps(state.windowsRoot + "\\client-local")};${state.windowsNodeExtraCa ? `$env:NODE_EXTRA_CA_CERTS=${ps(state.windowsNodeExtraCa)};` : ""}& ${ps(driver)} --port 4445 --native-port 4446 --native-driver ${ps(edgeDriver)} *> ${ps(state.windowsRoot + "\\driver.log")};`,
  );
  windows(
    `$action=New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument ${ps('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + script + '"')};$principal=New-ScheduledTaskPrincipal -UserId ${ps(windowsPrincipal)} -LogonType Interactive -RunLevel Limited;$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;Register-ScheduledTask -TaskName ${ps(task)} -Action $action -Principal $principal -Settings $settings | Out-Null`,
  );
  let runResult;
  try {
    runResult = JSON.parse(
      windows(
        `$service=New-Object -ComObject 'Schedule.Service';$service.Connect();$registeredTask=$service.GetFolder('\\').GetTask(${ps(task)});try{$null=$registeredTask.RunEx($null,4,[int]${sessionId},$null);$result=@{started=$true;hresult=$null}}catch{$result=@{started=$false;hresult=('0x{0:X8}' -f ($_.Exception.HResult -band 0xffffffff))}};[Console]::WriteLine((ConvertTo-Json -InputObject $result -Compress))`,
      ),
    );
  } catch {
    stopWindowsClientTask(state);
    throw new Error("Windows検証driverの起動要求結果を取得できませんでした");
  }
  if (!runResult.started) {
    stopWindowsClientTask(state);
    throw new Error(
      `Windows検証driverの起動要求に失敗しました (${runResult.hresult})`,
    );
  }
  try {
    await waitUntil(
      () =>
        windows(
          "@(Get-NetTCPConnection -LocalPort 4445,4446 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique).Count",
        ),
      (v) => v === "2",
    );
  } catch (error) {
    const status = windows(
      `Get-ScheduledTaskInfo -TaskName ${ps(task)} | Select-Object LastTaskResult | ConvertTo-Json -Compress`,
    );
    throw new Error(
      `Windows検証driverの起動を確認できません (${status}): ${error.message}`,
    );
  }
  const tunnel = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-N",
      "-L",
      "127.0.0.1:14445:127.0.0.1:4445",
      verificationLocal.windows.host,
    ],
    { stdio: "ignore" },
  );
  let tunnelError;
  const tunnelClosed = new Promise((resolve) => {
    tunnel.once("close", resolve);
    tunnel.once("error", (error) => {
      tunnelError = error.code ?? "unknown";
      resolve();
    });
  });
  const stopTunnel = async () => {
    tunnel.kill("SIGTERM");
    await tunnelClosed;
  };
  let browser;
  try {
    await waitFor(async () => {
      if (tunnelError)
        throw new Error(`Windows検証SSH転送の起動に失敗 (${tunnelError})`);
      try {
        return (await fetch("http://127.0.0.1:14445/status")).ok;
      } catch {
        return false;
      }
    });
    browser = await WebDriver.create("http://127.0.0.1:14445", executable);
    // Installed WebView2 starts on its initial blank document as well. Wait
    // for the product document, including navigation during WebDriver attach.
    await waitFor(async () => {
      try {
        return await browser.evaluate(
          "location.protocol!=='about:'&&document.readyState==='complete'&&Boolean(window.__TAURI_INTERNALS__)",
        );
      } catch {
        return false;
      }
    });
  } catch (error) {
    if (browser) {
      try {
        const document = await browser.evaluate(
          "({origin:location.origin,ready:document.readyState,globalTauri:Boolean(window.__TAURI__),internalTauri:Boolean(window.__TAURI_INTERNALS__)})",
        );
        error.message += `; initial document: ${JSON.stringify(document)}`;
      } catch {
        /* Keep the initial error if the document cannot be read. */
      }
    }
    await stopTunnel();
    stopWindowsClientTask(state);
    throw error;
  }
  const stop = async ({ closeBrowser = true } = {}) => {
    try {
      if (closeBrowser) await browser.close();
    } finally {
      await stopTunnel();
      stopWindowsClientTask(state);
    }
  };
  return {
    browser,
    screen: ui((expression) => browser.evaluate(expression), browser),
    stop,
    task,
    tunnelPid: tunnel.pid,
    executable,
  };
}
export async function startAndroidClient(apk, { install = true } = {}) {
  // A failed OS notification operation can leave the shade over the app.
  // Launch into the visible Activity rather than interacting with a hidden DOM.
  adb(["shell", "cmd", "statusbar", "collapse"]);
  if (install) adb(["install", "-r", apk], { timeout: 120000 });
  else if (
    !adb(["shell", "pm", "list", "packages", androidPackage]).includes(
      "package:" + androidPackage,
    )
  )
    throw new Error("検証用APKが導入されていません");
  adb([
    "shell",
    "am",
    "start",
    "-n",
    androidPackage + "/" + verificationIdentifier + ".MainActivity",
  ]);
  const pid = await waitFor(() =>
    adb(["shell", "pidof " + androidPackage + " || true"]),
  );
  const port = Number(
    adb(["forward", "tcp:0", "localabstract:webview_devtools_remote_" + pid]),
  );
  let browser;
  try {
    const targets = await waitFor(async () => {
      try {
        const list = await (
          await fetch(`http://127.0.0.1:${port}/json`)
        ).json();
        return list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      } catch {
        return undefined;
      }
    });
    browser = await Cdp.connect(targets.webSocketDebuggerUrl);
    // The WebView starts on a blank page and then loads the app; an evaluation
    // during that navigation fails, so start once the app document has loaded.
    await waitFor(async () => {
      try {
        return await browser.evaluate(
          "location.protocol!=='about:'&&document.readyState==='complete'",
        );
      } catch {
        return false;
      }
    });
  } catch (error) {
    try {
      browser?.close();
    } finally {
      adb(["forward", "--remove", "tcp:" + port]);
    }
    throw error;
  }
  const stop = async () => {
    browser.close();
    adb(["forward", "--remove", "tcp:" + port]);
    adb(["shell", "am", "force-stop", androidPackage]);
  };
  // A real finger on the screen, so the OS keyboard opens as it does for a
  // user (a touch sent through the WebView's debugger does not open it).
  // `point` is in CSS pixels. IoriNativePlugin pads the content with the
  // system-bar/cutout insets. Read those actual OS frames, including after
  // rotation, rather than assuming one phone's status-bar height. No UI text
  // or hierarchy is collected.
  const measureOrigin = () => {
    const display = adb(["shell", "dumpsys", "window", "displays"]);
    const size = /DisplayFrames w=(\d+) h=(\d+)/u.exec(display);
    if (!size) throw new Error("検証端末の画面の余白を測れませんでした");
    const width = Number(size[1]),
      height = Number(size[2]);
    const origin = { x: 0, y: 0 };
    for (const frame of display.matchAll(
      /InsetsSource type=ITYPE_(?:STATUS_BAR|NAVIGATION_BAR|(?:LEFT|TOP|RIGHT|BOTTOM)_DISPLAY_CUTOUT) frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\] visible=true/gu,
    )) {
      const [left, top, right, bottom] = frame.slice(1).map(Number);
      if (left === 0 && right === width && top === 0 && bottom < height)
        origin.y = Math.max(origin.y, bottom);
      if (top === 0 && bottom === height && left === 0 && right < width)
        origin.x = Math.max(origin.x, right);
    }
    return origin;
  };
  let nativeOrigin;
  try {
    nativeOrigin = measureOrigin();
  } catch (error) {
    await stop();
    throw error;
  }
  const nativeTap = async (point) => {
    const ratio = await browser.evaluate("devicePixelRatio");
    const nativeOrigin = measureOrigin();
    adb([
      "shell",
      "input",
      "tap",
      String(Math.round(point.x * ratio + nativeOrigin.x)),
      String(Math.round(point.y * ratio + nativeOrigin.y)),
    ]);
  };
  const nativeSwipe = async (from, to, duration = 300) => {
    const ratio = await browser.evaluate("devicePixelRatio");
    const nativeOrigin = measureOrigin();
    adb([
      "shell",
      "input",
      "swipe",
      String(Math.round(from.x * ratio + nativeOrigin.x)),
      String(Math.round(from.y * ratio + nativeOrigin.y)),
      String(Math.round(to.x * ratio + nativeOrigin.x)),
      String(Math.round(to.y * ratio + nativeOrigin.y)),
      String(duration),
    ]);
  };
  const nativeBack = () => adb(["shell", "input", "keyevent", "4"]);
  browser.dismissKeyboard = async () => {
    const shown = () =>
      /\bmInputShown=true\b/u.test(adb(["shell", "dumpsys", "input_method"]));
    if (!shown()) return;
    nativeBack();
    await waitFor(() => !shown());
  };
  // Puts the app in the background (Home), and brings it back to the front.
  const nativeHome = () => adb(["shell", "input", "keyevent", "3"]);
  const nativeForeground = () =>
    adb([
      "shell",
      "am",
      "start",
      "-n",
      androidPackage + "/" + verificationIdentifier + ".MainActivity",
    ]);
  return {
    browser,
    screen: ui((expression) => browser.evaluate(expression), browser),
    nativeOrigin,
    nativeTap,
    nativeSwipe,
    nativeLongPress: (point) => nativeSwipe(point, point, 1000),
    nativeBack,
    nativeHome,
    nativeForeground,
    stop,
    pid,
    port,
  };
}
