// Invoked by run-ssh while it owns the machine and distribution locks.
import { local as verificationLocal } from "../native/local.mjs";
import { removalFailureRecovery } from "./failure-recovery-scenario.mjs";
import {
  uninstallFromSettings,
  uninstallWithoutSsh,
} from "./uninstall-scenario.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  gate,
  linux,
  windows,
  sh,
  ps,
  verificationPort,
} from "../native/remote.mjs";
import { command, evidence, writeWindows } from "../connection/build.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import { startWindowsClient } from "../connection/client.mjs";
import { cleanupFolders } from "../connection/cleanup.mjs";
import { startDistribution } from "../updates/distribution.mjs";
import { writeWindowsPrivateKey, windowsSshInclude } from "../native/ssh.mjs";
import { windowsDesktop } from "../native/windows-desktop.mjs";
import { waitFor } from "../ui.mjs";

gate({
  devices: [verificationLocal.linux.host, verificationLocal.windows.host],
});
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const root = path.join(evidence, `ssh-run-${Date.now()}`);
await mkdir(root, { recursive: true });
const result = { steps: [], cleanup: {} };
const user = "iori-ssh-setup";
const home = `/home/${user}`;
const profile = state.windowsRoot + "\\client-local";
const configRoot = profile + "\\.ssh";
const secretRoot = await mkdtemp(path.resolve(".local/ssh-setup-key-"));
const key = path.join(secretRoot, "id_ed25519");
const passphrase = randomBytes(24).toString("base64url");
let client,
  distribution,
  publicKey,
  prepared = false,
  userPrepared = false;
const record = (step, value = true) => {
  result.steps.push({ step, value });
  console.log(JSON.stringify({ step, value }));
};
function cleanHost() {
  linux(
    `uid=$(id -u ${user}); sudo -u ${user} -H env XDG_RUNTIME_DIR=/run/user/$uid DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus sh -c ${sh(`if [ -x "$HOME/.local/lib/iori-host/iori-host" ]; then "$HOME/.local/lib/iori-host/iori-host" stop-terminals; fi; systemctl --user disable --now iori-host.service 2>/dev/null || true; rm -rf "$HOME/.local/lib/iori-host" "$HOME/.local/share/iori-host"; rm -f "$HOME/.config/systemd/user/iori-host.service" "$HOME/.local/bin/iori-host" "$HOME/.iori-ssh-setup-ca.pem"; systemctl --user daemon-reload 2>/dev/null || true`)}; sudo loginctl disable-linger ${user}`,
  );
  assert.equal(
    linux(
      `sudo test ! -e ${home}/.local/lib/iori-host && sudo test ! -e ${home}/.local/share/iori-host && echo clean`,
    ),
    "clean",
  );
}
function updateAuthorizedKey(add) {
  const operation = add
    ? `printf '%s\n' ${sh(publicKey)} >> "$file"`
    : `awk -v key=${sh(publicKey)} '$0 != key' "$file" > "$file.iori-cleanup" && mv "$file.iori-cleanup" "$file"`;
  const modes = linux(
    `sudo -u ${user} -H sh -c ${sh(`umask 077; file="$HOME/.ssh/authorized_keys"; stat -c %a "$file"; ${operation}; stat -c %a "$file"`)}`,
  );
  assert.equal(modes, "600\n600");
}
let captureNumber = 0;
const capture = (name) =>
  windowsDesktop(state, "window-capture", {
    screenshot: path.join(root, `${++captureNumber}-${name}.png`),
  });
