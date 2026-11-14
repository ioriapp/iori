import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allowWindowsVerificationProgram,
  cleanupWindowsVerificationProgram,
} from "../native/windows-firewall.mjs";
import { lockEntry } from "../native/locks.mjs";
import {
  gate,
  windows,
  ps,
  windowsBuildNode,
  verificationPort,
} from "../native/remote.mjs";
import {
  writeWindows,
  windowsEnvironment,
  runWindowsBuild,
} from "../connection/build.mjs";
import { createSourceArchive, windowsSourceMtimes } from "../native/source.mjs";
import { windowsCache } from "../native/cache.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";
import { verifyLauncherStartup } from "./launcher-startup.mjs";

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.windows.host] });
const evidence = path.resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
    ".local/evidence/terminal-daemon",
  `windows-${Date.now()}`,
);
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), "iori-daemon-transfer-"));
const root = `${verificationLocal.windows.home}\\iori-development\\terminal-daemon-${Date.now()}-${process.pid}`;
let firewall, result;
try {
  if (process.argv.includes("--launcher-startup-only")) {
    await verifyLauncherStartup(root, evidence);
  } else {
    const archive = path.join(temporary, "source.tar");
    await createSourceArchive(
      fileURLToPath(new URL("../../", import.meta.url)),
      archive,
    );
    windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
    await writeWindows(root + "\\source.tar", await readFile(archive));
    await runWindowsBuild(
      root,
      `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'extract failed'};Set-Location ${ps(root)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};$env:CARGO_BUILD_JOBS='2';pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};pnpm --filter @iori/host build:native;if($LASTEXITCODE -ne 0){throw 'native build failed'};node scripts/release/host.mjs bundle;if($LASTEXITCODE -ne 0){throw 'bundle failed'};& "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:winexe /out:bundle\\iori-host-background.exe scripts\\release\\launcher.cs;if($LASTEXITCODE -ne 0){throw 'launcher build failed'}`,
      path.join(evidence, "build.log"),
    );

    firewall = allowWindowsVerificationProgram(
      root + "\\bundle\\runtime\\node.exe",
      `iori-verification-terminal-daemon-${Date.now()}-${process.pid}`,
    );
    result = { passed: false };
    let failure;
    try {
      windows(
        `Set-Location ${ps(root)};& ${ps(windowsBuildNode)} verification/terminal/daemon-lifecycle.mjs ${ps(root)} ${verificationPort};if($LASTEXITCODE -ne 0){throw 'Windows lifecycle failed'}`,
      );
    } catch (error) {
      failure = error.message;
    }
    result = JSON.parse(
      windows(
        `if(Test-Path -LiteralPath ${ps(root + "\\lifecycle-result.json")}){Get-Content -LiteralPath ${ps(root + "\\lifecycle-result.json")} -Raw}else{@{passed=$false;error=${ps(failure ?? "No lifecycle result")}} | ConvertTo-Json}`,
      ),
    );
  }
} finally {
  try {
    stopOwnedWindowsProcesses(root);
  } finally {
    if (firewall) {
      try {
        firewall.cleanup = cleanupWindowsVerificationProgram(firewall);
      } catch (error) {
        firewall.cleanup = { error: error.message };
      }
    }
    if (result) {
      result.firewall = firewall;
      await writeFile(
        path.join(evidence, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      console.log(JSON.stringify({ evidence, ...result }));
    }
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Windows verification folder remains'}}`,
    );
    await rm(temporary, { recursive: true, force: true });
  }
}

if (result) assert.equal(result.passed, true);
if (firewall?.created) assert.equal(firewall.cleanup?.remaining, 0);
