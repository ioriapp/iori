import { local as verificationLocal } from "../native/local.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { command, evidence } from "./build.mjs";
import { ps, windows, windowsBuildNode } from "../native/remote.mjs";
import { lockEntry } from "../native/locks.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";
await lockEntry(import.meta.url);
const state = JSON.parse(
  await readFile(evidence + "/build-state.json", "utf8"),
);
const runId = Date.now();
const script = `$ErrorActionPreference='Stop';$PSNativeCommandUseErrorActionPreference=$false;$ProgressPreference='SilentlyContinue'; & pwsh -NoProfile -ExecutionPolicy Bypass -File ${ps(state.windowsRoot + "\\build.ps1")} *> ${ps(state.windowsRoot + "\\build.log")};$result=$LASTEXITCODE;[Console]::WriteLine($result);exit $result;`;
try {
  await command("ssh", [
    "-o",
    "BatchMode=yes",
    verificationLocal.windows.host,
    "pwsh",
    "-NoProfile",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
  console.log(
    windows(
      `Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} --test apps/host/src/git-reading.integration.test.ts;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`,
    ),
  );
} finally {
  stopOwnedWindowsProcesses(state.windowsRoot, true);
  const log = windows(
    `if(Test-Path -LiteralPath ${ps(state.windowsRoot + "\\build.log")}){Get-Content -LiteralPath ${ps(state.windowsRoot + "\\build.log")} -Raw}`,
  );
  await writeFile(evidence + `/windows-build-${runId}.log`, log);
}
