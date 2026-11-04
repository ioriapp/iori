import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, sign } from "node:crypto";
import path from "node:path";
import { windows, ps, verificationPort } from "../native/remote.mjs";
import { writeWindows, command } from "../connection/build.mjs";
import { openSettingsSection } from "../../e2e/connection/scenario.mjs";
import { waitFor } from "../ui.mjs";

// Use the released old implementation. Only the isolated installation's
// environment, test update source/key and logon entry differ from the release.
export async function installPreviousHost(state, evidence, archive) {
  const data = state.windowsRoot + "\\client-local";
  const previous = state.windowsRoot + "\\previous-host";
  const distribution = path.join(evidence, "distribution");
  await writeWindows(
    state.windowsRoot + "\\previous.zip",
    await readFile(archive),
  );
  windows(
    `Add-Type -AssemblyName System.IO.Compression.FileSystem;[IO.Compression.ZipFile]::ExtractToDirectory(${ps(state.windowsRoot + "\\previous.zip")},${ps(previous)})`,
  );
  for (const name of ["release-public-key.txt", "release-source.txt"])
    windows(
      `Copy-Item -LiteralPath ${ps(state.windowsRoot + "\\setup-bundle\\" + name)} -Destination ${ps(previous + "\\" + name)} -Force`,
    );
  const ca = state.windowsRoot + "\\verification-ca.pem";
  state.windowsNodeExtraCa = ca;
  await writeWindows(ca, await readFile(path.join(distribution, "tls/ca.pem")));
  const prefix = `process.env.IORI_HOST_PORT=${JSON.stringify(String(verificationPort))};process.env.NODE_EXTRA_CA_CERTS=${JSON.stringify(ca)};\n`;
  windows(
    `$file=${ps(previous + "\\service.mjs")};[IO.File]::WriteAllText($file,${ps(prefix)}+[IO.File]::ReadAllText($file))`,
  );
  // NODE_EXTRA_CA_CERTS must be set before Node starts, including the updater.
  const installer = (
    await readFile("scripts/release/install-bundle.ps1", "utf8")
  ).replaceAll("-Name 'iori Host'", "-Name 'iori Host Setup Test'");
  await writeWindows(state.windowsRoot + "\\install-previous.ps1", installer);
  windows(
    `$env:LOCALAPPDATA=${ps(data)};$env:USERPROFILE=${ps(state.windowsCliHome)};$env:HOME=$env:USERPROFILE;$env:NODE_EXTRA_CA_CERTS=${ps(ca)};$env:CODEX_HOME=Join-Path $env:USERPROFILE '.codex';$env:CLAUDE_CONFIG_DIR=Join-Path $env:USERPROFILE '.claude';$env:PI_CODING_AGENT_DIR=Join-Path $env:USERPROFILE '.pi\\agent';[IO.Directory]::CreateDirectory($env:USERPROFILE)|Out-Null;& ([scriptblock]::Create([IO.File]::ReadAllText(${ps(state.windowsRoot + "\\install-previous.ps1")}))) -Bundle ${ps(previous)} -InstallOnly`,
  );
  return windows(
    `(Get-Content -LiteralPath ${ps(data + "\\Programs\\iori-host\\package.json")} -Raw | ConvertFrom-Json).version`,
  );
}

export function removalFailureSource(source, mode) {
  if (!source.includes("uninstall-error.json")) {
    const start = source.indexOf('if (kind === "uninstall") {');
    const index =
      source.indexOf("catch (error) {", start) + "catch (error) {".length;
    assert.ok(index > start);
    source =
      source.slice(0, index) +
      'await writeFile(join(this.storage, "uninstall-error.json"), JSON.stringify({stack:error.stack,code:error.code,path:error.path,dest:error.dest}));' +
      source.slice(index);
  }
  if (mode) {
    const marker = 'const status = { ...base, phase: "removing" };';
    assert.equal(source.split(marker).length, 2);
    const index = source.indexOf(marker);
    const injection =
      mode === "rollback"
        ? 'throw Object.assign(new Error("Verification failure after stopping terminals"), {code:"EIO"});\n'
        : `const {spawn}=await import("node:child_process");const marker=file+".locked";const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command", "$f=[IO.File]::Open('"+file.replaceAll("'","''")+"',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);[IO.File]::WriteAllText('"+marker.replaceAll("'","''")+"',[string]$PID);Start-Sleep -Seconds 3;$f.Dispose()"],{stdio:"ignore"});while(!(await readFile(marker,"utf8").catch(()=>undefined)))await new Promise(r=>setTimeout(r,20));await writeFile(join(this.storage,"record-lock.json"),JSON.stringify({file,pid:child.pid,sharing:"Read",seconds:3}));\n`;
    source = source.slice(0, index) + injection + source.slice(index);
  }
  return source;
}

