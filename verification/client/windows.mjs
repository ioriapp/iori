import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import console from "node:console";
import { createServer } from "node:net";
import process from "node:process";
import { verificationIdentifier } from "../config.mjs";
import { writeWindows } from "../connection/build.mjs";
import {
  cleanupWindowsClientStorage,
  prepareWindowsClientStorage,
} from "../connection/client-storage.mjs";
import { findWindowsInteractiveSession } from "../connection/client.mjs";
import { local as verificationLocal } from "../native/local.mjs";
import {
  startWindowsInteractiveTask,
  stopOwnedWindowsProcesses,
  stopWindowsInteractiveTask,
} from "../native/processes.mjs";
import { ps, windows } from "../native/remote.mjs";

const windowsPrincipal = `${verificationLocal.windows.host}\\${verificationLocal.windows.user}`;

async function isLocalPortFree(port) {
  const server = createServer();
  try {
    return await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
  } finally {
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
  }
}

async function pickSharedLoopbackPort() {
  for (;;) {
    const remotePort = Number(
      windows(
        "$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$l.Start();$p=([Net.IPEndPoint]$l.LocalEndpoint).Port;$l.Stop();[Console]::WriteLine($p)",
      ),
    );
    if (Number.isInteger(remotePort) && (await isLocalPortFree(remotePort))) {
      return remotePort;
    }
  }
}

function stopUiClientProcesses(uiRoot, windowsRoot) {
  stopOwnedWindowsProcesses(windowsRoot);
  stopOwnedWindowsProcesses(uiRoot);
  // WebView2 helper processes can outlive the launcher command line match,
  // but their --user-data-dir points into our isolated verification identifier.
  const escapedUi = uiRoot.replaceAll("'", "''");
  const escapedId = verificationIdentifier.replaceAll("'", "''");
  windows(
    `Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${escapedUi}*' -or $_.CommandLine -like '*${escapedId}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  );
}

function resetWindowsVerificationStorage(storageId) {
  windows(
    `$paths=@([Environment]::GetFolderPath('ApplicationData'),[Environment]::GetFolderPath('LocalApplicationData')) | ForEach-Object {Join-Path $_ ${ps(verificationIdentifier)}};foreach($path in $paths){if(Test-Path -LiteralPath $path){$marker=Join-Path $path '.iori-connection-owner';if((Test-Path -LiteralPath $marker) -and [IO.File]::ReadAllText($marker) -ne ${ps(storageId)}){throw 'Verification Client storage is already owned by another run'};cmd.exe /c ('rd /s /q "\\\\?\\'+$path+'"');if(Test-Path -LiteralPath $path){throw 'Verification Client storage remains'}}};'clean'`,
  );
  return prepareWindowsClientStorage({ id: storageId });
}

export async function startWindowsUiClient({
  windowsRoot = process.env.IORI_UI_WINDOWS_ROOT,
  executable = process.env.IORI_UI_WINDOWS_EXECUTABLE,
  storageId = process.env.IORI_UI_WINDOWS_STATE_ID ?? `ui-${process.pid}`,
  id = `ui-${process.pid}`,
} = {}) {
  if (!windowsRoot) {
    throw new Error(
      "IORI_UI_WINDOWS_ROOT が未設定です。verification/client/run.mjs から起動してください",
    );
  }
  const resolvedExe =
    executable ?? `${windowsRoot}\\target\\debug\\iori-client.exe`;
  const sessionId = findWindowsInteractiveSession();
  const uiRoot = `${windowsRoot}\\ui-client`;
  const dataDir = `${uiRoot}\\data`;
  const localDir = `${uiRoot}\\local`;
  const script = `${uiRoot}\\launch.ps1`;
  const task = `iori-ui-${id}`;

  stopWindowsInteractiveTask({ task, script });
  stopUiClientProcesses(uiRoot, windowsRoot);
  resetWindowsVerificationStorage(storageId);

  windows(
    `if(Test-Path -LiteralPath ${ps(uiRoot)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + uiRoot + '"')}};[IO.Directory]::CreateDirectory(${ps(dataDir)}) | Out-Null;[IO.Directory]::CreateDirectory(${ps(localDir)}) | Out-Null`,
  );

  const port = await pickSharedLoopbackPort();

  await writeWindows(
    script,
    [
      "$ErrorActionPreference='Stop'",
      `$env:APPDATA=${ps(dataDir)}`,
      `$env:LOCALAPPDATA=${ps(localDir)}`,
      `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=${ps(`--remote-debugging-port=${port}`)}`,
      `& ${ps(resolvedExe)}`,
    ].join(";"),
  );

  startWindowsInteractiveTask({
    task,
    script,
    sessionId,
    user: windowsPrincipal,
  });

  let tunnel;
  let tunnelError;
  let tunnelClosed = Promise.resolve();
  const stopTunnel = async () => {
    if (!tunnel) return;
    tunnel.kill("SIGTERM");
    await tunnelClosed;
    tunnel = undefined;
  };

  let browser;
  try {
    tunnel = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-N",
        "-L",
        `127.0.0.1:${port}:127.0.0.1:${port}`,
        verificationLocal.windows.host,
      ],
      { stdio: "ignore" },
    );
    tunnelClosed = new Promise((resolve) => {
      tunnel.once("close", resolve);
      tunnel.once("error", (error) => {
        tunnelError = error.code ?? error.message;
        resolve();
      });
    });

    await expect
      .poll(
        async () => {
          if (tunnelError) {
            throw new Error(
              `Windows CDP SSH転送に失敗しました (${tunnelError})`,
            );
          }
          try {
            const response = await globalThis.fetch(
              `http://127.0.0.1:${port}/json/version`,
            );
            return response.ok;
          } catch {
            return false;
          }
        },
        { timeout: 0 },
      )
      .toBe(true);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent("page"));

    return {
      page,
      async close() {
        try {
          await browser?.close().catch((error) => {
            console.error(`Windows CDP close failed: ${String(error)}`);
          });
        } finally {
          await stopTunnel();
          stopWindowsInteractiveTask({ task, script });
          stopUiClientProcesses(uiRoot, windowsRoot);
          cleanupWindowsClientStorage({ id: storageId });
        }
      },
    };
  } catch (error) {
    await browser?.close().catch(() => {});
    await stopTunnel();
    stopWindowsInteractiveTask({ task, script });
    stopUiClientProcesses(uiRoot, windowsRoot);
    throw error;
  }
}
