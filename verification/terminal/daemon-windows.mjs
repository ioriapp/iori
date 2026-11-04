import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockEntry } from "../native/locks.mjs";
import { gate, windows, ps, windowsBuildNode } from "../native/remote.mjs";
import { writeWindows, windowsEnvironment } from "../connection/build.mjs";
import { createSourceArchive, windowsSourceMtimes } from "../native/source.mjs";
import { windowsCache } from "../native/cache.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";

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
try {
  const archive = path.join(temporary, "source.tar");
  await createSourceArchive(
    fileURLToPath(new URL("../../", import.meta.url)),
    archive,
  );
  windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
  await writeWindows(root + "\\source.tar", await readFile(archive));
  const output = windows(
    `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'extract failed'};Set-Location ${ps(root)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};$env:CARGO_BUILD_JOBS='2';pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};pnpm --filter @iori/host build:native;if($LASTEXITCODE -ne 0){throw 'native build failed'};node scripts/release/host.mjs bundle;if($LASTEXITCODE -ne 0){throw 'bundle failed'};& "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:winexe /out:bundle\\iori-host-background.exe scripts\\release\\launcher.cs;if($LASTEXITCODE -ne 0){throw 'launcher build failed'}`,
  );
  await writeFile(path.join(evidence, "build.log"), output);
  let failure;
  try {
    windows(
      `Set-Location ${ps(root)};& ${ps(windowsBuildNode)} verification/terminal/daemon-lifecycle.mjs ${ps(root)} 49172;if($LASTEXITCODE -ne 0){throw 'Windows lifecycle failed'}`,
    );
  } catch (error) {
    failure = error.message;
  }
  const result = JSON.parse(
    windows(
      `if(Test-Path -LiteralPath ${ps(root + "\\lifecycle-result.json")}){Get-Content -LiteralPath ${ps(root + "\\lifecycle-result.json")} -Raw}else{@{passed=$false;error=${ps(failure ?? "No lifecycle result")}} | ConvertTo-Json}`,
    ),
  );
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify({ evidence, ...result }));
  assert.equal(result.passed, true);
} finally {
  stopOwnedWindowsProcesses(root);
  windows(
    `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Windows verification folder remains'}}`,
  );
  await rm(temporary, { recursive: true, force: true });
}
