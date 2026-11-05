import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { local } from "../native/local.mjs";
import { windows, linux, ps, sh, gate } from "../native/remote.mjs";
import { evidence, command, writeWindows } from "../connection/build.mjs";
import {
  prepareWindowsClientStorage,
  cleanupWindowsClientStorage,
} from "../connection/client-storage.mjs";
import {
  startWindowsClient,
  findWindowsInteractiveSession,
} from "../connection/client.mjs";
import { startLinuxClient, asUser } from "../linux-client/client.mjs";
import { writeWindowsPrivateKey, windowsSshInclude } from "../native/ssh.mjs";
import { removeWindowsProgramRules } from "../native/windows-firewall.mjs";
import { cleanupFolders } from "../connection/cleanup.mjs";
import { startDistribution } from "../updates/distribution.mjs";
import { waitForOperation } from "../ui.mjs";
import { uninstallFromSettings } from "./uninstall-scenario.mjs";

function cleanupWindowsSshHost(hostRoot, { target, removeLogon, result }) {
  const bundle = hostRoot + "\\Programs\\iori-host";
  const tasks = JSON.parse(
    target(
      `$root=${ps(hostRoot)};$tasks=@(Get-ScheduledTask -TaskName 'iori-host-start-*' -ErrorAction SilentlyContinue | Where-Object {$arguments=$_.Actions.Arguments; while($arguments -match '-EncodedCommand ([A-Za-z0-9+/=]+)') { $arguments=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($matches[1])) };$arguments.Contains($root)});foreach($task in $tasks){Stop-ScheduledTask -InputObject $task -ErrorAction SilentlyContinue;Unregister-ScheduledTask -InputObject $task -Confirm:$false};ConvertTo-Json -InputObject @($tasks | Select-Object -ExpandProperty TaskName) -Compress`,
      "host.tasks",
    ),
  );
  result.removed.push({ remainingStartupTasks: tasks });
  target(
    `
if (Test-Path -LiteralPath ${ps(bundle + "\\runtime\\node.exe")}) {
    $previousLocalData = $env:LOCALAPPDATA
    try {
        $env:LOCALAPPDATA = ${ps(hostRoot)}
        & ${ps(bundle + "\\runtime\\node.exe")} ${ps(bundle + "\\stop.mjs")}
    } finally { $env:LOCALAPPDATA = $previousLocalData }
}
$root = ${ps(hostRoot)}
$processes = @(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\\',[StringComparison]::OrdinalIgnoreCase)})
$processes | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $root) { cmd.exe /c ('rd /s /q "\\\\?\\'+$root+'"') }
if (Test-Path -LiteralPath $root) { throw 'Host files remain' }
`,
    "host.program-and-data",
  );
  result.removed.push("Host program/data root");
  if (removeLogon) {
    target(
      `Remove-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'iori Host Setup Test' -ErrorAction SilentlyContinue;$path=[Environment]::GetEnvironmentVariable('Path','User');[Environment]::SetEnvironmentVariable('Path',(($path -split ';' | Where-Object {$_ -ine ${ps(bundle)}}) -join ';'),'User')`,
      "host.logon-and-path",
    );
    result.removed.push("Run entry and PATH entry");
  }
}

function removeWindowsSshUser(user, target, record) {
  const sid = target(`(Get-LocalUser -Name ${ps(user)}).SID.Value`, "user.sid");
  const profile = JSON.parse(
    target(
      `Get-CimInstance Win32_UserProfile | Where-Object SID -eq ${ps(sid)} | Select-Object Loaded,LocalPath | ConvertTo-Json -Compress`,
      "user.loaded",
    ),
  );
  if (profile.Loaded)
    throw new Error(
      `Windows profile remains loaded: ${user}, ${profile.LocalPath}`,
    );
  target(
    `Get-CimInstance Win32_UserProfile | Where-Object SID -eq ${ps(sid)} | Remove-CimInstance`,
    "user.profile",
  );
  target(`Remove-LocalUser -Name ${ps(user)}`, "user.account");
  record("Windows verification user and profile removed", { user, sid });
}

