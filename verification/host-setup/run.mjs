import { local as verificationLocal } from "../native/local.mjs";
import {
  terminalAfterRemovalFailure,
  removalFailureRecovery,
} from "./failure-recovery-scenario.mjs";
import {
  installPreviousHost,
  prepareRemovalEvidence,
  updateFromSettings,
  removalDiagnostics,
} from "./update-before-uninstall.mjs";
import { uninstallFromSettings } from "./uninstall-scenario.mjs";
import {
  startActiveTerminal,
  activeRemovalEvidence,
} from "./active-terminal.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadNativeAddon } from "../../apps/host/src/native.ts";
import {
  windowsFirewallBaseline,
  removeWindowsProgramRules,
} from "../native/windows-firewall.mjs";
import { waitForOwnerReady } from "../native/owner-ready.mjs";
import { waitFor } from "../ui.mjs";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate, windows, ps, adb, verificationPort } from "../native/remote.mjs";
import {
  windowsDesktop,
  windowsConsentOperation,
} from "../native/windows-desktop.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";
import { evidence } from "../connection/build.mjs";
import { verificationIdentifier } from "../config.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import {
  startWindowsClient,
  startAndroidClient,
  androidPackage,
} from "../connection/client.mjs";
import { startDistribution } from "../updates/distribution.mjs";
import {
  invite,
  register,
  openSettingsSection,
} from "../../e2e/connection/scenario.mjs";
await lockEntry(import.meta.url);
const windowsOnly = process.argv.includes("--windows-only");
const loopbackOnly = process.argv.includes("--loopback-only");
const skipRestart = process.argv.includes("--skip-restart");
const restartScope =
  process.argv.find((arg) => arg.startsWith("--restart-scope="))?.slice(16) ??
  "empty";
if (!["loopback", "empty", "network"].includes(restartScope))
  throw new Error("--restart-scope must be loopback, empty or network");
if (loopbackOnly && !windowsOnly)
  throw new Error("--loopback-only requires --windows-only");
if (skipRestart && !loopbackOnly)
  throw new Error("--skip-restart requires --loopback-only");
const manualReapply = process.argv.includes("--manual-reapply");
gate({
  devices: windowsOnly
    ? [verificationLocal.windows.host]
    : ["android", verificationLocal.windows.host],
});
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const uninstall = process.argv.includes("--uninstall") || loopbackOnly;
const retainedProgram = process.argv.includes("--retained-program");
const activeTerminal =
  process.argv.includes("--active-terminal") || retainedProgram;
const previousArchive = process.argv
  .find((arg) => arg.startsWith("--after-update="))
  ?.slice(15);
if (uninstall)
  state.windowsCliHome = state.windowsRoot + "\\client-local\\host-cli-home";
const root = path.join(evidence, `run-${Date.now()}`);
await mkdir(root, { recursive: true });
const uninstallerSource = process.argv
  .find((arg) => arg.startsWith("--uninstaller-source="))
  ?.slice(21);
const result = {
  steps: [],
  cleanup: {},
  uninstallerSource,
  restartScope,
  skipRestart,
};
const data = state.windowsRoot + "\\client-local";
const bundle = data + "\\Programs\\iori-host";
const program = bundle + "\\runtime\\node.exe";
const ruleName =
  "iori-host-" +
  createHash("sha256")
    .update(program.toLowerCase())
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
let client, android, distribution, previousVersion;
let storagePrepared = false;
let installationAttempted = false;
async function approval(step) {
  await writeFile(
    path.join(root, "waiting.json"),
    JSON.stringify({ step, root }),
  );
  console.log(
    `Ownerへの確認待ち: ${step}。親から返答を受けた後だけcontinueファイルで続行。`,
  );
  await waitForOwnerReady(root, step);
}
const record = (step, value) => {
  result.steps.push({ step, value });
  console.log(JSON.stringify({ step, value }));
};
const allowConnections =
  '[data-iori-view="host-setup"] .ssh-setup-check [role="checkbox"]';
const capture = (name) =>
  windowsDesktop(state, "window-capture", {
    screenshot: path.join(root, name + ".png"),
  });
