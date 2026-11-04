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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  windowsFirewallBaseline,
  removeWindowsProgramRules,
} from "../native/windows-firewall.mjs";
import { waitForOwnerReady } from "../native/owner-ready.mjs";
import { waitFor } from "../ui.mjs";
import path from "node:path";
import { lockEntry } from "../native/locks.mjs";
import { gate, windows, ps, adb } from "../native/remote.mjs";
import {
  windowsDesktop,
  windowsConsentOperation,
} from "../native/windows-desktop.mjs";
import { stopOwnedWindowsProcesses } from "../native/processes.mjs";
import { evidence } from "../connection/build.mjs";
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
const manualReapply = process.argv.includes("--manual-reapply");
gate({
  devices: windowsOnly
    ? [verificationLocal.windows.host]
    : ["android", verificationLocal.windows.host],
});
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const uninstall = process.argv.includes("--uninstall");
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
const result = { steps: [], cleanup: {}, uninstallerSource };
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
const capture = (name) =>
  windowsDesktop(state, "window-capture", {
    screenshot: path.join(root, name + ".png"),
  });
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
  if (previousArchive || activeTerminal) {
    await prepareRemovalEvidence(
      state,
      evidence,
      process.argv.includes("--lock-record")
        ? "lock"
        : process.argv.includes("--fail-after-terminals")
          ? "rollback"
          : undefined,
      activeTerminal,
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
    keepCredentials: process.argv.includes("--keep-build"),
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
      await client.screen.attribute(
        '[data-iori-field="setup-allow-connections"]',
        "data-state",
      ),
      "checked",
    );
  if (uninstall) {
    if (!previousArchive)
      await client.screen.click('[data-iori-field="setup-allow-connections"]');
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
  await waitFor(
    async () =>
      (await client.screen.visible('[data-iori-view="workspace"]')) &&
      !(await client.screen.visible('[data-iori-view="host-setup"]')),
  );
  record("installed-and-registered", true);
  await openSettingsSection(client.screen, "settings-general");
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
      await client.screen.click('[data-iori-action="settings-close"]');
      await openSettingsSection(client.screen, "open-connection");
      await client.screen.click('[data-iori-action="register-new-host"]');
      await client.screen.click('[data-iori-action="setup-host"]');
      await client.screen.click('[data-iori-field="setup-allow-connections"]');
      await client.screen.click('[data-iori-action="setup-submit"]');
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
    await openSettingsSection(client.screen, "open-connection");
    await client.screen.wait('[data-iori-action="allow-host-connections"]');
    await capture("connection-settings");
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
      await client.screen.click('[data-iori-action="register-new-host"]');
      await client.screen.wait('[data-iori-view="host-choices"]');
      await capture("settings-choices");
      await client.screen.click('[data-iori-action="connect-invitation"]');
      await client.screen.wait('[data-iori-field="invitation"]');
      await capture("settings-invitation");
      await client.screen.click('[data-iori-action="back"]');
      await client.screen.wait('[data-iori-view="host-choices"]');
      await client.screen.key("Escape");
      await openSettingsSection(client.screen, "open-connection");
      await client.screen.wait('[data-iori-action="allow-host-connections"]');
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
      await waitFor(() =>
        client.screen.evaluate(
          `document.querySelector('[data-iori-action="allow-host-connections"]')?.disabled === false`,
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
      await openSettingsSection(client.screen, "open-connection");
      await capture("completed");
    }
  }
  result.passed = true;
} catch (error) {
  result.error = error.stack;
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
    ["distribution", async () => distribution?.close()],
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