// Stack collection is confined to the verification distribution, never product logs.
export async function prepareRemovalEvidence(
  state,
  evidence,
  mode,
  activeTerminal = false,
  uninstallerSource = "scripts/release/uninstall-windows.mjs",
) {
  const bundle = state.windowsRoot + "\\setup-bundle";
  if (activeTerminal) {
    await writeWindows(
      bundle + "\\uninstall-windows.mjs",
      (await readFile(uninstallerSource, "utf8")).replaceAll(
        "'iori Host'",
        "'iori Host Setup Test'",
      ),
    );
  }
  const file = bundle + "\\src\\maintenance\\manager.js";
  const pristine = state.windowsRoot + "\\removal-manager-pristine.js";
  windows(
    `if(-not(Test-Path -LiteralPath ${ps(pristine)})){Copy-Item -LiteralPath ${ps(file)} -Destination ${ps(pristine)}}`,
  );
  const source = removalFailureSource(
    windows(`[IO.File]::ReadAllText(${ps(pristine)})`),
    mode,
  );
  await writeWindows(file, source);
  const asset = "iori-host-windows-x64.zip";
  windows(
    `Add-Type -AssemblyName System.IO.Compression.FileSystem;$zip=${ps(state.windowsRoot + "\\" + asset)};Remove-Item -LiteralPath $zip;[IO.Compression.ZipFile]::CreateFromDirectory(${ps(bundle)},$zip)`,
  );
  const directory = path.join(evidence, "distribution");
  await command("scp", [
    `${verificationLocal.windows.host}:${state.windowsRoot.replaceAll("\\", "/")}/${asset}`,
    path.join(directory, "assets", asset),
  ]);
  const bytes = await readFile(path.join(directory, "assets", asset));
  const manifest = JSON.parse(
    await readFile(path.join(directory, "assets/release.json"), "utf8"),
  );
  // The protocol number is the distribution's constant, not its compatibility digest.
  manifest.terminalDaemonProtocol = Number(
    windows(
      `(Select-String -LiteralPath ${ps(bundle + "\\src\\terminal\\daemon\\protocol.js")} -Pattern 'DAEMON_PROTOCOL = (\\d+)').Matches.Groups[1].Value`,
    ),
  );
  manifest.assets[0].size = bytes.length;
  manifest.assets[0].sha256 = createHash("sha256").update(bytes).digest("hex");
  const content = Buffer.from(JSON.stringify(manifest));
  await writeFile(path.join(directory, "assets/release.json"), content);
  await writeFile(
    path.join(directory, "assets/release.json.sig"),
    sign(
      null,
      content,
      await readFile(path.join(directory, "signing/release.pem")),
    ),
  );
}
export async function updateFromSettings(
  client,
  record,
  previousVersion = "0.1.18",
) {
  await openSettingsSection(client.screen, "open-host-version");
  assert.equal(
    await client.screen.text('[data-iori-value="host-version"]'),
    previousVersion,
  );
  await client.screen.click('[data-iori-action="host-update"]');
  await client.screen.wait('[data-iori-action="host-maintenance-confirm"]');
  await client.screen.click('[data-iori-action="host-maintenance-confirm"]');
  const { version } = JSON.parse(
    await readFile("release-version.json", "utf8"),
  );
  await waitFor(
    () => client.screen.text('[data-iori-value="host-version"]'),
    (v) => v === version,
  );
  await client.screen.wait('[data-iori-state="host-succeeded"]');
  record("updated-from-release", { from: previousVersion, to: version });
}
export function removalDiagnostics(state) {
  const storage = state.windowsRoot + "\\client-local\\iori-host";
  return JSON.parse(
    windows(
      `$root=${ps(storage)};$result=@{};foreach($name in @('uninstall-error.json','record-lock.json','terminal-daemon\\connection.json')){$p=Join-Path $root $name;if(Test-Path -LiteralPath $p){$value=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json;if($name -like '*connection.json'){$result[$name]=@{pid=$value.pid;version=$value.version;alive=[bool](Get-Process -Id $value.pid -ErrorAction SilentlyContinue)}}else{$result[$name]=$value}}};$result.operations=@(Get-ChildItem -LiteralPath (Join-Path $root 'maintenance') -Filter '*.json' -ErrorAction SilentlyContinue|ForEach-Object {Get-Content -LiteralPath $_.FullName -Raw|ConvertFrom-Json});$result|ConvertTo-Json -Depth 12 -Compress`,
    ),
  );
}
