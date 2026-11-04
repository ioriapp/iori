import { local as verificationLocal } from "../native/local.mjs";
import { cleanupWindowsClientStorage } from "./client-storage.mjs";
import { windows, linux, ps, sh, adb } from "../native/remote.mjs";
import { androidPackage } from "./client.mjs";
import {
  stopOwnedWindowsProcesses,
  stopOwnedWindowsBrowser,
} from "../native/processes.mjs";
import { readFileSync, rmSync } from "node:fs";
import { lockEntry, heldDevices } from "../native/locks.mjs";
import { evidence } from "./build.mjs";
export { stopOwnedWindowsProcesses };

export function cleanupFolders(state) {
  const devices = heldDevices();
  const windowsUsed =
    state.windowsRoot && devices.includes(verificationLocal.windows.host);
  const linuxUsed =
    state.linuxRoot && devices.includes(verificationLocal.linux.host);
  const androidUsed = devices.includes("android");
  const packageToRemove = state.androidPackage ?? androidPackage;
  if (windowsUsed) {
    stopOwnedWindowsBrowser(
      state.windowsRoot + "\\cli-data\\Microsoft\\Edge\\User Data",
    );
    stopOwnedWindowsProcesses(state.windowsRoot);
  }
  const windowsClientStorageRemoved =
    windowsUsed && cleanupWindowsClientStorage(state);
  if (windowsUsed)
    windows(
      `cmd.exe /c ${ps('rd /s /q "\\\\?\\' + state.windowsRoot + '"')};if(Test-Path -LiteralPath ${ps(state.windowsRoot)}){throw 'Windows build folder remains'}`,
    );
  if (linuxUsed) linux(`sudo -u iori-dev -H rm -rf -- ${sh(state.linuxRoot)}`);
  if (
    androidUsed &&
    adb(["shell", "pm", "list", "packages", packageToRemove]).includes(
      "package:" + packageToRemove,
    )
  )
    adb(["uninstall", packageToRemove]);
  if (linuxUsed && state.localRoot)
    rmSync(state.localRoot, { recursive: true, force: true });
  if (androidUsed && state.androidRoot)
    rmSync(state.androidRoot, { recursive: true, force: true });
  return {
    windowsRootRemoved: Boolean(windowsUsed),
    windowsClientStorageRemoved,
    linuxRootRemoved: Boolean(linuxUsed),
    androidPackageRemoved:
      androidUsed &&
      !adb(["shell", "pm", "list", "packages", packageToRemove]).includes(
        "package:" + packageToRemove,
      ),
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await lockEntry(import.meta.url);
  console.log(
    JSON.stringify(
      cleanupFolders(
        JSON.parse(readFileSync(evidence + "/build-state.json", "utf8")),
      ),
      null,
      2,
    ),
  );
}
