import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockEntry } from "../native/locks.mjs";
import { gate, windows, ps, windowsBuildNode } from "../native/remote.mjs";
import {
  writeWindows,
  windowsEnvironment,
  runWindowsBuild,
} from "../connection/build.mjs";
import { createSourceArchive } from "../native/source.mjs";
import { windowsCache } from "../native/cache.mjs";
import {
  startWindowsInteractiveTask,
  stopOwnedWindowsProcesses,
  stopWindowsInteractiveTask,
} from "../native/processes.mjs";
import { findWindowsInteractiveSession } from "../connection/client.mjs";
import { waitFor } from "../ui.mjs";

/**
 * Forge tokens on a Windows Host: the distribution carries the keyring's
 * native module, and Credential Manager keeps the token. Both run in the
 * verification user's desktop session, as the installed Host does, rather
 * than in SSH's logon session.
 */
await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.windows.host], requireFreePorts: false });
const evidence = path.resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/forge-token",
  `windows-${Date.now()}`,
);
await mkdir(evidence, { recursive: true });
await mkdir(".local", { recursive: true });
const temporary = await mkdtemp(path.resolve(".local/forge-token-transfer-"));
const root = `${verificationLocal.windows.home}\\iori-development\\forge-token-${Date.now()}-${process.pid}`;
const bundle = root + "\\bundle";
const task = {
  task: `iori-forge-token-${Date.now()}-${process.pid}`,
  script: root + "\\desktop.ps1",
  user: verificationLocal.windows.host + "\\" + verificationLocal.windows.user,
  sessionId: findWindowsInteractiveSession(),
};
const probe = `import { readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [bundle, resultFile] = process.argv.slice(2);
const { TokenVault } = await import(pathToFileURL(join(bundle, "src", "forge", "token-vault.js")));
const root = await mkdtemp(join(tmpdir(), "iori-forge-token-"));
const origin = "https://forgejo-" + randomUUID() + ".example.invalid";
const token = randomBytes(20).toString("hex");
const fail = () => Promise.reject(new Error("the token file was written"));
const vault = new TokenVault({ hostKey: "verification-" + randomUUID(), root, secureFile: fail, protect: (d) => d, unprotect: (d) => d });
const result = { storage: await vault.storage() };
try {
  result.written = await vault.write(origin, token);
  result.readBack = (await vault.read(origin, "os")) === token;
  result.filesInDataFolder = (await readdir(root)).length;
} catch (error) {
  result.error = String(error?.message ?? error);
} finally {
  await vault.delete(origin, "os").catch(() => undefined);
  result.removed = (await vault.read(origin, "os").catch(() => "unreadable")) === undefined;
  await rm(root, { recursive: true, force: true });
}
await writeFile(resultFile, JSON.stringify(result));
`;
try {
  const archive = path.join(temporary, "source.tar");
  await createSourceArchive(
    fileURLToPath(new URL("../../", import.meta.url)),
    archive,
  );
  windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
  await writeWindows(root + "\\source.tar", await readFile(archive));
  await writeWindows(root + "\\bundle-probe.mjs", probe);
  await runWindowsBuild(
    root,
    `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'extract failed'};Set-Location ${ps(root)};pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};& ${ps(windowsBuildNode)} scripts/release/host.mjs ${ps(bundle)};if($LASTEXITCODE -ne 0){throw 'bundle failed'}`,
    path.join(evidence, "build.log"),
  );
  const bundled = windows(
    `Test-Path -LiteralPath ${ps(bundle + "\\node_modules\\@napi-rs\\keyring-win32-x64-msvc\\keyring.win32-x64-msvc.node")}`,
  );
  await writeWindows(
    task.script,
    `$ErrorActionPreference='Stop';Set-Location ${ps(root)};& ${ps(windowsBuildNode)} --test --test-timeout=60000 --test-reporter=tap apps/host/src/forge/token-vault.integration.test.ts *> ${ps(root + "\\vault-test.log")};[IO.File]::WriteAllText(${ps(root + "\\vault-test.exit")},[string]$LASTEXITCODE);& ${ps(bundle + "\\runtime\\node.exe")} ${ps(root + "\\bundle-probe.mjs")} ${ps(bundle)} ${ps(root + "\\bundle-probe.json")} *> ${ps(root + "\\bundle-probe.log")};[IO.File]::WriteAllText(${ps(root + "\\done")},[string]$LASTEXITCODE);exit 0`,
  );
  startWindowsInteractiveTask(task);
  await waitFor(
    () => windows(`Test-Path -LiteralPath ${ps(root + "\\done")}`),
    (value) => value === "True",
    300_000,
    "Windowsのtokenの保管の確認",
  );
  const read = (name) =>
    windows(
      `if(Test-Path -LiteralPath ${ps(root + "\\" + name)}){Get-Content -LiteralPath ${ps(root + "\\" + name)} -Raw}`,
    );
  const testLog = read("vault-test.log");
  await writeFile(path.join(evidence, "vault-test.log"), testLog);
  const result = {
    bundleHasKeyring: bundled === "True",
    sourceTestExit: read("vault-test.exit").trim(),
    // TAP keeps the counts ASCII through PowerShell's redirection.
    sourceTestPassedWithoutSkip:
      /^# pass 2\r?$/mu.test(testLog) && /^# skipped 0\r?$/mu.test(testLog),
    bundle: JSON.parse(read("bundle-probe.json") || "{}"),
    bundleProbeLog: read("bundle-probe.log"),
  };
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ evidence, ...result }));
  assert.equal(result.bundleHasKeyring, true);
  assert.equal(result.sourceTestExit, "0");
  assert.equal(result.sourceTestPassedWithoutSkip, true);
  assert.deepEqual(result.bundle, {
    storage: "os",
    written: "os",
    readBack: true,
    filesInDataFolder: 0,
    removed: true,
  });
} finally {
  try {
    stopWindowsInteractiveTask(task);
  } finally {
    stopOwnedWindowsProcesses(root);
    windows(
      `if(Test-Path -LiteralPath ${ps(root)}){cmd.exe /c ${ps('rd /s /q "\\\\?\\' + root + '"')};if(Test-Path -LiteralPath ${ps(root)}){throw 'Windows verification folder remains'}}`,
    );
    await rm(temporary, { recursive: true, force: true });
  }
}