// Called only by run-ssh, which owns both machine locks and distribution lock.
export async function windowsSshScenario() {
  gate({ devices: [local.windows.host, local.linux.host] });
  const selectedClient = process.argv.includes("Linux") ? "Linux" : "Windows";
  const shell =
    process.argv.find((arg) => arg.startsWith("--shell="))?.slice(8) ?? "cmd";
  assert.ok(["cmd", "powershell"].includes(shell));
  const signedOut = process.argv.includes("--signed-out");
  const state = JSON.parse(
    await readFile(path.join(evidence, "build-state.json"), "utf8"),
  );
  const root = path.join(
    evidence,
    `windows-ssh-${selectedClient}-${shell}-${Date.now()}`,
  );
  await mkdir(root, { recursive: true });
  const result = {
    client: selectedClient,
    shell,
    signedOut,
    steps: [],
    created: [],
    removed: [],
    cleanup: {},
    commandFailures: [],
  };
  const record = (step, value = true) => {
    result.steps.push({ step, value });
    console.log(JSON.stringify({ step, value }));
  };
  const secret = await mkdtemp(path.resolve(".local/windows-ssh-key-"));
  const key = path.join(secret, "id_ed25519");
  const passphrase = randomBytes(24).toString("base64url");
  const user = signedOut
    ? "iori-ssh-" + randomBytes(4).toString("hex")
    : local.windows.user;
  const act = (name) => `[data-iori-action="${name}"]`;
  let client,
    distribution,
    originalShell,
    publicKey,
    windowsHome,
    hostRoot,
    ruleName,
    authorizedFile;
  let createdUser = false,
    profileCreated = false,
    preparedClient = false,
    include = false,
    debInstalled = false;
  let clientNumber = 0;
  let linuxClientUser;
  let caFile,
    downloadFile,
    caWritten = false,
    authorizedCreated = false;
  let originalKeys;
  let hostRootOwned = false;
  const target = (script, label = "remote") => {
    try {
      return windows(script, { diagnosticStdout: true });
    } catch (error) {
      result.commandFailures.push({
        label,
        exitCode: /failed \(exit (\d+)\)/u.exec(error.message)?.[1],
        message: error.message,
      });
      throw error;
    }
  };
  async function observe(selector, label) {
    await waitForOperation(
      label,
      async () => {
        await client.screen.evaluate(
          `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest',inline:'nearest'})`,
        );
        return client.screen.visible(selector);
      },
      Boolean,
      () => client.screen.text('[data-iori-state="error"]'),
    );
  }
  async function snapshot(name) {
    await writeFile(
      path.join(root, name + ".png"),
      Buffer.from(await client.browser.screenshot(), "base64"),
    );
  }
  async function launchClient() {
    clientNumber++;
    const config = `Host iori-windows-ssh-test\n  HostName ${local.windows.address}\n  User ${user}\n  IdentityAgent none\n  IdentitiesOnly yes\n  StrictHostKeyChecking ask\n`;
    if (selectedClient === "Windows") {
      const configRoot = state.windowsRoot + "\\client-local\\.ssh";
      target(`[IO.Directory]::CreateDirectory(${ps(configRoot)}) | Out-Null`);
      await writeWindowsPrivateKey(
        configRoot + "\\id_ed25519",
        await readFile(key, "utf8"),
      );
      await writeWindows(
        configRoot + "\\config",
        config +
          `  IdentityFile "${configRoot.replaceAll("\\", "/")}/id_ed25519"\n  UserKnownHostsFile "${configRoot.replaceAll("\\", "/")}/known_hosts"\n`,
      );
      windowsSshInclude(configRoot + "\\config");
      include = true;
      prepareWindowsClientStorage(state);
      preparedClient = true;
      client = await startWindowsClient(state);
    } else {
      const user = "iori-ssh-client-" + randomBytes(4).toString("hex");
      assert.equal(linux(`id -u ${sh(user)} 2>/dev/null || true`), "");
      linux(
        `sudo useradd --create-home --user-group --shell /bin/bash ${sh(user)}`,
      );
      const uid = linux(`id -u ${sh(user)}`);
      linuxClientUser = { user, uid };
      result.created.push("Linux Client user " + user);
      linux(
        `sudo systemctl start user@${uid}.service && sudo systemctl set-property --runtime user-${uid}.slice MemoryMax=4G MemorySwapMax=0`,
      );
      const clientRoot = `/home/${user}/verification`;
      const sshRoot = `/home/${user}/.ssh`;
      linux(asUser(`umask 077; mkdir -p ${sh(sshRoot)}`, user));
      await command("scp", [
        key,
        local.linux.host + ":/tmp/iori-windows-ssh-key-" + process.pid,
      ]);
      linux(
        `sudo install -o ${sh(user)} -g ${sh(user)} -m 600 /tmp/iori-windows-ssh-key-${process.pid} ${sh(sshRoot + "/id_ed25519")} && rm /tmp/iori-windows-ssh-key-${process.pid}`,
      );
      linux(
        asUser(
          `umask 077; printf %s ${sh(config + `  IdentityFile ${sshRoot}/id_ed25519\n  UserKnownHostsFile ${sshRoot}/known_hosts\n`)} > ${sh(sshRoot + "/config")}`,
          user,
        ),
      );
      client = await startLinuxClient({
        root: clientRoot,
        executable: "/usr/bin/iori-linux-verification",
        evidence: root,
        user,
        isolated: false,
      });
    }
  }
  async function closeClient() {
    await client?.stop();
    client = undefined;
    if (preparedClient) {
      cleanupWindowsClientStorage(state);
      preparedClient = false;
    }
    if (include) {
      windowsSshInclude();
      include = false;
    }
    if (linuxClientUser) {
      const { user, uid } = linuxClientUser;
      assert.equal(linux(`id -u ${sh(user)}`), uid);
      linux(
        `sudo systemctl stop user@${uid}.service && sudo systemctl revert user-${uid}.slice && sudo userdel --remove ${sh(user)}`,
      );
      result.removed.push("Linux Client user " + user);
      linuxClientUser = undefined;
    }
  }
  async function selectHost() {
    await client.screen.click(act("setup-host"));
    await client.screen.click(act("setup-ssh"));
    await client.screen.click('[data-iori-ssh-host="iori-windows-ssh-test"]');
    await observe('[data-iori-state="ssh-prompt"]', "OpenSSH confirmation");
    if (
      (await client.screen.text('[data-iori-state="ssh-prompt"]')).includes(
        "Are you sure",
      )
    ) {
      await snapshot("host-key-" + clientNumber);
      await client.screen.click(act("ssh-answer"));
    }
    await observe('[data-iori-field="ssh-answer"]', "SSH passphrase");
    assert.match(
      await client.screen.text('[data-iori-state="ssh-prompt"]'),
      /passphrase/iu,
    );
    await client.screen.input('[data-iori-field="ssh-answer"]', passphrase);
    await client.screen.click(act("ssh-answer"));
    await observe('[data-iori-state="ssh-machine"]', "Windows destination");
    assert.match(
      await client.screen.text('[data-iori-state="ssh-machine"]'),
      /Windows/u,
    );
  }
  try {
    const recovery = process.argv
      .find((arg) => arg.startsWith("--recover-user-result="))
      ?.slice("--recover-user-result=".length);
    if (recovery) {
      const previous = JSON.parse(await readFile(recovery, "utf8"));
      assert.equal(previous.signedOut, true);
      const owned = previous.created
        .map((value) =>
          typeof value === "string"
            ? /^user (iori-ssh-[a-f0-9]+)$/u.exec(value)?.[1]
            : undefined,
        )
        .filter(Boolean);
      assert.equal(owned.length, 1);
      await removeWindowsSshUser(owned[0], target, record);
      result.removed.push("previous Windows verification user " + owned[0]);
    }
    originalShell = JSON.parse(
      target(
        `$item=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\OpenSSH';@{exists=($null -ne $item.PSObject.Properties['DefaultShell']);value=$item.DefaultShell} | ConvertTo-Json -Compress`,
      ),
    );
    const shellPath =
      shell === "cmd"
        ? "$env:SystemRoot + '\\System32\\cmd.exe'"
        : "(Get-Command pwsh.exe -CommandType Application).Source";
    target(
      `Set-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell -Value (${shellPath})`,
    );
    record("DefaultShell changed", {
      shell,
      executable: target(
        "Get-ItemPropertyValue -LiteralPath 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell",
      ),
    });
    if (signedOut) {
      // No password or private key is written to logs or evidence.
      const password = randomBytes(32).toString("base64url") + "aA1!";
      const passwordFile = state.windowsRoot + "\\new-ssh-user.secret";
      await writeWindowsPrivateKey(passwordFile, password);
      const provision = `New-LocalUser -Name ${ps(user)} -Password (ConvertTo-SecureString ([IO.File]::ReadAllText(${ps(passwordFile)})) -AsPlainText -Force) -AccountNeverExpires | Out-Null;Add-LocalGroupMember -SID 'S-1-5-32-545' -Member ${ps(user)}`;
      const provisionFile = state.windowsRoot + "\\new-ssh-user.ps1";
      await writeWindows(provisionFile, provision);
      try {
        target(
          `try { & ([scriptblock]::Create([IO.File]::ReadAllText(${ps(provisionFile)}))) } catch { [Console]::Error.WriteLine($_.Exception.Message);exit 1 }`,
        );
        createdUser = true;
      } finally {
        target(
          `Remove-Item -LiteralPath ${ps(provisionFile)},${ps(passwordFile)} -Force`,
        );
      }
      result.created.push("user " + user);
      target(
        `Add-Type -TypeDefinition 'using System;using System.Text;using System.Runtime.InteropServices;public class SshProfile { [DllImport("userenv.dll",CharSet=CharSet.Unicode)] public static extern int CreateProfile(string sid,string name,StringBuilder path,uint length); }';$sid=(Get-LocalUser -Name ${ps(user)}).SID.Value;$buffer=[Text.StringBuilder]::new(260);$code=[SshProfile]::CreateProfile($sid,${ps(user)},$buffer,260);if($code -ne 0){throw ('profile failed: '+$code)};[Console]::WriteLine($buffer.ToString())`,
      );
      profileCreated = true;
    }
    windowsHome = signedOut
      ? target(
          `(Get-CimInstance Win32_UserProfile | Where-Object SID -eq (Get-LocalUser -Name ${ps(user)}).SID.Value).LocalPath`,
        )
      : local.windows.home;
    hostRoot = windowsHome + "\\AppData\\Local\\iori-ssh-host-verification";
    caFile = windowsHome + "\\.iori-ssh-setup-ca.pem";
    downloadFile = windowsHome + "\\.iori-ssh-setup-download.json";
    assert.equal(
      target(`Test-Path -LiteralPath ${ps(downloadFile)}`),
      "False",
      "前の取得の証拠を上書きしません",
    );
    assert.equal(
      target(`Test-Path -LiteralPath ${ps(hostRoot)}`),
      "False",
      "検証Hostの保存先が既にあります",
    );
    assert.equal(
      target(`Test-Path -LiteralPath ${ps(caFile)}`),
      "False",
      "検証CAが既にあります",
    );
    const program = hostRoot + "\\Programs\\iori-host\\runtime\\node.exe";
    ruleName =
      "iori-host-" +
      createHash("sha256")
        .update(program.toLowerCase())
        .digest("hex")
        .slice(0, 16)
        .toUpperCase();
    assert.equal(
      target(
        `@(Get-NetFirewallRule -Name ${ps(ruleName)} -ErrorAction SilentlyContinue).Count`,
      ),
      "0",
    );
    hostRootOwned = true;
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
        "iori-windows-ssh-verification",
      ],
      { stdio: "ignore" },
    );
    publicKey = (await readFile(key + ".pub", "utf8")).trim();
    authorizedFile = signedOut
      ? windowsHome + "\\.ssh\\authorized_keys"
      : target(
          `Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys'`,
        );
    originalKeys = target(
      `if(Test-Path -LiteralPath ${ps(authorizedFile)}){[Convert]::ToBase64String([IO.File]::ReadAllBytes(${ps(authorizedFile)}))}else{'missing'}`,
    );
    authorizedCreated = originalKeys === "missing";
    target(
      `[IO.Directory]::CreateDirectory((Split-Path ${ps(authorizedFile)})) | Out-Null;[IO.File]::AppendAllText(${ps(authorizedFile)},[Environment]::NewLine + ${ps(publicKey)} + [Environment]::NewLine,[Text.UTF8Encoding]::new($false))`,
    );
    if (signedOut) {
      target(
        `$sid=(Get-LocalUser -Name ${ps(user)}).SID;$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($who in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};Set-Acl -LiteralPath ${ps(windowsHome + "\\.ssh")} -AclObject $acl`,
      );
    }
    result.created.push("SSH authorized key");
    await writeWindows(
      caFile,
      await readFile(path.join(evidence, "distribution/tls/ca.pem"), "utf8"),
    );
    caWritten = true;
    result.created.push("temporary verification CA");
    distribution = await startDistribution(
      path.join(evidence, "distribution"),
      { keepCredentials: process.argv.includes("--keep-build") },
    );
    distribution.publish();
    if (selectedClient === "Linux") {
      assert.notEqual(
        linux(
          "dpkg-query -W -f='${db:Status-Status}' iori-linux-verification 2>/dev/null || true",
        ),
        "installed",
      );
      await command("scp", [
        path.join(evidence, "distribution/client/iori-linux-x64.deb"),
        local.linux.host +
          ":/tmp/iori-windows-ssh-client-" +
          process.pid +
          ".deb",
      ]);
      linux(
        `sudo dpkg -i /tmp/iori-windows-ssh-client-${process.pid}.deb && rm /tmp/iori-windows-ssh-client-${process.pid}.deb`,
      );
      debInstalled = true;
    }
    await launchClient();
    await selectHost();
    assert.equal(
      await client.screen.attribute(
        '[data-iori-field="setup-allow-connections"]',
        "data-state",
      ),
      "checked",
    );
    await snapshot("destination");
    await client.screen.click(act("setup-submit"));
    if (signedOut) {
      await observe(
        '[data-iori-state="setup-sign-in-required"]',
        "signed-out installation",
      );
      await observe(
        '[data-iori-state="setup-firewall-command"]',
        "nonadministrator firewall guidance",
      );
      const commandText = await client.screen.text(
        '[data-iori-field="setup-command"]',
      );
      assert.match(commandText, /^cmd\.exe \/d \/c /u);
      assert.equal(
        await client.screen.evaluate(`(()=>{
        const code=document.querySelector('[data-iori-field="setup-command"]');
        const row=code.closest('.setup-command');
        return code.scrollWidth<=code.clientWidth && row.scrollWidth<=row.clientWidth;
      })()`),
        true,
      );
      await client.screen.click(act("copy-setup-command"));
      await waitForOperation(
        "command copied",
        () => client.screen.text('[data-iori-action="copy-setup-command"]'),
        (value) => /Copied|コピーしました/u.test(value),
        () => client.screen.text('[role="alert"]'),
      );
      assert.equal(
        await client.screen.evaluate(
          "window.__TAURI__.core.invoke('native_clipboard_read')",
        ),
        commandText,
      );
      record("nonadministrator command wraps and copies", {
        length: commandText.length,
      });
      await snapshot("firewall-command-copied");
      assert.equal(
        target(
          `Test-Path -LiteralPath ${ps(hostRoot + "\\Programs\\iori-host\\iori-host.cmd")}`,
        ),
        "True",
      );
      assert.equal(
        target(
          `Test-Path -LiteralPath ${ps(hostRoot + "\\iori-host\\control.json")}`,
        ),
        "False",
      );
      // Read only this disposable user's hive while the SSH session has loaded it.
      assert.equal(
        target(
          `$sid=(Get-LocalUser -Name ${ps(user)}).SID.Value;[bool](Get-ItemPropertyValue -LiteralPath ('Registry::HKEY_USERS\\'+$sid+'\\Software\\Microsoft\\Windows\\CurrentVersion\\Run') -Name 'iori Host Setup Test')`,
        ),
        "True",
      );
      assert.equal(
        target(
          `@(Get-NetFirewallRule -Name ${ps(ruleName)} -ErrorAction SilentlyContinue).Count`,
        ),
        "0",
      );
      await client.screen.reveal('[data-iori-state="setup-sign-in-required"]');
      await snapshot("signed-out-guidance");
      record(
        "signed-out installation retained and nonadministrator command shown",
      );
      const cmdFile = state.windowsRoot + "\\permission-command.cmd";
      const powershellFile = state.windowsRoot + "\\permission-command.ps1";
      try {
        await writeWindows(cmdFile, "@echo off\r\n" + commandText + "\r\n");
        await writeWindows(powershellFile, commandText + "\r\n");
        for (const [shell, invocation] of [
          [
            "cmd",
            `& "$env:SystemRoot\\System32\\cmd.exe" /d /c ${ps(cmdFile)}`,
          ],
          [
            "Windows PowerShell 5.1",
            `& "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${ps(powershellFile)}`,
          ],
          [
            "PowerShell 7",
            `& (Get-Command pwsh.exe -CommandType Application).Source -NoProfile -NonInteractive -File ${ps(powershellFile)}`,
          ],
        ]) {
          const execution = JSON.parse(
            target(
              `$output=@(${invocation});$code=$LASTEXITCODE;@{exitCode=$code;lines=@($output | ForEach-Object {[string]$_})} | ConvertTo-Json -Compress`,
              "firewall.manual." + shell,
            ),
          );
          record("administrator permission command", { shell, ...execution });
          assert.equal(execution.exitCode, 0);
          assert.deepEqual(execution.lines, [
            "iori Host: connections from other devices are allowed.",
          ]);
        }
      } finally {
        target(
          `Remove-Item -LiteralPath ${ps(cmdFile)},${ps(powershellFile)} -Force -ErrorAction SilentlyContinue`,
          "firewall.manual.scripts",
        );
      }
    } else {
      await waitForOperation(
        "SSH setup registration",
        () => client.screen.visible('[data-iori-view="host-setup"]'),
        (v) => !v,
        () => client.screen.text('[data-iori-state="error"]'),
      );
      await client.screen.wait('[data-iori-view="workspace"]');
      assert.equal(
        target(
          `@(Get-NetFirewallRule -Name ${ps(ruleName)} -ErrorAction SilentlyContinue).Count`,
        ),
        "1",
      );
      const processes = JSON.parse(
        target(
          `ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq ${ps(program)}} | Select-Object ProcessId,SessionId) -Compress`,
        ),
      );
      assert.ok(processes.length > 0);
      const desktopSession = findWindowsInteractiveSession();
      assert.ok(
        processes.every((process) => process.SessionId === desktopSession),
      );
      record(
        "installed registered Direct connected and alive after SSH closed",
        { processes, desktopSession },
      );
      await snapshot("registered");
      await closeClient();
      await launchClient();
      await selectHost();
      assert.match(
        await client.screen.text(act("setup-submit")),
        /Register|登録/u,
      );
      const downloads = distribution.requests.filter((r) =>
        r.path.endsWith(".zip"),
      ).length;
      await client.screen.click(act("setup-submit"));
      await waitForOperation(
        "existing Host registration",
        () => client.screen.visible('[data-iori-view="host-setup"]'),
        (v) => !v,
        () => client.screen.text('[data-iori-state="error"]'),
      );
      assert.equal(
        distribution.requests.filter((r) => r.path.endsWith(".zip")).length,
        downloads,
      );
      record("existing Host registered without installation");
      await uninstallFromSettings(client, {
        deleteData: true,
        evidenceDirectory: root,
        record,
        answerPrompt: async () => {
          await observe(
            '[data-iori-field="ssh-answer"]',
            "uninstall SSH passphrase",
          );
          await client.screen.input(
            '[data-iori-field="ssh-answer"]',
            passphrase,
          );
          await client.screen.click(act("ssh-answer"));
        },
        removed: () =>
          waitForOperation(
            "Windows Host removal",
            () =>
              target(
                `Test-Path -LiteralPath ${ps(hostRoot + "\\Programs\\iori-host\\iori-host.cmd")}`,
              ),
            (v) => v === "False",
            () =>
              client.screen.text('[data-iori-state="host-maintenance-error"]'),
          ),
      });
      record("Windows uninstall result read over SSH");
    }
    result.created.push(
      "Host program/data root " + hostRoot,
      "Run entry iori Host Setup Test",
      "temporary startup task (removed by installer)",
    );
    if (!signedOut) result.created.push("firewall rule " + ruleName);
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = error.message;
    process.exitCode = 1;
  } finally {
    for (const [name, cleanup] of [
      [
        "download evidence",
        async () => {
          if (!downloadFile) return;
          const download = target(
            `$file=${ps(downloadFile)};if(Test-Path -LiteralPath $file){[IO.File]::ReadAllText($file);Remove-Item -LiteralPath $file}else{'null'}`,
            "download.evidence",
          );
          result.download = JSON.parse(download);
          await writeFile(
            path.join(root, "download.json"),
            JSON.stringify(result.download, null, 2),
          );
        },
      ],
      ["client", closeClient],
      [
        "host",
        () => {
          if (hostRootOwned)
            cleanupWindowsSshHost(hostRoot, {
              target,
              removeLogon: !signedOut,
              result,
            });
        },
      ],
      [
        "firewall",
        () => {
          if (hostRootOwned) {
            const removed = removeWindowsProgramRules(
              hostRoot + "\\Programs\\iori-host\\runtime\\node.exe",
            );
            assert.equal(removed.remaining, 0);
            result.removed.push({ firewall: removed.removed });
          }
        },
      ],
      [
        "authorized key",
        () => {
          if (originalKeys === undefined) return;
          if (authorizedCreated)
            target(
              `if(Test-Path -LiteralPath ${ps(authorizedFile)}){Remove-Item -LiteralPath ${ps(authorizedFile)}}`,
            );
          else
            target(
              `[IO.File]::WriteAllBytes(${ps(authorizedFile)},[Convert]::FromBase64String(${ps(originalKeys)}))`,
            );
          result.removed.push("SSH authorized key");
        },
      ],
      [
        "CA",
        () => {
          if (caWritten)
            target(`Remove-Item -LiteralPath ${ps(caFile)} -Force`);
        },
      ],
      [
        "user",
        async () => {
          if (createdUser) {
            if (profileCreated)
              await removeWindowsSshUser(user, target, record);
            else target(`Remove-LocalUser -Name ${ps(user)}`, "user.account");
            result.removed.push("user " + user);
          }
        },
      ],
      [
        "DefaultShell",
        () => {
          if (originalShell) {
            if (originalShell.exists)
              target(
                `Set-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell -Value ${ps(originalShell.value)}`,
              );
            else
              target(
                "Remove-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell -ErrorAction SilentlyContinue",
              );
            record("DefaultShell restored");
          }
        },
      ],
      [
        "deb",
        () => {
          if (debInstalled) linux("sudo dpkg -r iori-linux-verification");
        },
      ],
      ["distribution", () => distribution?.close()],
      ["key", () => rm(secret, { recursive: true, force: true })],
      [
        "build",
        async () => {
          if (!process.argv.includes("--keep-build"))
            await cleanupWindowsSshBuild();
        },
      ],
    ]) {
      try {
        await cleanup();
        result.cleanup[name] = true;
      } catch (error) {
        result.cleanup[name] = error.message;
        if (name === "host" && hostRootOwned) {
          try {
            result.hostCleanup = JSON.parse(
              target(
                `$root=${ps(hostRoot)};$exists=Test-Path -LiteralPath $root;@{root=$root;exists=$exists;folders=@(if($exists){Get-ChildItem -LiteralPath $root -Directory -Recurse -Force | Select-Object -ExpandProperty FullName});processes=@(Get-CimInstance Win32_Process | Where-Object {($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root+'\\',[StringComparison]::OrdinalIgnoreCase)) -or ($_.CommandLine -and $_.CommandLine.Contains($root))} | Select-Object ProcessId,Name,ExecutablePath,SessionId)} | ConvertTo-Json -Depth 4 -Compress`,
                "host.remaining",
              ),
            );
            await writeFile(
              path.join(root, "host-cleanup.json"),
              JSON.stringify(result.hostCleanup, null, 2),
            );
          } catch (diagnosticError) {
            result.hostCleanupError = diagnosticError.message;
          }
        }
        process.exitCode = 1;
      }
    }
    result.requests = distribution?.requests;
    await writeFile(
      path.join(root, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ root, ...result }));
  }
  assert.equal(result.passed, true);
  assert.ok(Object.values(result.cleanup).every((v) => v === true));
}

