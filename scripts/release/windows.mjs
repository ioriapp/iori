import { local as verificationLocal } from "../../verification/native/local.mjs";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root, output, version, command, releaseSource } from "./common.mjs";
import { lockEntry } from "../../verification/native/locks.mjs";
import { gate, windows, ps } from "../../verification/native/remote.mjs";
import {
  windowsEnvironment,
  writeWindows,
} from "../../verification/connection/build.mjs";
import { windowsCache } from "../../verification/native/cache.mjs";
import {
  createSourceArchive,
  windowsSourceMtimes,
} from "../../verification/native/source.mjs";
await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.windows.host], requireFreePorts: false });
await mkdir(output, { recursive: true });
const remote = `${verificationLocal.windows.home}\\iori-development\\release-${Date.now()}`;
const archive = path.join(output, "windows-source.tar");
windows(`[IO.Directory]::CreateDirectory(${ps(remote)}) | Out-Null`);
let failure;
try {
  await createSourceArchive(root, archive);
  await command("scp", [
    archive,
    `${verificationLocal.windows.host}:${remote.replaceAll("\\", "/")}/source.tar`,
  ]);
  windows(
    `tar -mxf ${ps(remote + "\\source.tar")} -C ${ps(remote)};if($LASTEXITCODE -ne 0){throw 'tar failed'}`,
  );
  await writeWindows(
    remote + "\\build.ps1",
    windowsEnvironment +
      `
$PSNativeCommandUseErrorActionPreference=$false
Set-Location ${ps(remote)}
${windowsSourceMtimes}
$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")}
pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")}
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
node verification/native/node-pty.mjs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
pnpm --filter @iori/host build:native
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
node scripts/release/host.mjs host
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:winexe /out:host\\iori-host-background.exe scripts\\release\\launcher.cs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Compress-Archive -Path host\\* -DestinationPath iori-host-windows-x64.zip
$env:IORI_RELEASE_BUILD="1"
pnpm --filter @iori/client tauri build --bundles nsis
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Copy-Item -LiteralPath ${ps(windowsCache + "\\cargo-target\\release\\bundle\\nsis\\iori_" + version + "_x64-setup.exe")} -Destination iori-setup-windows-x64.exe
`,
  );
  await command("ssh", [
    verificationLocal.windows.host,
    "pwsh",
    "-NoProfile",
    "-EncodedCommand",
    Buffer.from(
      `& pwsh -NoProfile -ExecutionPolicy Bypass -File ${ps(remote + "\\build.ps1")};exit $LASTEXITCODE`,
      "utf16le",
    ).toString("base64"),
  ]);
  for (const asset of [
    "iori-host-windows-x64.zip",
    "iori-setup-windows-x64.exe",
  ])
    await command("scp", [
      `${verificationLocal.windows.host}:${remote.replaceAll("\\", "/")}/${asset}`,
      path.join(output, asset),
    ]);
  const installer = await readFile(
    path.join(root, "scripts/release/install.ps1"),
    "utf8",
  );
  const bundleInstaller = await readFile(
    path.join(root, "scripts/release/install-bundle.ps1"),
    "utf8",
  );
  await writeFile(
    path.join(output, "install.ps1"),
    installer
      .replace("__IORI_RELEASE_SOURCE__", () => releaseSource)
      .replace("# IORI_INSTALL_BUNDLE", () => bundleInstaller),
  );
} catch (error) {
  failure = error;
  throw error;
} finally {
  try {
    await rm(archive, { force: true });
    windows(`cmd.exe /c ${ps('rd /s /q "\\\\?\\' + remote + '"')}`);
  } catch (error) {
    if (!failure) throw error;
    process.stderr.write(
      `Windows buildの片付けに失敗しました: ${error.message}\n`,
    );
  }
}
