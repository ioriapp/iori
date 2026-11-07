import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  installLinuxVerificationPackage,
  removeLinuxVerificationPackage,
} from "../native/linux-packages.mjs";
import { lockEntry } from "../native/locks.mjs";
import { gate, linux, sh } from "../native/remote.mjs";
import { command, evidence } from "../connection/build.mjs";
import { cleanupFolders } from "../connection/cleanup.mjs";
import { startLinuxClient, asUser } from "../linux-client/client.mjs";
import { startDistribution } from "../updates/distribution.mjs";
import { waitFor, waitForOperation } from "../ui.mjs";
import { openSettingsSection } from "../../e2e/connection/scenario.mjs";
import { uninstallFromSettings } from "./uninstall-scenario.mjs";

await lockEntry(import.meta.url);
gate({ devices: [verificationLocal.linux.host] });
const scenario = process.argv
  .find((arg) => arg.startsWith("--scenario="))
  ?.slice(11);
if (!["local", "ssh"].includes(scenario))
  throw new Error("--scenario=local または --scenario=ssh を指定してください");
const state = JSON.parse(
  await readFile(path.join(evidence, "build-state.json"), "utf8"),
);
const output = path.join(evidence, `linux-${scenario}-${Date.now()}`);
await mkdir(output, { recursive: true });
const result = {
  passed: false,
  scenario,
  phases: [],
  createdUsers: [],
  removedUsers: [],
  cleanupErrors: [],
};
const user = "iori-setup-" + randomBytes(6).toString("hex");
const target = "iori-setup-" + randomBytes(6).toString("hex");
const home = `/home/${user}`;
const root = home + "/verification";
const secret = await mkdtemp(path.resolve(".local/linux-setup-key-"));
const asset = path.join(state.setupRoot, "client/iori-linux-x64.deb");
const packageName = execFileSync("dpkg-deb", ["-f", asset, "Package"], {
  encoding: "utf8",
}).trim();
let client,
  distribution,
  installed = false;