// Recovery after an interrupted verification; does not run another installation.
export async function cleanupWindowsSshBuild() {
  gate({
    devices: [local.windows.host, local.linux.host],
    requireFreePorts: false,
  });
  const state = JSON.parse(
    await readFile(path.join(evidence, "build-state.json"), "utf8"),
  );
  try {
    cleanupFolders(state);
  } finally {
    await rm(path.join(evidence, "distribution/tls"), {
      recursive: true,
      force: true,
    });
    await rm(path.join(evidence, "distribution/signing"), {
      recursive: true,
      force: true,
    });
  }
  console.log(
    JSON.stringify({
      cleanupBuild: true,
      removed: [
        "Windows build, Client SSH identity and source",
        "Linux build source",
        "local build source",
        "verification TLS and signing credentials",
      ],
    }),
  );
}

export async function cleanupWindowsSshHostOnly() {
  gate({ devices: [local.windows.host], requireFreePorts: false });
  const hostRoot =
    local.windows.home + "\\AppData\\Local\\iori-ssh-host-verification";
  const output = path.join(evidence, `host-cleanup-${Date.now()}.json`);
  const result = { root: hostRoot, removed: [], commands: [], passed: false };
  const target = (script, label) => {
    try {
      const value = windows(script, { diagnosticStdout: true });
      result.commands.push({ label, exitCode: 0 });
      return value;
    } catch (error) {
      result.commands.push({ label, message: error.message });
      throw error;
    }
  };
  const folders = () =>
    JSON.parse(
      target(
        `$root=${ps(hostRoot)};ConvertTo-Json -InputObject @('Programs','host-cli-home','iori-host-uninstall','Microsoft\\Windows\\Caches' | ForEach-Object {@{folder=$_;exists=(Test-Path -LiteralPath (Join-Path $root $_))}}) -Compress`,
        "host.folders",
      ),
    );
  try {
    result.before = folders();
    cleanupWindowsSshHost(hostRoot, { target, removeLogon: true, result });
    result.after = folders();
    assert.ok(result.after.every((item) => item.exists === false));
    assert.equal(
      target(`Test-Path -LiteralPath ${ps(hostRoot)}`, "host.root"),
      "False",
    );
    result.passed = true;
  } catch (error) {
    result.error = error.message;
    process.exitCode = 1;
  }
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, ...result }));
  assert.equal(result.passed, true);
}
