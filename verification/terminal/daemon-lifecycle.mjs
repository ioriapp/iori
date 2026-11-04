import {
  inspectNamedPipe,
  verifyPipePermissions,
} from "./pipe-permissions.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, cp, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { terminalClient } from "./daemon-client.mjs";
import {
  boundTerminalDaemon,
  stopTerminalDaemon,
  terminalDaemonEvidence,
} from "./daemon-process.mjs";
import { verificationHostEnvironment } from "../cli/environment.mjs";
import { waitFor } from "../ui.mjs";

const run = promisify(execFile);
const windows = process.platform === "win32";
const root = resolve(process.argv[2]);
const bundle = join(root, "bundle");
const data = join(root, "data");
const hostRoot = join(data, "iori-host");
const port = Number(process.argv[3]);
const unit = `iori-terminal-verification-${randomUUID()}`;
const env = {
  ...verificationHostEnvironment(),
  IORI_HOST_PORT: String(port),
  ...(windows ? { LOCALAPPDATA: data } : { XDG_DATA_HOME: data }),
};
const ps = (value) => `'${String(value).replaceAll("'", "''")}'`;
const powershell = (script) =>
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        "$ErrorActionPreference='Stop';" + script,
        "utf16le",
      ).toString("base64"),
    ],
    { env },
  );
let client,
  started = false;
const result = { passed: false, os: process.platform };
await mkdir(root, { recursive: true });
await mkdir(data, { recursive: true });
const start = async () => {
  if (windows)
    await powershell(`$p=Start-Process -FilePath ${ps(join(bundle, "iori-host-background.exe"))} -WorkingDirectory ${ps(bundle)} -ArgumentList ${ps('"' + join(root, "startup-error.txt") + '"')} -PassThru;
$ready=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,('Local\\iori-host-ready-'+$p.Id));
$exited=[Threading.ManualResetEvent]::new($false);$exited.SafeWaitHandle=[Microsoft.Win32.SafeHandles.SafeWaitHandle]::new($p.Handle,$false);
try{$null=[Threading.WaitHandle]::WaitAny([Threading.WaitHandle[]]@($exited,$ready));if($p.HasExited){throw ('Host launcher exited: '+[IO.File]::ReadAllText(${ps(join(root, "startup-error.txt"))}));}}finally{$exited.Dispose();$ready.Dispose();$p.Dispose();}`);
  else
    await run(
      "systemd-run",
      [
        "--user",
        "--quiet",
        "--collect",
        `--unit=${unit}`,
        "--property=Type=notify",
        "--property=NotifyAccess=all",
        "--property=MemoryMax=4G",
        "--property=MemorySwapMax=0",
        `--working-directory=${root}`,
        ...Object.keys(env).map((key) => `--setenv=${key}`),
        join(bundle, "runtime", "node"),
        join(bundle, "service.mjs"),
      ],
      { env },
    );
  started = true;
  await boundTerminalDaemon(hostRoot);
  await waitFor(() =>
    readFile(join(hostRoot, "control.json")).then(
      () => true,
      () => false,
    ),
  );
};
const stop = async () => {
  if (!started) return;
  if (windows) await run(process.execPath, [join(bundle, "stop.mjs")], { env });
  else await run("systemctl", ["--user", "stop", unit]);
  started = false;
};
try {
  if (windows) result.pipePermissions = await verifyPipePermissions();
  if (windows) await cp(bundle, join(root, "replacement"), { recursive: true });
  await writeFile(
    join(root, "pulse.mjs"),
    `import{writeFile,rename,access}from'node:fs/promises';let count=0;for(;;){const marker='LIFECYCLE_CONTINUITY_'+(++count);console.log(marker);await writeFile('pulse.tmp',JSON.stringify({pid:process.pid,count,marker}));await rename('pulse.tmp','pulse.json');if(await access('pulse.stop').then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,250));}`,
  );
  await start();
  const descriptor = JSON.parse(
    await readFile(
      join(hostRoot, "terminal-daemon", "connection.json"),
      "utf8",
    ),
  );
  if (windows) {
    const permissions = await inspectNamedPipe(descriptor.endpoint);
    assert.equal(permissions.onlyCurrentUser, true);
    result.daemonPipeOnlyCurrentUser = true;
  }
  client = await terminalClient(hostRoot, port);
  const created = await client.request("terminal.create", {
    cwd: root,
    ...(windows ? { shell: "powershell" } : {}),
  });
  const terminalId = created.terminal.id;
  let screen = await client.open(terminalId);
  result.step = "initial terminal stream";
  await waitFor(() => {
    if (screen.error) throw screen.error;
    return screen.snapshot;
  });
  const quote = windows ? ps : (value) => `'${value.replaceAll("'", "'\\''")}'`;
  await screen.input(
    `${windows ? "& " : ""}${quote(process.execPath)} ${quote(join(root, "pulse.mjs"))}\r`,
  );
  const pulse = () =>
    readFile(join(root, "pulse.json"), "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
  result.step = "initial terminal output";
  const before = await waitFor(pulse, Boolean);
  await waitFor(() => screen.text.includes(before.marker));
  let during;
  if (windows) {
    await stop();
    const stoppedAt = await pulse();
    during = await waitFor(
      pulse,
      (value) => value?.count > stoppedAt.count + 2,
    );
    await rename(bundle, join(root, "previous"));
    await rename(join(root, "replacement"), bundle);
    await rm(join(root, "previous"), { recursive: true, force: true });
    result.installDirectoryReplaced = true;
    await start();
  } else {
    result.step = "systemd restart";
    await run("systemctl", ["--user", "restart", unit]);
    during = await waitFor(pulse, (value) => value?.count > before.count + 2);
    result.systemdRestart = true;
  }
  result.step = "reconnect";
  await client.reconnect();
  const listed = await client.request("terminal.list");
  const terminal = listed.terminals.find((t) => t.id === terminalId);
  assert.equal(terminal?.state, "running");
  assert.equal(terminal?.restartPending, false);
  screen = await client.open(terminalId);
  await waitFor(() => screen.snapshot && screen.text.includes(during.marker));
  const after = await waitFor(pulse, (value) => value?.count > during.count);
  assert.equal(before.pid, during.pid);
  assert.equal(before.pid, after.pid);
  const reconnected = JSON.parse(
    await readFile(
      join(hostRoot, "terminal-daemon", "connection.json"),
      "utf8",
    ),
  );
  assert.equal(descriptor.pid, reconnected.pid);
  result.sameDaemon = true;
  result.samePtyProcess = true;
  result.outputRestored = true;
  await writeFile(join(root, "pulse.stop"), "stop");
  result.step = "complete";
  result.passed = true;
} catch (error) {
  result.error = error.stderr
    ? String(error.stderr)
        .replace(/<[^>]+>/g, " ")
        .replace(/_x000D_|_x000A_/g, " ")
        .slice(-1800)
    : error.message;
  result.daemonStartup = await readFile(
    join(hostRoot, "terminal-daemon", "startup.log"),
    "utf8",
  ).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await client?.close();
  await stop();
  await stopTerminalDaemon(hostRoot);
  result.daemonUnits = terminalDaemonEvidence();
  await writeFile(
    join(root, "lifecycle-result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
}
// The probe owns its native endpoint, and has completed all explicit cleanup.
process.exit(process.exitCode ?? 0);
