import { local as verificationLocal } from "../native/local.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  evidence,
  windowsEnvironment,
  writeWindows,
  command,
} from "./build.mjs";
import { gate, windows, ps } from "../native/remote.mjs";
import { startWindowsClient, stopWindowsClientTask } from "./client.mjs";
import { stopOwnedWindowsProcesses, cleanupFolders } from "./cleanup.mjs";
import { prepareWindowsClientStorage } from "./client-storage.mjs";
import { waitFor } from "../ui.mjs";
import { webViewSecurity } from "./webview-security.mjs";

// Compare the same Tauri/native application with a static page: no application JS or native invoke.
// Preserve the product executable and leave account names/raw Security XML on Windows.
import { lockEntry } from "../native/locks.mjs";
import { windowsCache } from "../native/cache.mjs";
import { windowsSourceMtimes } from "../native/source.mjs";
await lockEntry(import.meta.url);
gate();
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
try {
  prepareWindowsClientStorage(state);
  const root = state.windowsRoot + "\\.local\\webview-control";
  windows(
    `[IO.Directory]::CreateDirectory(${ps(root + "\\page")}) | Out-Null;Copy-Item -LiteralPath ${ps(state.windowsRoot + "\\target\\debug\\iori-client.exe")} -Destination ${ps(root + "\\product-client.exe")} -Force`,
  );
  await writeWindows(
    root + "\\page\\index.html",
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>WebView control</title><p data-iori-control>Static page without JavaScript or native commands.</p></html>',
  );
  const config = root + "\\tauri-control.json";
  await writeWindows(
    config,
    JSON.stringify({
      productName: "iori Connection Test",
      identifier: "io.github.ioriapp.iori.connectiontest",
      build: {
        frontendDist: "../../../.local/webview-control/page",
        beforeBuildCommand: "",
      },
      app: { withGlobalTauri: true },
    }),
  );
  const script =
    windowsEnvironment +
    `Set-Location ${ps(state.windowsRoot)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};pnpm --filter @iori/client tauri build --debug --no-bundle --config ${ps(config)};exit $LASTEXITCODE;`;
  await writeWindows(root + "\\build.ps1", script);
  try {
    await command("ssh", [
      "-o",
      "BatchMode=yes",
      verificationLocal.windows.host,
      "pwsh",
      "-NoProfile",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference='Stop';$PSNativeCommandUseErrorActionPreference=$false; & pwsh -NoProfile -ExecutionPolicy Bypass -File ${ps(root + "\\build.ps1")} *> ${ps(root + "\\build.log")};exit $LASTEXITCODE;`,
        "utf16le",
      ).toString("base64"),
    ]);
    windows(
      `Copy-Item -LiteralPath ${ps(windowsCache + "\\cargo-target\\debug\\iori-client.exe")} -Destination ${ps(root + "\\control-client.exe")} -Force`,
    );
  } finally {
    await writeFile(
      evidence + "/webview-control-build-" + Date.now() + ".log",
      windows(`Get-Content -LiteralPath ${ps(root + "\\build.log")} -Raw`),
    );
    windows(
      `Copy-Item -LiteralPath ${ps(root + "\\product-client.exe")} -Destination ${ps(state.windowsRoot + "\\target\\debug\\iori-client.exe")} -Force`,
    );
  }
  const results = [];
  const runRoot = evidence + "/webview-control-" + Date.now();
  await mkdir(runRoot, { recursive: true });
  for (const [kind, executable] of [
    ["static-control", root + "\\control-client.exe"],
    ["product", root + "\\product-client.exe"],
  ]) {
    let client;
    try {
      const before = windows('[DateTime]::UtcNow.ToString("o")');
      windows(
        `Copy-Item -LiteralPath ${ps(executable)} -Destination ${ps(state.windowsRoot + "\\target\\debug\\iori-client.exe")} -Force`,
      );
      client = await startWindowsClient(state);
      await waitFor(() =>
        client.browser.evaluate("document.readyState === 'complete'"),
      );
      const page = await client.browser.evaluate(
        "JSON.stringify({control:!!document.querySelector('[data-iori-control]'),product:!!document.querySelector('#root'),bodyTags:[...document.body.children].map(e=>e.tagName),scriptCount:document.scripts.length,origin:location.origin})",
      );
      const parsedPage = JSON.parse(page);
      if (kind === "static-control" && !parsedPage.control)
        throw new Error("静的対照画面が読み込まれていません");
      if (kind === "product" && !parsedPage.product)
        throw new Error("製品画面が読み込まれていません");
      const after = windows('[DateTime]::UtcNow.ToString("o")');
      const processes = JSON.parse(
        windows(
          `$all=@(Get-CimInstance Win32_Process);$app=@($all|Where-Object ExecutablePath -eq ${ps(state.windowsRoot + "\\target\\debug\\iori-client.exe")});$owned=[Collections.Generic.List[object]]::new();foreach($p in $app){$owned.Add($p)};for($i=0;$i -lt $owned.Count;$i++){foreach($p in $all){if($p.ParentProcessId -eq $owned[$i].ProcessId -and -not($owned.ProcessId -contains $p.ProcessId)){$owned.Add($p)}}};$r=@($owned|Where-Object Name -eq 'msedgewebview2.exe'|ForEach-Object{@{processId=('0x{0:x}' -f $_.ProcessId);version=(Get-Item -LiteralPath $_.ExecutablePath).VersionInfo.FileVersion}});ConvertTo-Json -InputObject $r -Compress`,
        ),
      );
      const events = webViewSecurity(before, after);
      results.push({
        kind,
        page: JSON.parse(page),
        before,
        after,
        events: events.map((e) => ({
          ...e,
          belongsToApplication: processes.some(
            (p) => p.processId === e.processId,
          ),
        })),
        runtimeVersions: [...new Set(processes.map((p) => p.version))],
      });
      await writeFile(
        runRoot + "/results.json",
        JSON.stringify(results, null, 2),
      );
      console.log(kind + ": Security4625 " + events.length);
    } finally {
      if (client) await client.stop();
      stopWindowsClientTask(state);
      stopOwnedWindowsProcesses(
        state.windowsRoot + "\\target\\debug\\iori-client.exe",
      );
      windows(
        `Copy-Item -LiteralPath ${ps(root + "\\product-client.exe")} -Destination ${ps(state.windowsRoot + "\\target\\debug\\iori-client.exe")} -Force`,
      );
    }
  }
} finally {
  stopWindowsClientTask(state);
  cleanupFolders(state);
}
