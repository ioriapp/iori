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
import { windowsDesktop } from "../native/windows-desktop.mjs";
import {
  installWindowsNotificationClient,
  uninstallWindowsNotificationClient,
} from "../notifications/windows-install.mjs";

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

async function pickLocalPort() {
  const server = createServer();
  try {
    return await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
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

async function connectOverSshTunnel(remotePort, localPort) {
  let tunnelError;
  const tunnel = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-N",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      verificationLocal.windows.host,
    ],
    { stdio: "ignore" },
  );
  const tunnelClosed = new Promise((resolve) => {
    tunnel.once("close", resolve);
    tunnel.once("error", (error) => {
      tunnelError = error.code ?? error.message;
      resolve();
    });
  });
  const stopTunnel = async () => {
    tunnel.kill("SIGTERM");
    await tunnelClosed;
  };
  let browser;
  try {
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
              `http://127.0.0.1:${localPort}/json/version`,
            );
            return response.ok;
          } catch {
            return false;
          }
        },
        { timeout: 0 },
      )
      .toBe(true);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${localPort}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent("page"));
    return { browser, page, stopTunnel };
  } catch (error) {
    await browser?.close().catch(() => {});
    await stopTunnel();
    throw error;
  }
}

function findExecutablePids(executablePath) {
  return JSON.parse(
    windows(
      `$p=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq ${ps(executablePath)} } | ForEach-Object { [int]$_.ProcessId });ConvertTo-Json -InputObject @($p) -Compress`,
    ),
  );
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
  updates = false,
} = {}) {
  if (!windowsRoot) {
    throw new Error(
      "IORI_UI_WINDOWS_ROOT が未設定です。verification/client/run.mjs から起動してください",
    );
  }
  const resolvedExe =
    executable ?? `${windowsRoot}\\target\\debug\\iori-client.exe`;
  const uiRoot = `${windowsRoot}\\ui-client`;
  const dataDir = `${uiRoot}\\data`;
  const localDir = `${uiRoot}\\local`;
  const script = `${uiRoot}\\launch.ps1`;
  const task = `iori-ui-${id}`;

  stopWindowsInteractiveTask({ task, script });
  stopUiClientProcesses(uiRoot, windowsRoot);
  resetWindowsVerificationStorage(storageId);

  if (updates) {
    if (!process.env.IORI_UI_WINDOWS_UPDATE_ROOT) {
      throw new Error(
        "IORI_UI_WINDOWS_UPDATE_ROOT が未設定です。IORI_VERIFICATION_CONFIG=verification/updates/tauri.conf.json と IORI_VERIFICATION_EVIDENCE_ROOT=.local/evidence/client-update を指定して connection/build.mjs --client Windows と verification/updates/build-windows.mjs を先に実行してください",
      );
    }
    const windowsProfile =
      process.env.IORI_UI_WINDOWS_PROFILE ??
      (executable?.includes("\\release\\") ? "release" : "debug");
    const installState = {
      id: storageId,
      windowsRoot,
      windowsProfile,
    };
    let connection;
    const cleanupInstalled = async () => {
      try {
        await connection?.browser.close().catch((error) => {
          console.error(`Windows CDP close failed: ${String(error)}`);
        });
      } finally {
        await connection?.stopTunnel();
        stopUiClientProcesses(uiRoot, windowsRoot);
        uninstallWindowsNotificationClient(installState);
        cleanupWindowsClientStorage({ id: storageId });
      }
    };
    try {
      installWindowsNotificationClient(installState);
      const launched = await windowsDesktop(installState, "start-menu-open");
      connection = await connectOverSshTunnel(
        launched.debugPort,
        await pickLocalPort(),
      );
      const client = {
        page: connection.page,
        async restartAfterUpdate(trigger) {
          const oldPids = findExecutablePids(installState.windowsExecutable);
          if (!oldPids.length) {
            throw new Error("更新前の Windows Client プロセスが見つかりません");
          }
          try {
            await trigger();
          } catch {
            // アプリがクリック応答の前に終了しうるため、新しいプロセスとバージョンで確認する
          }
          await expect
            .poll(
              () => {
                const current = findExecutablePids(
                  installState.windowsExecutable,
                );
                const oldRunning = current.some((pid) => oldPids.includes(pid));
                const newRunning = current.some(
                  (pid) => !oldPids.includes(pid),
                );
                return !oldRunning && newRunning;
              },
              { timeout: 0 },
            )
            .toBe(true);
          await connection.browser.close().catch((error) => {
            console.error(`Windows CDP close failed: ${String(error)}`);
          });
          await connection.stopTunnel();
          connection = await connectOverSshTunnel(
            launched.debugPort,
            await pickLocalPort(),
          );
          client.page = connection.page;
          return connection.page;
        },
        close: cleanupInstalled,
      };
      return client;
    } catch (error) {
      await cleanupInstalled();
      throw error;
    }
  }

  const sessionId = findWindowsInteractiveSession();

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

  let connection;
  try {
    connection = await connectOverSshTunnel(port, port);

    return {
      page: connection.page,
      async close() {
        try {
          await connection.browser.close().catch((error) => {
            console.error(`Windows CDP close failed: ${String(error)}`);
          });
        } finally {
          await connection.stopTunnel();
          stopWindowsInteractiveTask({ task, script });
          stopUiClientProcesses(uiRoot, windowsRoot);
          cleanupWindowsClientStorage({ id: storageId });
        }
      },
    };
  } catch (error) {
    await connection?.browser.close().catch(() => {});
    await connection?.stopTunnel();
    stopWindowsInteractiveTask({ task, script });
    stopUiClientProcesses(uiRoot, windowsRoot);
    throw error;
  }
}