async function settingsStep(operation) {
  try {
    return await operation();
  } catch (error) {
    for (const [name, collect] of [
      [
        "settings-failure-image",
        async () => {
          const hasInvitation = await client.screen.evaluate(
            `Boolean(document.querySelector('[data-iori-field="issued-invitation"], [data-iori-field="invitation"], .invitation-qr-container'))`,
          );
          if (hasInvitation) return { state: "omitted-invitation" };
          await writeFile(
            path.join(root, "settings-failure.png"),
            Buffer.from(await client.browser.screenshot(), "base64"),
          );
          return "settings-failure.png";
        },
      ],
      [
        "settings-failure-dom",
        () =>
          client.screen.evaluate(`(() => {
        const settings = document.querySelector('[data-iori-view="settings"]');
        const selected = settings?.querySelector('[data-iori-action="settings-host-select"]');
        const button = settings?.querySelector('[data-iori-action="allow-host-connections"]');
        return { current: settings?.querySelector('[aria-current="page"]')?.getAttribute('data-iori-action') ?? null,
          hostKey: selected?.getAttribute('data-iori-host-key') ?? null,
          buttonPresent: Boolean(button), buttonVisible: Boolean(button?.getClientRects().length),
          text: (settings?.innerText ?? '').replace(/iori:\\/\\/pair\\S+/gi, '[invitation redacted]').replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]') };
      })()`),
      ],
      [
        "repeated-native-host-setup-status",
        () =>
          client.browser.evaluateAsync(
            `window.__TAURI_INTERNALS__.invoke('native_host_setup_status').then(value => ({state:'resolved', canAllowConnections:value?.canAllowConnections ?? null, installed:value?.installed ?? null, host:value?.host ? {publicKey:value.host.publicKey ?? null, connectionScope:value.host.connectionScope ?? null} : null}), () => ({state:'rejected'}))`,
          ),
      ],
      [
        "repeated-native-host-firewall-status",
        () =>
          client.browser.evaluateAsync(
            `window.__TAURI_INTERNALS__.invoke('native_host_firewall_status').then(value => ({state:'resolved', value}), () => ({state:'rejected'}))`,
          ),
      ],
    ]) {
      try {
        record(name, await collect());
      } catch {
        record(name, { state: "unavailable" });
      }
    }
    throw error;
  }
}
async function waitForLoopbackInstall() {
  await waitFor(async () => {
    const desktop = await windowsDesktop(state, "foreground-capture", {
      screenshot: path.join(root, "windows-security-warning.png"),
    });
    if (desktop.windowsSecurityWarning)
      throw new Error("Windows Security warning appeared during installation");
    const setup = '[data-iori-view="host-setup"]';
    if (!(await client.screen.visible(setup)))
      return client.screen.visible('[data-iori-view="workspace"]');
    const text = await client.screen.text(setup);
    return (
      text.includes("このデバイスを登録しました。") &&
      text.includes("この PCからは接続できます。") &&
      !(await client.screen.visible('[data-iori-action="setup-submit"]'))
    );
  });
  if (await client.screen.visible('[data-iori-view="host-setup"]')) {
    await client.screen.click('[data-iori-action="ssh-cancel"]');
    await waitFor(
      () => client.screen.visible('[data-iori-view="host-setup"]'),
      (visible) => !visible,
    );
  }
}
function loopbackEndpoints() {
  const endpoints = JSON.parse(
    windows(
      `$processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -ieq ${ps(program)}} | Select-Object -ExpandProperty ProcessId);@{endpoints=@(Get-NetUDPEndpoint | Where-Object {$_.OwningProcess -in $processes -and $_.LocalPort -eq ${verificationPort}} | Select-Object LocalAddress,LocalPort,OwningProcess)} | ConvertTo-Json -Depth 4 -Compress`,
    ),
  ).endpoints;
  assert.ok(endpoints.some((entry) => entry.LocalAddress === "127.0.0.1"));
  if (
    windows(
      "[bool](Get-NetIPAddress -AddressFamily IPv6 -IPAddress '::1' -ErrorAction SilentlyContinue)",
    ) === "True"
  )
    assert.ok(endpoints.some((entry) => entry.LocalAddress === "::1"));
  assert.ok(
    endpoints.every((entry) =>
      ["127.0.0.1", "::1"].includes(entry.LocalAddress),
    ),
  );
  return endpoints;
}
async function restartDiagnostics(step) {
  const snapshot = JSON.parse(
    windows(
      `$root=${ps(data + "\\iori-host")};$processes=@(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -ieq ${ps(program)} -or $_.ExecutablePath -ieq ${ps(bundle + "\\iori-host-background.exe")}});$pids=@($processes | Select-Object -ExpandProperty ProcessId);$maintenance=Join-Path $root 'maintenance';$operations=@();if(Test-Path -LiteralPath $maintenance){$operations=@(Get-ChildItem -LiteralPath $maintenance -Filter '*.json' | ForEach-Object {try{$v=Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json;@{name=$_.Name;kind=$v.kind;phase=$v.phase;reason=$v.reason;stage=$v.stage}}catch{@{name=$_.Name;unreadable=$true}}})};$control=Join-Path $root 'control.json';$controlPort=$null;if(Test-Path -LiteralPath $control){$controlPort=(Get-Content -LiteralPath $control -Raw | ConvertFrom-Json).port};@{processes=@($processes | Select-Object Name,ProcessId,ParentProcessId,CreationDate,SessionId);endpoints=@(Get-NetUDPEndpoint | Where-Object {$_.OwningProcess -in $pids} | Select-Object LocalAddress,LocalPort,OwningProcess);maintenance=$operations;controlPort=$controlPort;logFiles=@(Get-ChildItem -LiteralPath $root -File | Where-Object {$_.Extension -in '.log','.txt'} | ForEach-Object {$_.FullName.Substring($root.Length)})} | ConvertTo-Json -Depth 8 -Compress`,
    ),
  );
  snapshot.ui = await client.screen.text('[data-iori-view="settings"]');
  snapshot.logs = windows(
    `$files=@(${ps(state.windowsRoot + "\\driver.log")});$cache=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ${ps(verificationIdentifier)};if(Test-Path -LiteralPath $cache){$files+=@(Get-ChildItem -LiteralPath $cache -Recurse -Filter 'startup-error.txt' -File | Select-Object -ExpandProperty FullName)};foreach($file in $files){if(Test-Path -LiteralPath $file){[IO.Path]::GetFileName($file);Get-Content -LiteralPath $file -Tail 80}}`,
  )
    .replace(/iori:\/\/pair\S+/giu, "[invitation redacted]")
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/gu, "[redacted]");
  record(step, snapshot);
}
try {
  const baseline = windowsFirewallBaseline(ruleName);
  record("firewall-before", baseline);
  assert.equal(baseline.testRuleCount, 0);
  assert.equal(windows(`Test-Path -LiteralPath ${ps(bundle)}`), "False");
  assert.equal(
    windows(
      `$item=Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';[bool]$item.PSObject.Properties['iori Host Setup Test']`,
    ),
    "False",
  );
  prepareWindowsClientStorage(state);
  storagePrepared = true;
  if (previousArchive || activeTerminal || uninstallerSource) {
    await prepareRemovalEvidence(
      state,
      evidence,
      process.argv.includes("--lock-record")
        ? "lock"
        : process.argv.includes("--fail-after-terminals")
          ? "rollback"
          : undefined,
      activeTerminal || Boolean(uninstallerSource),
      uninstallerSource,
    );
  }
  if (previousArchive) {
    installationAttempted = true;
    previousVersion = await installPreviousHost(
      state,
      evidence,
      previousArchive,
    );
  }
  distribution = await startDistribution(path.join(evidence, "distribution"), {
    keepCredentials: true,
  });
  distribution.publish();
  client = await startWindowsClient(state);
  await client.screen.wait('[data-iori-action="setup-host"]');
  await capture("first-screen");
  await client.screen.click('[data-iori-action="connect-invitation"]');
  await client.screen.wait('[data-iori-field="invitation"]');
  await capture("first-invitation");
  await client.screen.click('[data-iori-action="back"]');
  await client.screen.click('[data-iori-action="setup-host"]');
  await client.screen.wait('[data-iori-view="host-setup"]');
  await capture("setup-dialog");
  if (!previousArchive)
    assert.equal(
      await client.screen.attribute(allowConnections, "aria-checked"),
      "true",
    );
  if (uninstall) {
    if (!previousArchive) await client.screen.click(allowConnections);
    installationAttempted = true;
    await client.screen.click('[data-iori-action="setup-submit"]');
  } else {
    await approval("install");
    installationAttempted = true;
    const installedUac = await windowsConsentOperation(
      state,
      client,
      '[data-iori-action="setup-submit"]',
      program,
    );
    record("after-install-uac-native", installedUac);
    record("uac-visible", installedUac.consentObserved);
    assert.equal(installedUac.consentObserved, true);
    assert.equal(installedUac.rules.length, 1);
  }
  if (loopbackOnly) await waitForLoopbackInstall();
  else
    await waitFor(
      async () =>
        (await client.screen.visible('[data-iori-view="workspace"]')) &&
        !(await client.screen.visible('[data-iori-view="host-setup"]')),
    );
  record("installed-and-registered", true);
  if (loopbackOnly) {
    assert.equal(
      JSON.parse(
        windows(
          `Get-Content -LiteralPath ${ps(data + "\\iori-host\\network.json")} -Raw`,
        ),
      ).scope,
      "loopback",
    );
    record("loopback-endpoints", loopbackEndpoints());
    await settingsStep(() =>
      openSettingsSection(client.screen, "open-devices"),
    );
    const devices = '[data-iori-view="devices"]';
    await settingsStep(() => client.screen.wait(devices));
    assert.equal(
      await client.screen.visible('[data-iori-action="invite"]'),
      false,
    );
    assert.equal(
      await client.screen.visible('[data-iori-field="issued-invitation"]'),
      false,
    );
    assert.equal(
      await client.screen.visible(
        '[data-iori-view="invitation"] .invitation-qr-container',
      ),
      false,
    );
    assert.ok(
      (await client.screen.text(devices)).includes(
        "この PCからは接続できます。ほかのデバイスから接続するには、設定の「接続」で「ほかのデバイスからの接続を許可する」を押してください。",
      ),
    );
    await capture("loopback-devices");
    const publicKey = await client.screen.attribute(
      '[data-iori-action="settings-host-select"]',
      "data-iori-host-key",
    );
    const addon = loadNativeAddon();
    const identity = addon.generateIdentity();
    const endpoint = await addon.Endpoint.bind(identity.secretKey, [
      "0.0.0.0:0",
    ]);
    identity.secretKey.fill(0);
    try {
      await assert.rejects(
        endpoint.connect(Buffer.from(publicKey, "hex"), [
          `${verificationLocal.windows.address}:${verificationPort}`,
        ]),
      );
      record("lan-connection-rejected", true);
    } finally {
      endpoint.close();
    }
    await settingsStep(() =>
      openSettingsSection(client.screen, "open-connection"),
    );
    assert.equal(
      (await client.screen.text('[data-iori-view="settings"]')).includes(
        "許可済み",
      ),
      false,
    );
    if (!skipRestart) {
      windows(
        `[IO.File]::WriteAllText(${ps(data + "\\iori-host\\network.json")},${ps(restartScope === "empty" ? "" : JSON.stringify({ scope: restartScope }))})`,
      );
      await settingsStep(() =>
        openSettingsSection(client.screen, "open-host-version"),
      );
      await restartDiagnostics("before-restart");
      await client.screen.click('[data-iori-action="host-restart"]');
      await settingsStep(() =>
        client.screen.wait('[data-iori-action="host-maintenance-confirm"]'),
      );
      await client.screen.click(
        '[data-iori-action="host-maintenance-confirm"]',
      );
      try {
        await settingsStep(() =>
          waitFor(async () => {
            const desktop = await windowsDesktop(state, "foreground-capture", {
              screenshot: path.join(root, "windows-security-warning.png"),
            });
            if (desktop.windowsSecurityWarning)
              throw new Error(
                "Windows Security warning appeared during restart",
              );
            return client.screen.visible('[data-iori-state="host-succeeded"]');
          }),
        );
      } finally {
        await restartDiagnostics("after-restart");
      }
      await settingsStep(() =>
        openSettingsSection(client.screen, "open-devices"),
      );
      await settingsStep(() =>
        client.screen.wait('[data-iori-state="connected"]'),
      );
      if (restartScope !== "network")
        record("loopback-restart-endpoints", loopbackEndpoints());
    }
    await client.screen.click('[data-iori-action="settings-close"]');
  }
  await settingsStep(() =>
    openSettingsSection(client.screen, "settings-general"),
  );
  assert.equal(
    await client.screen.visible('[data-iori-action="general-close-to-exit"]'),
    true,
  );
  await capture("general-settings");
  await client.screen.click('[data-iori-action="settings-close"]');
  record("Windows close to exit setting present", true);
  const installed = JSON.parse(
    windows(
      `@{program=Test-Path -LiteralPath ${ps(program)};run=Get-ItemPropertyValue -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'iori Host Setup Test';path=(${ps(bundle)} -in ([Environment]::GetEnvironmentVariable('Path','User') -split ';'));rules=@(Get-NetFirewallRule -Name ${ps(ruleName)} -ErrorAction SilentlyContinue | Select-Object Name,Enabled,Profile,Direction,Action)} | ConvertTo-Json -Depth 4 -Compress`,
    ),
  );
  assert.equal(installed.program, true);
  assert.equal(installed.path, true);
  assert.equal(installed.run, '"' + bundle + '\\iori-host-background.exe"');
  record("installation", installed);
  if (uninstall) {
    const savedKey = windows(
      `(Get-FileHash -Algorithm SHA256 -LiteralPath ${ps(data + "\\iori-host\\host-key")}).Hash`,
    );
    const removal = async (deleteData) => {
      await uninstallFromSettings(client, {
        deleteData,
        activeTerminal,
        record,
        evidenceDirectory: root,
        removed: async () => {
          await waitFor(
            async () => {
              if (
                await client.screen.visible(
                  '[data-iori-state="host-maintenance-error"]',
                )
              ) {
                record("removal-diagnostics", removalDiagnostics(state));
                if (!activeTerminal)
                  await terminalAfterRemovalFailure(client, {
                    cwd: state.windowsRoot,
                    record,
                    evidenceDirectory: root,
                  }).catch((error) =>
                    record("terminal-recovery-error", error.message),
                  );
                throw new Error(
                  "Uninstall failed; captured the OS error and Terminal recovery",
                );
              }
              return activeTerminal
                ? client.screen.visible('[data-iori-state="host-succeeded"]')
                : windows(`Test-Path -LiteralPath ${ps(program)}`) === "False";
            },
            Boolean,
            60_000 + 45_000,
            "Hostの削除結果",
          );
          if (previousArchive)
            record("removal-diagnostics", removalDiagnostics(state));
        },
      });
      assert.equal(
        windows(`Test-Path -LiteralPath ${ps(data + "\\iori-host")}`),
        deleteData ? "False" : "True",
      );
      assert.equal(
        windows(
          `[bool](Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run').PSObject.Properties['iori Host Setup Test']`,
        ),
        "False",
      );
      assert.equal(
        windows(
          `${ps(bundle)} -in ([Environment]::GetEnvironmentVariable('Path','User') -split ';')`,
        ),
        "False",
      );
    };
    const terminalPid = activeTerminal
      ? await startActiveTerminal(client, state, record, retainedProgram)
      : undefined;
    if (previousArchive) {
      const previousProcesses = activeTerminal
        ? activeRemovalEvidence(state).processes
        : [];
      await updateFromSettings(client, record, previousVersion);
      if (activeTerminal) {
        const processes = activeRemovalEvidence(state).processes;
        const daemon = previousProcesses.find(
          (item) =>
            item.Name === "node.exe" &&
            item.ExecutablePath.includes("\\terminal-daemon\\"),
        );
        assert.ok(daemon);
        assert.ok(
          daemon.ExecutablePath.includes(
            "\\runtime\\" + previousVersion + "\\",
          ),
        );
        assert.ok(
          processes.some(
            (item) =>
              item.ProcessId === daemon.ProcessId &&
              item.ExecutablePath === daemon.ExecutablePath,
          ),
        );
        record("terminal-daemon-continued-after-update", daemon);
      }
    }
    if (process.argv.includes("--fail-after-terminals")) {
      try {
        await removalFailureRecovery(client, {
          cwd: state.windowsRoot,
          record,
          evidenceDirectory: root,
        });
      } finally {
        const diagnostics = removalDiagnostics(state);
        record("removal-diagnostics", diagnostics);
      }
    } else await removal(false);
    if (activeTerminal) {
      const diagnostics = activeRemovalEvidence(state);
      record("active-removal", diagnostics);
      assert.ok(diagnostics.paths.every((entry) => !entry.exists));
      assert.equal(diagnostics.processes.length, 0);
      assert.equal(
        windows(
          `[bool](Get-Process -Id ${terminalPid} -ErrorAction SilentlyContinue)`,
        ),
        "False",
      );
      record("terminal-process-stopped", true);
    }
    if (!previousArchive && !activeTerminal) {
      await client.screen.click('[data-iori-action="setup-host"]');
      await client.screen.click(allowConnections);
      await client.screen.click('[data-iori-action="setup-submit"]');
      if (loopbackOnly) await waitForLoopbackInstall();
      else
        await waitFor(
          () => client.screen.visible('[data-iori-view="host-setup"]'),
          (value) => !value,
        );
      assert.equal(
        windows(
          `(Get-FileHash -Algorithm SHA256 -LiteralPath ${ps(data + "\\iori-host\\host-key")}).Hash`,
        ),
        savedKey,
      );
      record("reinstalled-same-host", true);
      await removal(true);
    }
  } else {
    record("after-uac-window", await capture("registered"));
    await settingsStep(() =>
      openSettingsSection(client.screen, "open-connection"),
    );
    await settingsStep(() =>
      client.screen.reveal(".connection-form > p:not([class])"),
    );
    assert.equal(
      await client.screen.evaluate(
        `Boolean(document.querySelector('[data-iori-action="allow-host-connections"]'))`,
      ),
      false,
    );
    await capture("connection-settings");
    if (!manualReapply) {
      await client.screen.click('[data-iori-action="register-new-host"]');
      await settingsStep(() =>
        client.screen.wait('[data-iori-view="host-choices"]'),
      );
      await capture("settings-choices");
      await client.screen.click('[data-iori-action="connect-invitation"]');
      await settingsStep(() =>
        client.screen.wait('[data-iori-field="invitation"]'),
      );
      await capture("settings-invitation");
      await client.screen.click('[data-iori-action="back"]');
      await settingsStep(() =>
        client.screen.wait('[data-iori-view="host-choices"]'),
      );
    }
    await client.screen.key("Escape");
    const removed = removeWindowsProgramRules(program);
    record("removed-firewall-rules-for-reapply", removed);
    assert.equal(removed.remaining, 0);
    await settingsStep(() =>
      openSettingsSection(client.screen, "open-connection"),
    );
    await settingsStep(() =>
      client.screen.reveal('[data-iori-action="allow-host-connections"]'),
    );
    if (manualReapply) {
      // Leave the Client open. The Owner operates the button, UAC and the UI.
      // No WebDriver call follows this handoff, including during cleanup.
      await approval("manual-reapply");
      record(
        "owner-observation",
        await readFile(path.join(root, "continue-manual-reapply"), "utf8"),
      );
      await approval("record-manual-reapply");
      record(
        "after-manual-reapply-native",
        await windowsDesktop(state, "window-health-read", { program }),
      );
    } else {
      await approval("reapply-firewall");
      const reapplied = await windowsConsentOperation(
        state,
        client,
        '[data-iori-action="allow-host-connections"]',
        program,
      );
      record("after-reapply-uac-native", reapplied);
      record("reapply-uac-visible", reapplied.consentObserved);
      assert.equal(reapplied.consentObserved, true);
      assert.ok(reapplied.clientProcesses > 0);
      assert.equal(reapplied.foreground, true);
      assert.equal(reapplied.rules.length, 1);
      const rule = reapplied.rules[0];
      assert.equal(rule.name, ruleName);
      assert.equal(rule.profile, "Any");
      assert.equal(rule.protocol, "UDP");
      assert.equal(rule.action, "Allow");
      assert.equal(rule.direction, "Inbound");
      assert.equal(rule.enabled, "True");
      await settingsStep(() =>
        waitFor(() =>
          client.screen.evaluate(
            `Boolean(document.querySelector('.connection-form > p:not([class])')) && !document.querySelector('[data-iori-action="allow-host-connections"]')`,
          ),
        ),
      );
      await capture("reapplied");
      if (!windowsOnly) {
        const invitation = await invite(client.screen);
        android = await startAndroidClient(
          process.argv[2] ?? path.join(state.androidRoot, "client.apk"),
        );
        await register(
          android.screen,
          invitation,
          "Host setup Android verification",
        );
        record("android-connected", true);
      }
      // Do not photograph the Windows invitation or its QR code.
      await settingsStep(() =>
        openSettingsSection(client.screen, "open-connection"),
      );
      await capture("completed");
    }
  }
  result.passed = true;
} catch (error) {
  result.error = error.stack;
  if (
    loopbackOnly &&
    client &&
    !error.message.includes("Windows Security warning")
  ) {
    try {
      const desktop = await windowsDesktop(state, "foreground-capture", {
        screenshot: path.join(root, "windows-security-warning.png"),
      });
      if (desktop.windowsSecurityWarning) {
        result.error = "Windows Security warning appeared during installation";
      } else if (
        !(await client.screen.visible('[data-iori-field="issued-invitation"]'))
      ) {
        await writeFile(
          path.join(root, "loopback-setup-failure.png"),
          Buffer.from(await client.browser.screenshot(), "base64"),
        );
      }
    } catch (captureError) {
      record("failure-capture-error", captureError.message);
    }
  }
  if (previousArchive || activeTerminal) {
    record("removal-diagnostics", removalDiagnostics(state));
    if (activeTerminal) record("active-removal", activeRemovalEvidence(state));
    if (client)
      await writeFile(
        path.join(root, "failure.png"),
        Buffer.from(await client.browser.screenshot(), "base64"),
      );
  }
  result.passed = false;
} finally {
  for (const [name, operation] of [
    [
      "android",
      async () => {
        await android?.stop();
        if (android) adb(["uninstall", androidPackage]);
      },
    ],
    [
      "windows",
      async () => {
        try {
          await client?.stop({ closeBrowser: !manualReapply });
        } finally {
          stopOwnedWindowsProcesses(state.windowsRoot);
          if (storagePrepared) cleanupWindowsClientStorage(state);
          if (installationAttempted)
            windows(
              `if(Test-Path -LiteralPath ${ps(data)}){Remove-Item -LiteralPath ${ps(data)} -Recurse -Force}`,
            );
        }
      },
    ],
    [
      "logon-and-path",
      async () => {
        if (!installationAttempted) return;
        windows(
          `$r='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';$item=Get-ItemProperty -Path $r;$v=$item.PSObject.Properties['iori Host Setup Test'].Value;if($v -eq ${ps('"' + bundle + '\\iori-host-background.exe"')}){Remove-ItemProperty -Path $r -Name 'iori Host Setup Test'};$p=[Environment]::GetEnvironmentVariable('Path','User');[Environment]::SetEnvironmentVariable('Path',(($p -split ';' | Where-Object {$_ -ne ${ps(bundle)}}) -join ';'),'User')`,
        );
      },
    ],
    [
      "firewall",
      async () => {
        if (!installationAttempted) return;
        const cleanup = removeWindowsProgramRules(program);
        record("removed-firewall-rules", cleanup);
        assert.equal(cleanup.remaining, 0);
      },
    ],
    [
      "distribution",
      async () => {
        await distribution?.close();
        if (result.passed && !process.argv.includes("--keep-build")) {
          await rm(path.join(evidence, "distribution/tls"), {
            recursive: true,
            force: true,
          });
          await rm(path.join(evidence, "distribution/signing"), {
            recursive: true,
            force: true,
          });
        }
      },
    ],
  ]) {
    try {
      await operation();
      result.cleanup[name] = true;
    } catch (error) {
      result.cleanup[name] = error.message;
    }
  }
  if (uninstall) {
    const desktop = await windowsDesktop(state, "foreground-read");
    record("desktop-after-cleanup", {
      windowsSecurityWarning: desktop.windowsSecurityWarning,
    });
  }
  await writeFile(
    path.join(root, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ root, ...result }));
}
assert.equal(result.passed, true);
assert.ok(Object.values(result.cleanup).every((value) => value === true));
