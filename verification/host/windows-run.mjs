import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runWindowsBuild,
  windowsEnvironment,
  writeWindows,
} from "../connection/build.mjs";
import { windowsCache } from "../native/cache.mjs";
import { local as verificationLocal } from "../native/local.mjs";
import { lockEntry } from "../native/locks.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";
import {
  cleanupWindowsRuntime,
  gate,
  prepareWindowsRuntime,
  ps,
  windows,
  windowsNode,
} from "../native/remote.mjs";
import {
  createSourceArchive,
  hashSourceFiles,
  windowsSourceMtimes,
} from "../native/source.mjs";

export const WINDOWS_HOST_E2E_TESTS = [
  "e2e/host/terminal-size.test.mjs",
  "e2e/host/terminal-submit.test.mjs",
  "e2e/host/terminal-shells.test.mjs",
  "e2e/host/terminal-images.test.mjs",
  "e2e/host/terminal-daemon-state.test.mjs",
  "e2e/host/terminal-daemon-upgrade.test.mjs",
  "e2e/host/launch-instructions.test.mjs",
  "e2e/host/child-initial-input.test.mjs",
  "e2e/host/cli-stall.test.mjs",
  "e2e/host/team-lifecycle.test.mjs",
  "e2e/host/team-messages.test.mjs",
  "e2e/host/team-parent-reconnect.test.mjs",
  "e2e/host/team-instruction-recovery.test.mjs",
  "e2e/host/team-candidates.test.mjs",
  "e2e/host/team-watch.test.mjs",
];

function selectedTests() {
  const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
  const onlyIndex = process.argv.indexOf("--only");
  const raw =
    onlyArg?.slice(7) ??
    (onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined);
  if (!raw) return WINDOWS_HOST_E2E_TESTS;
  const wanted = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const matched = WINDOWS_HOST_E2E_TESTS.filter((file) =>
    wanted.some(
      (name) =>
        file === name ||
        file === `e2e/host/${name}.test.mjs` ||
        file.endsWith(`/${name}`),
    ),
  );
  if (!matched.length)
    throw new Error(`対象の試験が見つかりません: ${wanted.join(", ")}`);
  return matched;
}

function isPreparedBuildInput(file) {
  return (
    file === "pnpm-lock.yaml" ||
    file === "pnpm-workspace.yaml" ||
    file === "package.json" ||
    /^(apps|packages)\/[^/]+\/package\.json$/.test(file) ||
    file === "apps/host/native/package.json" ||
    file === "apps/host/terminal-native/package.json" ||
    file.startsWith("apps/host/patches/") ||
    file.startsWith("apps/client/patches/") ||
    file === "verification/native/node-pty.mjs" ||
    file === "rust-toolchain.toml" ||
    file === "Cargo.toml" ||
    file === "Cargo.lock" ||
    file.startsWith("crates/iori-iroh-config/") ||
    file.startsWith("apps/host/native/") ||
    file.startsWith("apps/host/terminal-native/")
  );
}

function computePreparedKey(files) {
  const hash = createHash("sha256");
  for (const file of Object.keys(files).sort()) {
    if (!isPreparedBuildInput(file)) continue;
    hash.update(file);
    hash.update("\0");
    hash.update(files[file]);
    hash.update("\n");
  }
  return hash.digest("hex");
}

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.windows.host], requireFreePorts: false });

const fresh = process.argv.includes("--fresh");
const targets = selectedTests();
const evidenceRoot = path.resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
    ".local/evidence/windows-host-e2e",
);
const evidence = path.join(evidenceRoot, `run-${Date.now()}-${process.pid}`);
await mkdir(evidence, { recursive: true });
const local = await mkdtemp(path.join(tmpdir(), "iori-windows-host-e2e-"));
const root = `${verificationLocal.windows.home}\\iori-development\\host-e2e-prepared`;
const preparedFile = `${root}\\.iori-prepared.json`;

