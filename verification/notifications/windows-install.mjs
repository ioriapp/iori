import { local as verificationLocal } from "../native/local.mjs";
import { windows, ps } from "../native/remote.mjs";
import { verificationConfig } from "../config.mjs";
import { spawn } from "node:child_process";
import { windowsDesktop } from "../native/windows-desktop.mjs";
import { Cdp, ui, waitFor } from "../ui.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";

export async function startWindowsNotificationClient(state, debugPort) {
  const launched = debugPort
    ? { debugPort, attached: true }
    : await windowsDesktop(state, "start-menu-open");
  const tunnel = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-N",
      "-L",
      `127.0.0.1:14445:127.0.0.1:${launched.debugPort}`,
      verificationLocal.windows.host,
    ],
    { stdio: "ignore" },
  );
  const tunnelClosed = new Promise((resolve) => tunnel.once("close", resolve));
  let browser;
  const detach = async () => {
    browser?.close();
    tunnel.kill("SIGTERM");
    await tunnelClosed;
  };
  const stop = async () => {
    await detach();
    stopOwnedWindowsProcesses(state.windowsRoot);
  };
  try {
    const target = await waitFor(async () => {
      try {
        return (await (await fetch("http://127.0.0.1:14445/json")).json()).find(
          (item) => item.type === "page" && item.webSocketDebuggerUrl,
        );
      } catch {
        return undefined;
      }
    });
    browser = await Cdp.connect(
      target.webSocketDebuggerUrl.replace(
        /127\.0\.0\.1:\d+/u,
        "127.0.0.1:14445",
      ),
    );
    await waitFor(async () => {
      try {
        return await browser.evaluate(
          "document.readyState==='complete'&&Boolean(window.__TAURI_INTERNALS__)",
        );
      } catch {
        return false;
      }
    });
    return {
      browser,
      screen: ui((expression) => browser.evaluate(expression), browser),
      stop,
      detach,
      launched,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

export function installWindowsNotificationClient(state) {
  const installed = state.windowsRoot + "\\installed";
  const scheme = verificationConfig.plugins["deep-link"].desktop.schemes[0];
  windows(
    `foreach($root in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'),[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'))){if(@(Get-ChildItem -LiteralPath $root -Filter ${ps(verificationConfig.productName + ".lnk")} -Recurse -ErrorAction SilentlyContinue).Count){throw 'An existing verification shortcut is not owned by this run'}}`,
  );
  windows(
    `if(Test-Path -LiteralPath ${ps("Registry::HKEY_CLASSES_ROOT\\" + scheme)}){throw 'An existing protocol registration is not owned by this run'}`,
  );
  windows(
    `$previous=@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -eq ${ps(verificationConfig.productName)}});if($previous.Count){throw 'An existing verification installation is not owned by this run'}`,
  );
  state.windowsInstalled = true;
  windows(
    `$p=Start-Process -FilePath ${ps(state.windowsRoot + "\\target\\" + (state.windowsProfile ?? "debug") + "\\notification-installer.exe")} -ArgumentList ${ps("/S /D=" + installed)} -Wait -PassThru;if($p.ExitCode -ne 0){throw 'Verification installer failed'};if(-not (Test-Path -LiteralPath ${ps(installed + "\\iori-client.exe")})){throw 'Installed Client is missing'}`,
  );
  state.windowsExecutable = installed + "\\iori-client.exe";
  const handler = windows(
    `(Get-Item -LiteralPath ${ps("Registry::HKEY_CLASSES_ROOT\\" + scheme + "\\shell\\open\\command")}).GetValue('')`,
  );
  if (!handler.includes(state.windowsExecutable))
    throw new Error(
      "Installed URL handler does not point to this run's Client",
    );
}
export function uninstallWindowsNotificationClient(state) {
  if (!state.windowsInstalled) return;
  const installed = state.windowsRoot + "\\installed";
  windows(
    `if(-not (Test-Path -LiteralPath ${ps(installed + "\\uninstall.exe")})){return};$p=Start-Process -FilePath ${ps(installed + "\\uninstall.exe")} -ArgumentList ${ps("/S _?=" + installed)} -Wait -PassThru;if($p.ExitCode -ne 0){throw 'Verification uninstaller failed'}`,
  );
  if (state.removeNotificationRegistration) {
    windows(
      `$path=${ps("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\" + verificationConfig.identifier)};if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force};if(Test-Path -LiteralPath $path){throw 'Authorized notification registration remains'}`,
    );
  }
}
