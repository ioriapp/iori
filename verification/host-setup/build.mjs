import { local as verificationLocal } from "../native/local.mjs";
import { removalFailureSource } from "./update-before-uninstall.mjs";
import { DAEMON_PROTOCOL } from "../../apps/host/src/terminal/daemon/protocol.ts";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash, sign } from "node:crypto";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import {
  gate,
  windows,
  ps,
  windowsBuildNode,
  verificationPort,
} from "../native/remote.mjs";
import { createSourceCopy } from "../native/source.mjs";
import {
  evidence,
  command,
  prepareBuild,
  windowsEnvironment,
} from "../connection/build.mjs";
import {
  prepareTls,
  verificationSource,
  verificationReleaseSource,
  endpoint,
} from "../updates/distribution.mjs";
import { prepareSigning } from "../updates/keys.mjs";
await lockEntry(import.meta.url);
gate({
  devices: [verificationLocal.windows.host, verificationLocal.linux.host],
  requireFreePorts: false,
});
const ssh = process.argv.includes("--ssh");
const directory = path.resolve(evidence, "distribution");
const source = path.resolve(evidence, "source");
await mkdir(path.join(directory, "assets"), { recursive: true });
try {
  if (!process.argv.includes("--package-only")) {
    await prepareTls(directory, "Windows");
    const publicKey = await prepareSigning(directory, "Host");
    await createSourceCopy(process.cwd(), source);
    await writeFile(
      path.join(source, "apps/client/src-tauri/src/updates/mod.rs"),
      await verificationSource(
        process.cwd(),
        await readFile(path.join(directory, "tls/ca.pem"), "utf8"),
      ),
    );
    await writeFile(
      path.join(source, "apps/client/src-tauri/src/updates/release.rs"),
      await verificationReleaseSource(process.cwd()),
    );
    await writeFile(
      path.join(source, "release-source.txt"),
      endpoint("Windows").source + "\n",
    );
    await writeFile(
      path.join(source, "release-public-key.txt"),
      publicKey + "\n",
    );
    // Only the verification source uses a distinct logon entry and UDP port.
    const installer = path.join(source, "scripts/release/install-bundle.ps1");
    await writeFile(
      installer,
      (await readFile(installer, "utf8"))
        .replace("-Name 'iori Host'", "-Name 'iori Host Setup Test'")
        .replace(
          "$ErrorActionPreference = 'Stop'",
          `$ErrorActionPreference = 'Stop'
$env:USERPROFILE = Join-Path $env:LOCALAPPDATA 'host-cli-home'
$env:HOME = $env:USERPROFILE
$env:CODEX_HOME = Join-Path $env:USERPROFILE '.codex'
$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE '.claude'
$env:PI_CODING_AGENT_DIR = Join-Path $env:USERPROFILE '.pi\\agent'
New-Item -ItemType Directory -Force -Path $env:USERPROFILE | Out-Null`,
        ),
    );
    const uninstaller = path.join(
      source,
      "scripts/release/uninstall-windows.mjs",
    );
    await writeFile(
      uninstaller,
      (await readFile(uninstaller, "utf8")).replaceAll(
        "'iori Host'",
        "'iori Host Setup Test'",
      ),
    );
    const service = path.join(source, "scripts/release/service.mjs");
    await writeFile(
      service,
      `process.env.IORI_HOST_PORT = ${JSON.stringify(String(verificationPort))};\n` +
        (await readFile(service, "utf8")),
    );
    if (ssh) {
      const linuxInstaller = path.join(source, "scripts/release/install.sh");
      await writeFile(
        linuxInstaller,
        (await readFile(linuxInstaller, "utf8"))
          .replace("__IORI_RELEASE_SOURCE__", endpoint("Windows").source)
          .replace(
            "curl -fSL",
            'curl --cacert "$HOME/.iori-ssh-setup-ca.pem" -fSL',
          )
          .replace(
            'wget "$base',
            'wget --ca-certificate="$HOME/.iori-ssh-setup-ca.pem" "$base',
          ),
      );
    }
    execFileSync("git", ["init", "-q"], { cwd: source });
    execFileSync("git", ["add", "--force", "."], { cwd: source });
    await prepareBuild(source);
    await command(process.execPath, [
      "scripts/run-bounded-check.mjs",
      process.execPath,
      "verification/connection/run-build.mjs",
    ]);
  }
  const state = JSON.parse(
    await readFile(path.join(evidence, "build-state.json"), "utf8"),
  );
  const asset = ssh
    ? "iori-host-linux-x64.tar.gz"
    : "iori-host-windows-x64.zip";
  if (ssh) {
    await command(process.execPath, [
      "scripts/run-bounded-check.mjs",
      process.execPath,
      "verification/connection/prepare-linux.mjs",
    ]);
    const bundle = path.join(state.localRoot, "ssh-host-bundle");
    await command(process.execPath, ["scripts/release/host.mjs", bundle], {
      cwd: state.localRoot,
    });
    if (process.argv.includes("--fail-after-terminals")) {
      const manager = path.join(bundle, "src/maintenance/manager.js");
      await writeFile(
        manager,
        removalFailureSource(await readFile(manager, "utf8"), "rollback"),
      );
    }
    await command("tar", [
      "-czf",
      path.join(directory, "assets", asset),
      "-C",
      bundle,
      ".",
    ]);
    await rm(bundle, { recursive: true, force: true });
  } else {
    windows(
      `${windowsEnvironment}Set-Location ${ps(state.windowsRoot)};& ${ps(windowsBuildNode)} scripts/release/host.mjs setup-bundle;if($LASTEXITCODE -ne 0){throw 'bundle failed'};& "$env:WINDIR\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe" /nologo /target:winexe /out:setup-bundle\\iori-host-background.exe scripts\\release\\launcher.cs;if($LASTEXITCODE -ne 0){throw 'launcher failed'};Add-Type -AssemblyName System.IO.Compression.FileSystem;if(Test-Path -LiteralPath ${ps(state.windowsRoot + "\\iori-host-windows-x64.zip")}){Remove-Item -LiteralPath ${ps(state.windowsRoot + "\\iori-host-windows-x64.zip")}};[IO.Compression.ZipFile]::CreateFromDirectory(${ps(state.windowsRoot + "\\setup-bundle")},${ps(state.windowsRoot + "\\iori-host-windows-x64.zip")})`,
    );
    await command("scp", [
      `${verificationLocal.windows.host}:${state.windowsRoot.replaceAll("\\", "/")}/${asset}`,
      path.join(directory, "assets", asset),
    ]);
  }
  const bytes = await readFile(path.join(directory, "assets", asset));
  const { version } = JSON.parse(
    await readFile("release-version.json", "utf8"),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      version,
      terminalDaemonProtocol: DAEMON_PROTOCOL,
      assets: [
        {
          name: asset,
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    }),
  );
  await writeFile(path.join(directory, "assets/release.json"), manifest);
  await writeFile(
    path.join(directory, "assets/release.json.sig"),
    sign(
      null,
      manifest,
      await readFile(path.join(directory, "signing/release.pem")),
    ),
  );
  console.log(
    JSON.stringify({ built: true, evidence, distribution: directory }),
  );
} finally {
  await rm(source, { recursive: true, force: true });
}