let runtime;
const startedAt = Date.now();
try {
  runtime = prepareWindowsRuntime();
  stopOwnedWindowsProcesses(root);
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const archive = path.join(local, "source.tar");
  const transferStart = Date.now();
  const currentFiles = await hashSourceFiles(repo);
  const preparedKey = computePreparedKey(currentFiles);

  let previous = null;
  if (!fresh) {
    const raw = windows(
      `if(Test-Path -LiteralPath ${ps(preparedFile)} -PathType Leaf){[Console]::Write((Get-Content -LiteralPath ${ps(preparedFile)} -Raw -Encoding UTF8))}`,
    );
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (
          parsed?.key === preparedKey &&
          parsed.files &&
          typeof parsed.files === "object"
        ) {
          previous = parsed;
        }
      } catch {
        // Treat corrupted state as a cache miss.
      }
    }
  }

  const reused = previous !== null;
  let sourceTransferMs;
  let installAndBuildMs = 0;

  if (reused) {
    const removed = Object.keys(previous.files).filter(
      (file) => !(file in currentFiles),
    );
    const changed = Object.keys(currentFiles).filter(
      (file) => previous.files[file] !== currentFiles[file],
    );
    windows(
      `foreach($f in @(${[
        preparedFile,
        root + "\\build.ps1",
        root + "\\build.log",
        root + "\\run-tests.ps1",
        root + "\\source.tar",
        root + "\\sync-remove.txt",
      ]
        .map(ps)
        .join(
          ",",
        )})){if(Test-Path -LiteralPath $f){Remove-Item -LiteralPath $f -Force}}`,
    );
    if (removed.length > 0) {
      const syncRemoveFile = root + "\\sync-remove.txt";
      await writeWindows(syncRemoveFile, removed.join("\n") + "\n");
      windows(
        `$rootPath=[IO.Path]::GetFullPath(${ps(root)});foreach($rel in (Get-Content -LiteralPath ${ps(syncRemoveFile)} -Encoding UTF8)){if(-not $rel){continue};$target=[IO.Path]::GetFullPath((Join-Path $rootPath ($rel -replace '/','\\')));if(-not $target.StartsWith($rootPath+'\\',[StringComparison]::OrdinalIgnoreCase)){throw "Invalid path: $rel"};if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target -Force};$dir=[IO.Path]::GetDirectoryName($target);while($dir -and $dir.Length -gt $rootPath.Length -and (Test-Path -LiteralPath $dir -PathType Container)){if(@(Get-ChildItem -LiteralPath $dir -Force).Count -gt 0){break};[IO.Directory]::Delete($dir);$dir=[IO.Path]::GetDirectoryName($dir)}};Remove-Item -LiteralPath ${ps(syncRemoveFile)} -Force -ErrorAction SilentlyContinue`,
      );
    }
    if (changed.length > 0) {
      await createSourceArchive(repo, archive, changed);
      await writeWindows(root + "\\source.tar", await readFile(archive));
      windows(
        `tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'source extraction failed'};Remove-Item -LiteralPath ${ps(root + "\\source.tar")} -Force -ErrorAction SilentlyContinue`,
      );
    }
    await writeWindows(
      preparedFile,
      JSON.stringify({ key: preparedKey, files: currentFiles }),
    );
    sourceTransferMs = Date.now() - transferStart;
  } else {
    await createSourceArchive(repo, archive);
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Failed to remove previous prepared folder'}};[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`,
    );
    await writeWindows(root + "\\source.tar", await readFile(archive));
    sourceTransferMs = Date.now() - transferStart;

    const buildStart = Date.now();
    await runWindowsBuild(
      root,
      `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'source extraction failed'};Remove-Item -LiteralPath ${ps(root + "\\source.tar")} -Force -ErrorAction SilentlyContinue;Set-Location ${ps(root)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};$env:CARGO_BUILD_JOBS='2';pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'pnpm install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};pnpm --filter @iori/host build:native;if($LASTEXITCODE -ne 0){throw 'native build failed'}`,
      path.join(evidence, "build.log"),
    );
    installAndBuildMs = Date.now() - buildStart;
    await writeWindows(
      preparedFile,
      JSON.stringify({ key: preparedKey, files: currentFiles }),
    );
  }

  const testScript = root + "\\run-tests.ps1";
  await writeWindows(
    testScript,
    `$ErrorActionPreference='Stop';$PSNativeCommandUseErrorActionPreference=$false;Set-Location ${ps(root)};Get-ChildItem Env:IORI_* | Remove-Item;& ${ps(windowsNode)} --test --test-concurrency=2 --test-reporter=tap --test-timeout=60000 ${targets.map(ps).join(" ")};exit $LASTEXITCODE\n`,
  );

  const testStart = Date.now();
  const tapStream = createWriteStream(path.join(evidence, "test.tap"));
  const stderrStream = createWriteStream(
    path.join(evidence, "test-stderr.log"),
  );
  const runCommand = `$ErrorActionPreference='Stop';$PSNativeCommandUseErrorActionPreference=$false;$ProgressPreference='SilentlyContinue';& pwsh -NoProfile -ExecutionPolicy Bypass -File ${ps(testScript)};exit $LASTEXITCODE`;
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        verificationLocal.windows.host,
        "pwsh",
        "-NoProfile",
        "-EncodedCommand",
        Buffer.from(runCommand, "utf16le").toString("base64"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (chunk) => {
      tapStream.write(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrStream.write(chunk);
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  await new Promise((resolve) => tapStream.end(resolve));
  await new Promise((resolve) => stderrStream.end(resolve));
  const testRunMs = Date.now() - testStart;

  const summary = {
    passed: exitCode === 0,
    exitCode,
    reused,
    preparedKey,
    targets,
    evidence,
    timingsMs: {
      sourceTransfer: sourceTransferMs,
      installAndBuild: installAndBuildMs,
      testRun: testRunMs,
      total: Date.now() - startedAt,
    },
  };
  await writeFile(
    path.join(evidence, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary));
  assert.equal(
    exitCode,
    0,
    `Windows Host API E2E が失敗しました (exit ${exitCode}): ${evidence}`,
  );
} finally {
  stopOwnedWindowsProcesses(root);
  windows(
    `if(Test-Path -LiteralPath ${ps(root + "\\run-tests.ps1")}){Remove-Item -LiteralPath ${ps(root + "\\run-tests.ps1")} -Force}`,
  );
  cleanupWindowsRuntime(runtime);
  await rm(local, { recursive: true, force: true });
}