async function waitVisible(selector) {
  await waitFor(async () => {
    const error = await client.screen.text('[data-iori-state="error"]');
    if (error) throw new Error(error);
    return client.screen.visible(selector);
  });
}
async function openSsh() {
  await client.screen.click('[data-iori-action="setup-host"]');
  await client.screen.click('[data-iori-action="setup-ssh"]');
  if (
    await client.screen.visible('[data-iori-action="ssh-change-destination"]')
  )
    await client.screen.click('[data-iori-action="ssh-change-destination"]');
  await waitVisible('[data-iori-ssh-host="iori-ssh-setup"]');
  await client.screen.click('[data-iori-ssh-host="iori-ssh-setup"]');
}
async function answerPassphrase() {
  await waitVisible('[data-iori-field="ssh-answer"]');
  assert.match(
    await client.screen.text('[data-iori-state="ssh-prompt"]'),
    /passphrase|パスフレーズ/iu,
  );
  await capture("passphrase-prompt");
  await client.screen.input('[data-iori-field="ssh-answer"]', passphrase);
  await client.screen.click('[data-iori-action="ssh-answer"]');
  await waitVisible('[data-iori-state="ssh-machine"]');
  assert.ok(
    (await client.screen.text('[data-iori-state="ssh-machine"]')).includes(
      user,
    ),
  );
}
try {
  record("ssh-include-start-cleanup", windowsSshInclude());
  linux(
    `id -u ${user} >/dev/null 2>&1 || sudo useradd --create-home --shell /bin/bash ${user}`,
  );
  userPrepared = true;
  cleanHost();
  record("dedicated-user-clean");
  execFileSync(
    "ssh-keygen",
    [
      "-q",
      "-t",
      "ed25519",
      "-N",
      passphrase,
      "-f",
      key,
      "-C",
      "iori-ssh-setup-verification",
    ],
    { stdio: "ignore" },
  );
  publicKey = (await readFile(key + ".pub", "utf8")).trim();
  linux(
    `sudo -u ${user} -H sh -c ${sh('umask 077; mkdir -p "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"; chmod 600 "$HOME/.ssh/authorized_keys"')}`,
  );
  updateAuthorizedKey(false);
  updateAuthorizedKey(true);
  record("authorized-key-cleanup-keeps-private-permissions");
  const ca = await readFile(
    path.join(evidence, "distribution/tls/ca.pem"),
    "utf8",
  );
  linux(
    `sudo -u ${user} -H sh -c ${sh(`umask 077; printf '%s' ${sh(ca)} > "$HOME/.iori-ssh-setup-ca.pem"`)}`,
  );
  windows(`[IO.Directory]::CreateDirectory(${ps(configRoot)}) | Out-Null`);
  await writeWindowsPrivateKey(
    configRoot + "\\id_ed25519",
    await readFile(key, "utf8"),
  );
  await writeWindows(
    configRoot + "\\hosts",
    `Host iori-ssh-setup\n  HostName ${verificationLocal.linux.address}\n  User ${user}\n  IdentityFile "${configRoot.replaceAll("\\", "/")}/id_ed25519"\n  IdentityAgent none\n  IdentitiesOnly yes\n  UserKnownHostsFile "${configRoot.replaceAll("\\", "/")}/known_hosts"\n  StrictHostKeyChecking ask\n`,
  );
  // The real default config includes only this isolated fixture.
  await writeWindows(
    configRoot + "\\config",
    `Include "${configRoot.replaceAll("\\", "/")}/hosts"\nHost * !excluded\n`,
  );
  record("ssh-include-added", windowsSshInclude(configRoot + "\\config"));
  distribution = await startDistribution(path.join(evidence, "distribution"));
  distribution.publish();
  await command("ssh", [
    "-o",
    "BatchMode=yes",
    verificationLocal.linux.host,
    `sudo -u ${user} -H wget --ca-certificate=${home}/.iori-ssh-setup-ca.pem -q -O /dev/null https://${verificationLocal.network.hostAddress}:14447/release.json`,
  ]);
  record("destination-download-source-reachable");
  prepareWindowsClientStorage(state);
  prepared = true;
  client = await startWindowsClient(state);
  await openSsh();
  await waitVisible('[data-iori-state="ssh-prompt"]');
  assert.match(
    await client.screen.text('[data-iori-state="ssh-prompt"]'),
    /first connection|初めて接続します/u,
  );
  await capture("host-key-prompt");
  await client.screen.click('[data-iori-action="ssh-answer"]');
  await answerPassphrase();
  record("host-key-and-passphrase-answered");
  await capture("destination-selected");
  const sshCount = () =>
    windows(
      `@(Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object {$_.CommandLine -like ${ps("* iori-ssh-setup *")}}).Count`,
    );
  assert.equal(sshCount(), "1");
  await client.screen.click('[data-iori-action="ssh-cancel"]');
  await waitFor(
    () => sshCount(),
    (count) => count === "0",
  );
  await waitFor(
    async () => !(await client.screen.visible('[data-iori-view="host-setup"]')),
  );
  record("cancel-closed-dialog-and-ssh-exited");
  await openSsh();
  await answerPassphrase();
  await client.screen.click('[data-iori-action="setup-submit"]');
  await waitVisible('[data-iori-view="workspace"]');
  await waitFor(
    async () => !(await client.screen.visible('[data-iori-view="host-setup"]')),
  );
  record("installed-registered-direct-connected");
  await capture("installed");
  await client.stop();
  client = undefined;
  cleanupWindowsClientStorage(state);
  prepared = false;
  // Keep the installed Host; only a fresh verification Client is used next.
  prepareWindowsClientStorage(state);
  prepared = true;
  client = await startWindowsClient(state);
  await openSsh();
  await answerPassphrase();
  assert.ok(
    (await client.screen.text('[data-iori-action="setup-submit"]')).includes(
      "Register",
    ) ||
      (await client.screen.text('[data-iori-action="setup-submit"]')).includes(
        "登録",
      ),
  );
  await capture("existing-host");
  const before = distribution.requests.filter((r) =>
    r.path.endsWith(".tar.gz"),
  ).length;
  await client.screen.click('[data-iori-action="setup-submit"]');
  await waitVisible('[data-iori-view="workspace"]');
  await waitFor(
    async () => !(await client.screen.visible('[data-iori-view="host-setup"]')),
  );
  assert.equal(
    distribution.requests.filter((r) => r.path.endsWith(".tar.gz")).length,
    before,
  );
  record("existing-host-registered-without-download");
  await capture("existing-registered");
  if (process.argv.includes("--fail-after-terminals")) {
    try {
      await removalFailureRecovery(client, {
        answerPrompt: async () => {
          await waitVisible('[data-iori-field="ssh-answer"]');
          await client.screen.input(
            '[data-iori-field="ssh-answer"]',
            passphrase,
          );
          await client.screen.click('[data-iori-action="ssh-answer"]');
        },
        cwd: home,
        record,
        evidenceDirectory: root,
      });
    } finally {
      const storage = home + "/.local/share/iori-host";
      record(
        "removal-error",
        JSON.parse(
          linux(`sudo -u ${user} cat ${sh(storage + "/uninstall-error.json")}`),
        ),
      );
      const status = JSON.parse(
        linux(
          `sudo -u ${user} sh -c ${sh(`cat ${storage}/maintenance/*.json`)}`,
        ),
      );
      record("removal-status", status);
    }
  } else if (process.argv.includes("--uninstall")) {
    const answerResult = async () => {
      await waitVisible('[data-iori-field="ssh-answer"]');
      await client.screen.input('[data-iori-field="ssh-answer"]', passphrase);
      await client.screen.click('[data-iori-action="ssh-answer"]');
    };
    for (const deleteData of [false, true]) {
      if (deleteData) updateAuthorizedKey(false);
      const uninstall = deleteData
        ? uninstallWithoutSsh
        : uninstallFromSettings;
      await uninstall(client, {
        deleteData,
        answerPrompt: answerResult,
        evidenceDirectory: root,
        record,
        removed: () =>
          waitFor(
            () =>
              linux(
                `sudo -u iori-ssh-setup test -e ${sh(home + "/.local/lib/iori-host/iori-host")} && printf present || printf absent`,
              ),
            (value) => value.trim() === "absent",
          ),
      });
      assert.equal(
        linux(
          `sudo -u iori-ssh-setup test -e ${sh(home + "/.local/share/iori-host/host.sqlite")} && printf present || printf absent`,
        ).trim(),
        deleteData ? "absent" : "present",
      );
      record(
        deleteData
          ? "uninstall-without-SSH-actual-files-removed"
          : "uninstall-result-read-over-ssh",
        { deleteData },
      );
      if (!deleteData) {
        await client.screen.wait('[data-iori-action="setup-host"]');
        await openSsh();
        await answerPassphrase();
        await client.screen.click('[data-iori-action="setup-submit"]');
        await waitFor(
          () => client.screen.visible('[data-iori-view="host-setup"]'),
          (visible) => !visible,
        );
      }
    }
  }
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = error.message;
} finally {
  for (const [name, operation] of [
    [
      "client",
      async () => {
        await client?.stop();
        if (prepared) cleanupWindowsClientStorage(state);
      },
    ],
    [
      "host",
      async () => {
        if (userPrepared) cleanHost();
      },
    ],
    [
      "ssh-include",
      async () => {
        record("ssh-include-end-cleanup", windowsSshInclude());
      },
    ],
    [
      "key",
      async () => {
        if (publicKey) updateAuthorizedKey(false);
        windows(
          `if(Test-Path -LiteralPath ${ps(configRoot)}){Remove-Item -LiteralPath ${ps(configRoot)} -Recurse -Force}`,
        );
        await rm(secretRoot, { recursive: true, force: true });
      },
    ],
    [
      "distribution",
      async () => {
        if (distribution) {
          await writeFile(
            path.join(root, "requests.json"),
            JSON.stringify(distribution.requests, null, 2),
          );
          await distribution.close();
        }
      },
    ],
    [
      "folders",
      async () => {
        if (!process.argv.includes("--keep-build")) cleanupFolders(state);
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
  await writeFile(
    path.join(root, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ root, ...result }));
}
assert.equal(result.passed, true);
assert.ok(Object.values(result.cleanup).every((value) => value === true));