const stage = (name) => {
  result.operationAtFailure = name;
  console.log(JSON.stringify({ step: name }));
};
const record = (step, value = true) => {
  result.phases.push({ step, value });
};
const act = (name) => `[data-iori-action="${name}"]`;
const view = '[data-iori-view="host-setup"]';
async function createUser(name) {
  // Only new disposable accounts may be provisioned or removed by this run.
  if (linux(`id -u ${sh(name)} 2>/dev/null || true`))
    throw new Error("検証用userが既に存在します");
  linux(
    `sudo useradd --create-home --user-group --shell /bin/bash ${sh(name)}`,
  );
  const uid = linux(`id -u ${sh(name)}`);
  result.createdUsers.push({ name, uid, home: `/home/${name}` });
  linux(
    `sudo systemctl start user@${uid}.service && sudo systemctl set-property --runtime user-${uid}.slice MemoryMax=4G MemorySwapMax=0`,
  );
  const ca = await readFile(path.join(state.setupRoot, "tls/ca.pem"), "utf8");
  linux(
    asUser(
      `umask 077; printf %s ${sh(ca)} > "$HOME/.iori-ssh-setup-ca.pem"`,
      name,
    ),
  );
}
async function waitSetup() {
  await waitForOperation(
    "Host setup status",
    () => client.screen.visible(act("setup-submit")),
    (visible) => visible,
    () => client.screen.text('[data-iori-state="error"]'),
  );
}
async function registered() {
  await waitForOperation(
    "Host setup registration",
    () => client.screen.visible(view),
    (visible) => !visible,
    () => client.screen.text('[data-iori-state="error"]'),
  );
  await client.screen.wait('[data-iori-view="workspace"]');
}
function localHostPort() {
  return Number(
    linux(
      asUser(
        `"$HOME/.local/lib/iori-host/runtime/node" --input-type=module -e ${sh('import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.env.HOME + "/.local/share/iori-host/host.sqlite", {readOnly: true}); const row = db.prepare("SELECT value FROM host_settings WHERE key = ?").get("listeningPort"); console.log(Buffer.from(row.value).toString()); db.close();')}`,
        user,
      ),
    ),
  );
}
try {
  stage("disposable user and deb preparation");
  await createUser(user);
  if (scenario === "ssh") await createUser(target);
  if (
    linux(
      `dpkg-query -W -f='\${db:Status-Status}' ${sh(packageName)} 2>/dev/null || true`,
    ) === "installed"
  )
    throw new Error("既存の検証用debが入っています。上書きせず停止します");
  await command("scp", [
    asset,
    verificationLocal.linux.host +
      ":/tmp/iori-host-setup-" +
      process.pid +
      ".deb",
  ]);
  await installLinuxVerificationPackage(
    `/tmp/iori-host-setup-${process.pid}.deb`,
  );
  linux(`rm /tmp/iori-host-setup-${process.pid}.deb`);
  installed = true;
  let passphrase;
  if (scenario === "ssh") {
    stage("SSH identity preparation");
    const key = path.join(secret, "id_ed25519");
    passphrase = randomBytes(24).toString("base64url");
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
        "iori-linux-setup-verification",
      ],
      { stdio: "ignore" },
    );
    const publicKey = (await readFile(key + ".pub", "utf8")).trim();
    linux(
      asUser(
        `umask 077; mkdir -p "$HOME/.ssh"; printf '%s\n' ${sh(publicKey)} > "$HOME/.ssh/authorized_keys"`,
        target,
      ),
    );
    linux(asUser('umask 077; mkdir -p "$HOME/.ssh"', user));
    await command("scp", [
      key,
      verificationLocal.linux.host +
        ":/tmp/iori-linux-setup-key-" +
        process.pid,
    ]);
    linux(
      `sudo install -o ${sh(user)} -g ${sh(user)} -m 600 /tmp/iori-linux-setup-key-${process.pid} ${sh(home + "/.ssh/id_ed25519")} && rm /tmp/iori-linux-setup-key-${process.pid}`,
    );
    const hosts = `Host iori-verification-host\n  HostName ${verificationLocal.linux.address}\n  User ${target}\n  IdentityFile ${home}/.ssh/id_ed25519\n  IdentityAgent none\n  IdentitiesOnly yes\n  UserKnownHostsFile ${home}/.ssh/known_hosts\n  StrictHostKeyChecking ask\n`;
    linux(
      asUser(
        `umask 077; printf %s ${sh(hosts)} > "$HOME/.ssh/hosts"; printf '%s\n' 'Include ~/.ssh/hosts' 'Host * !excluded' > "$HOME/.ssh/config"`,
        user,
      ),
    );
  }
  distribution = await startDistribution(state.setupRoot, {
    keepCredentials: true,
  });
  distribution.publish();
  stage("Linux deb Client launch");
  client = await startLinuxClient({
    root,
    executable: "/usr/bin/iori-linux-verification",
    evidence: output,
    result,
    user,
    isolated: false,
  });
  await client.screen.click(act("setup-host"));
  await waitSetup();
  assert.equal(
    await client.screen.attribute(act("setup-local"), "aria-checked"),
    "true",
  );
  assert.equal(
    await client.screen.visible('[data-iori-field="setup-allow-connections"]'),
    false,
  );
  await client.screenshot("local-default");
  record("this PC selected and Windows connection permission absent");
  if (scenario === "ssh") {
    stage("OpenSSH host key and passphrase");
    await client.screen.click(act("setup-ssh"));
    await client.screen.click('[data-iori-ssh-host="iori-verification-host"]');
    await client.screen.wait('[data-iori-state="ssh-prompt"]');
    assert.match(
      await client.screen.text('[data-iori-state="ssh-prompt"]'),
      /first connection|初めて接続します/u,
    );
    await client.screenshot("ssh-host-key");
    await client.screen.click(act("ssh-answer"));
    await client.screen.wait('[data-iori-field="ssh-answer"]');
    assert.match(
      await client.screen.text('[data-iori-state="ssh-prompt"]'),
      /passphrase|パスフレーズ/iu,
    );
    await client.screenshot("ssh-passphrase");
    await client.screen.input('[data-iori-field="ssh-answer"]', passphrase);
    await client.screen.click(act("ssh-answer"));
    await waitForOperation(
      "SSH destination",
      () => client.screen.visible('[data-iori-state="ssh-machine"]'),
      (visible) => visible,
      () => client.screen.text('[data-iori-state="error"]'),
    );
    assert.ok(
      (await client.screen.text('[data-iori-state="ssh-machine"]')).includes(
        target,
      ),
    );
    await client.screenshot("ssh-destination");
    record("OpenSSH Include candidate, host key and passphrase");
  }
  stage(scenario + " Host installation and registration");
  if (scenario === "local") {
    const sockets = linux('ss -H -lun "( sport = :49171 )"');
    assert.ok(
      sockets.includes(":49171"),
      "既定portを使用中のprocessを変更せずに競合条件を用意してください",
    );
    record("default port already occupied");
  }
  await client.screen.click(act("setup-submit"));
  await registered();
  await client.screenshot("registered");
  record("installed, registered and Direct connected");
  await openSettingsSection(client.screen, "settings-general");
  assert.equal(
    await client.screen.visible(act("general-close-to-exit")),
    false,
  );
  await client.screenshot("general-settings");
  record("close to exit setting absent on Linux");
  await openSettingsSection(client.screen, "open-connection");
  assert.equal(
    await client.screen.visible(act("allow-host-connections")),
    false,
  );
  record("Windows connection setting absent");
  if (scenario === "local") {
    stage("saved port and Host restart");
    const port = localHostPort();
    assert.ok(port > 0 && port !== 49171);
    const addresses = await client.screen.value('[data-iori-field="address"]');
    assert.ok(
      addresses.split("\n").every((address) => address.endsWith(":" + port)),
    );
    const uid = result.createdUsers.find(
      (account) => account.name === user,
    ).uid;
    const service = (script) =>
      linux(
        asUser(
          `XDG_RUNTIME_DIR=/run/user/${uid} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus ${script}`,
          user,
        ),
      );
    const previousPid = service(
      "systemctl --user show iori-host.service -p MainPID --value",
    );
    await openSettingsSection(client.screen, "open-host-version");
    await client.screen.click(act("host-restart"));
    await client.screen.wait(act("host-maintenance-confirm"));
    await client.screen.click(act("host-maintenance-confirm"));
    await waitForOperation(
      "Host restarted",
      () =>
        service("systemctl --user show iori-host.service -p MainPID --value"),
      (pid) => pid !== "0" && pid !== previousPid,
      () => client.screen.text('[data-iori-state="host-maintenance-error"]'),
    );
    await client.screen.wait('[data-iori-state="host-succeeded"]');
    await openSettingsSection(client.screen, "open-devices");
    await client.screen.wait('[data-iori-state="connected"]');
    assert.equal(localHostPort(), port);
    await openSettingsSection(client.screen, "open-connection");
    assert.equal(
      await client.screen.value('[data-iori-field="address"]'),
      addresses,
    );
    await client.screenshot("reconnected-after-restart");
    record(
      "alternative port persisted and Client reconnected after Host restart",
      { port },
    );
    stage("existing local Host registration");
    await client.screen.click(act("register-new-host"));
    await client.screen.click(act("setup-host"));
    await waitSetup();
    assert.match(
      await client.screen.text(act("setup-submit")),
      /Register|登録/u,
    );
    await client.screenshot("existing-local-host");
    const downloads = distribution.requests.filter((request) =>
      request.path.endsWith(".tar.gz"),
    ).length;
    await client.screen.click(act("setup-submit"));
    await registered();
    assert.equal(
      distribution.requests.filter((request) =>
        request.path.endsWith(".tar.gz"),
      ).length,
      downloads,
    );
    record("existing local Host registered without download");
    stage("local Host uninstall and receipt");
    await uninstallFromSettings(client, {
      deleteData: false,
      evidenceDirectory: output,
      record,
      removed: () =>
        waitForOperation(
          "local Host removed",
          () =>
            linux(
              asUser(
                'test -e "$HOME/.local/lib/iori-host/iori-host" && printf present || printf absent',
                user,
              ),
            ),
          (status) => status === "absent",
          () =>
            client.screen.text('[data-iori-state="host-maintenance-error"]'),
        ),
    });
    assert.equal(
      linux(
        asUser(
          'test -f "$HOME/.local/share/iori-host/host.sqlite" && printf retained',
          user,
        ),
      ),
      "retained",
    );
    record("local receipt read and data retained");
  }
  if (scenario === "ssh") {
    stage("SSH Host uninstall and receipt");
    await uninstallFromSettings(client, {
      deleteData: false,
      evidenceDirectory: output,
      record,
      answerPrompt: async () => {
        await client.screen.wait('[data-iori-field="ssh-answer"]');
        await client.screen.input('[data-iori-field="ssh-answer"]', passphrase);
        await client.screen.click(act("ssh-answer"));
      },
      removed: () =>
        waitForOperation(
          "SSH Host removed",
          () =>
            linux(
              asUser(
                'test -e "$HOME/.local/lib/iori-host/iori-host" && printf present || printf absent',
                target,
              ),
            ),
          (value) => value === "absent",
          () =>
            client.screen.text(
              '[data-iori-view="host-maintenance-confirmation"] [role="alert"]',
            ),
        ),
    });
    assert.equal(
      linux(
        asUser(
          'test -f "$HOME/.local/share/iori-host/host.sqlite" && printf retained',
          target,
        ),
      ),
      "retained",
    );
    record("SSH receipt read and data retained");
  }
  result.passed = true;
  delete result.operationAtFailure;
} catch (error) {
  result.error = error.message;
  try {
    await client?.screenshot("failure");
  } catch {
    /* Keep the original failure. */
  }
  process.exitCode = 1;
} finally {
  for (const [name, cleanup] of [
    ["Client", () => client?.stop()],
    ...result.createdUsers.map((account) => [
      "user " + account.name,
      () => {
        assert.equal(linux(`id -u ${sh(account.name)}`), account.uid);
        linux(
          `sudo loginctl disable-linger ${sh(account.name)} && sudo systemctl stop user@${account.uid}.service && sudo systemctl revert user-${account.uid}.slice && sudo userdel --remove ${sh(account.name)}`,
        );
        assert.equal(
          linux(`id -u ${sh(account.name)} 2>/dev/null || true`),
          "",
        );
        result.removedUsers.push(account.name);
      },
    ]),
    ["deb", () => installed && removeLinuxVerificationPackage(packageName)],
    ["distribution", () => distribution?.close()],
    ["SSH private key", () => rm(secret, { recursive: true, force: true })],
    [
      "build",
      async () => {
        if (!process.argv.includes("--cleanup-build")) return;
        cleanupFolders(state);
        await rm(state.setupRoot, { recursive: true, force: true });
      },
    ],
  ]) {
    try {
      await cleanup();
    } catch (error) {
      result.cleanupErrors.push({ name, message: error.message });
      process.exitCode = 1;
    }
  }
  result.requests = distribution?.requests;
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, evidence: output }));
}
