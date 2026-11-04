import { local as verificationLocal } from "../native/local.mjs";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  readFile,
  rename,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { configPath, verificationConfig } from "../config.mjs";
import { lockEntry } from "../native/locks.mjs";
import { windowsCache, linuxCache } from "../native/cache.mjs";
import { createSourceArchive, windowsSourceMtimes } from "../native/source.mjs";
import {
  gate,
  windows,
  linux,
  ps,
  sh,
  windowsBuildNode,
} from "../native/remote.mjs";

export const evidence = path.resolve(
  process.env.IORI_VERIFICATION_EVIDENCE_ROOT ?? ".local/evidence/connection",
);
export const windowsEnvironment = `$env:IORI_VERIFICATION_LOCAL='.local/verification.json';$ErrorActionPreference='Stop';$env:PATH='${verificationLocal.windows.home}\\dev-tools\\node-24.22.1;${verificationLocal.windows.home}\\iori-e0\\tools\\pnpm\\node_modules\\.bin;${verificationLocal.windows.home}\\iori-e0\\tools\\cargo\\bin;'+$env:PATH;$env:CARGO_HOME='${verificationLocal.windows.home}\\iori-e0\\tools\\cargo';$env:RUSTUP_HOME='${verificationLocal.windows.home}\\iori-e0\\tools\\rustup';$vs=& 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe' -all -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1;cmd /c ('"'+$vs+'\\Common7\\Tools\\VsDevCmd.bat" -arch=x64 >nul && set') | ForEach-Object {if($_ -match '^([^=]+)=(.*)$'){[Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process')}};`;
export async function command(file, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${file} exit ${code}`)),
    );
  });
}
export async function writeWindows(file, content) {
  // SFTP avoids PowerShell console input truncation. Content never enters argv or evidence.
  const temporary = await mkdtemp(path.join(tmpdir(), "iori-transfer-"));
  const source = path.join(temporary, "content");
  try {
    await writeFile(source, content, { mode: 0o600 });
    await command("scp", [
      "-o",
      "BatchMode=yes",
      source,
      `${verificationLocal.windows.host}:${file.replaceAll("\\", "/")}`,
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function prepareBuild(sourceRoot = process.cwd()) {
  await lockEntry(import.meta.url);
  // Transferring/building source does not launch a Host or consume its port.
  gate({ requireFreePorts: false });
  const clientOption = process.argv.indexOf("--client");
  const selectedClient =
    process.argv.find((arg) => arg.startsWith("--client="))?.slice(9) ??
    (clientOption < 0 ? undefined : process.argv[clientOption + 1]);
  const windowsNeeded =
    selectedClient !== "Android" && selectedClient !== "Linux";
  const appConfig = JSON.parse(
    await readFile(
      path.join(sourceRoot, "apps/client/src-tauri/tauri.conf.json"),
      "utf8",
    ),
  );
  const version = JSON.parse(
    await readFile(path.join(sourceRoot, "release-version.json"), "utf8"),
  ).version;
  const installerName = `${verificationConfig.productName ?? appConfig.productName}_${verificationConfig.version ?? version}_x64-setup.exe`;
  const windowsProfile =
    process.env.IORI_VERIFICATION_WINDOWS_PROFILE ?? "debug";
  if (!["debug", "release"].includes(windowsProfile))
    throw new Error("Windows build profile must be debug or release");
  await mkdir(evidence, { recursive: true });
  const stateFile = path.join(evidence, "build-state.json");
  let state;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
    const windowsExists =
      state.windowsRoot &&
      windowsNeeded &&
      windows(`Test-Path -LiteralPath ${ps(state.windowsRoot)}`) === "True";
    const linuxExists =
      linux(
        `sudo -u iori-dev -H test -d ${sh(state.linuxRoot)} && echo exists || true`,
      ) === "exists";
    if (!windowsExists && !linuxExists) {
      await rename(
        stateFile,
        path.join(evidence, `build-state-recovered-${state.id}.json`),
      );
      throw new Error("Previous verification folders were recovered");
    }
  } catch {
    const id =
      new Date().toISOString().replace(/[^0-9]/g, "") + "-" + process.pid;
    state = {
      id,
      windowsRoot: windowsNeeded
        ? `${verificationLocal.windows.home}\\iori-development\\connection-${id}`
        : undefined,
      linuxRoot: `/home/iori-dev/.local/iori-connection/${id}`,
      localRoot: path.resolve(`.local/verification-runs/${id}`),
    };
    if (windowsNeeded)
      windows(
        `[IO.Directory]::CreateDirectory(${ps(state.windowsRoot)}) | Out-Null;[IO.Directory]::CreateDirectory(${ps(windowsCache)}) | Out-Null`,
      );
    linux(`sudo -u iori-dev -H mkdir -p ${sh(state.linuxRoot)}`);
    await writeFile(stateFile, JSON.stringify(state, null, 2));
  }
  state.localRoot ??= path.resolve(`.local/verification-runs/${state.id}`);
  state.windowsProfile = windowsProfile;
  // A runner recovers only the devices it used. Recreate a recovered source
  // root when another device's copy still keeps this build state alive.
  if (windowsNeeded)
    windows(
      `[IO.Directory]::CreateDirectory(${ps(state.windowsRoot)}) | Out-Null;[IO.Directory]::CreateDirectory(${ps(windowsCache)}) | Out-Null`,
    );
  linux(`sudo -u iori-dev -H mkdir -p ${sh(state.linuxRoot)}`);
  await writeFile(stateFile, JSON.stringify(state, null, 2));
  await mkdir(state.localRoot, { recursive: true });
  const archive = path.join(state.localRoot, "source.tar");
  await createSourceArchive(sourceRoot, archive);
  execFileSync("tar", ["-mxf", archive, "-C", state.localRoot]);
  if (windowsNeeded) {
    await command("scp", [
      archive,
      `${verificationLocal.windows.host}:${state.windowsRoot.replaceAll("\\", "/")}/source.tar`,
    ]);
    windows(
      `tar -mxf ${ps(state.windowsRoot + "\\source.tar")} -C ${ps(state.windowsRoot)};if($LASTEXITCODE -ne 0){throw 'tar failed'}`,
    );
  }
  linux(`sudo -u iori-dev -H mkdir -p ${sh(linuxCache)}`);
  const linuxChild = spawn(
    "ssh",
    [
      verificationLocal.linux.host,
      `sudo -u iori-dev -H tar -mxf - -C ${sh(state.linuxRoot)}`,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  linuxChild.stdin.end(await readFile(archive));
  await new Promise((resolve, reject) =>
    linuxChild.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Linux transfer failed")),
    ),
  );
  await rm(archive, { force: true });
  if (windowsNeeded)
    await writeWindows(
      state.windowsRoot + "\\build.ps1",
      windowsEnvironment +
        `Set-Location ${ps(state.windowsRoot)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};pnpm install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};pnpm --filter @iori/client build;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};pnpm --filter @iori/host build:native;if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};pnpm --filter @iori/client tauri build ${windowsProfile === "debug" ? "--debug" : ""} ${process.env.IORI_VERIFICATION_WINDOWS_BUNDLE === "nsis" ? "--bundles nsis" : "--no-bundle"} --config ${ps(state.windowsRoot + "\\" + configPath.replaceAll("/", "\\"))};if($LASTEXITCODE -ne 0){exit $LASTEXITCODE};[IO.Directory]::CreateDirectory(${ps(state.windowsRoot + "\\target\\" + windowsProfile)}) | Out-Null;Copy-Item -LiteralPath ${ps(windowsCache + "\\cargo-target\\" + windowsProfile + "\\iori-client.exe")} -Destination ${ps(state.windowsRoot + "\\target\\" + windowsProfile + "\\iori-client.exe")} -Force;${process.env.IORI_VERIFICATION_WINDOWS_BUNDLE === "nsis" ? `Copy-Item -LiteralPath ${ps(windowsCache + "\\cargo-target\\" + windowsProfile + "\\bundle\\nsis\\" + installerName)} -Destination ${ps(state.windowsRoot + "\\target\\" + windowsProfile + "\\notification-installer.exe")} -Force;` : ""}`,
    );
  console.log(
    JSON.stringify({
      id: state.id,
      windowsRoot: state.windowsRoot,
      linuxRoot: state.linuxRoot,
      windowsNode: windowsBuildNode,
    }),
  );
}
if (process.argv[1] === new URL(import.meta.url).pathname) await prepareBuild();
