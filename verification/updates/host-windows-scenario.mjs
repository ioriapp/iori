import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { prepareHostDistribution } from "./host-distribution.mjs";
import { adapter } from "../../scripts/release/update-windows.mjs";
import { terminalClient } from "../terminal/daemon-client.mjs";
import { stopTerminalDaemon } from "../terminal/daemon-process.mjs";
import { waitFor } from "../ui.mjs";
const run = promisify(execFile);
const root = resolve(process.argv[2]),
  port = process.argv[3];
const data = join(root, "data"),
  hostRoot = join(data, "iori-host");
const result = { passed: false, attempts: [], node: process.version };
let fixture, client;
try {
  fixture = await prepareHostDistribution(root);
  process.env.LOCALAPPDATA = data;
  process.env.IORI_HOST_PORT = port;
  process.env.NODE_EXTRA_CA_CERTS = fixture.ca;
  await mkdir(data, { recursive: true });
  await (await adapter({ bundle: fixture.bundle })).start();
  client = await terminalClient(hostRoot, Number(port));
  const daemon = JSON.parse(
    await readFile(join(hostRoot, "terminal-daemon/connection.json"), "utf8"),
  );
  await writeFile(
    join(root, "pulse.mjs"),
    "import{writeFileSync}from'node:fs';let count=0;setInterval(()=>{console.log('WINDOWS_CONTINUITY_'+(++count));writeFileSync('pulse.json',JSON.stringify({pid:process.pid,count}));},250);\n",
  );
  const terminal = await client.request("terminal.create", {
    cwd: root,
    shell: "powershell",
  });
  let stream = await client.open(terminal.terminal.id);
  await waitFor(() => stream.snapshot);
  await stream.input(
    `& '${process.execPath.replaceAll("'", "''")}' pulse.mjs\r`,
  );
  const pulse = () =>
    readFile(join(root, "pulse.json"), "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
  const before = await waitFor(pulse, Boolean);
  const registration = await client.request("cli.definition.simple", {
    simple: {
      name: "Codex continuity verification",
      command: "codex --model gpt-6-luna",
      modelArgument: "",
    },
  });
  const cli = await client.request("cli.launch", {
    cwd: root,
    cliId: registration.cliId,
  });
  let cliScreen = await client.open(cli.terminal.id);
  await waitFor(() => cliScreen.snapshot && cliScreen.text.length > 0);
  const database = new DatabaseSync(join(hostRoot, "host.sqlite"));
  database.exec(
    "CREATE TABLE update_probe(value TEXT);INSERT INTO update_probe VALUES('before-update')",
  );
  database.close();
  async function reconnect() {
    return waitFor(async () => {
      try {
        await client.reconnect();
        return await client.request("host.info");
      } catch {
        return undefined;
      }
    }, Boolean);
  }
  async function continuity() {
    const current = JSON.parse(
      await readFile(join(hostRoot, "terminal-daemon/connection.json"), "utf8"),
    );
    assert.equal(current.pid, daemon.pid);
    const after = await waitFor(pulse, (value) => value?.count > before.count);
    assert.equal(after.pid, before.pid);
    stream = await client.open(terminal.terminal.id);
    cliScreen = await client.open(cli.terminal.id);
    await waitFor(() => stream.snapshot && cliScreen.snapshot);
    await waitFor(() => stream.text.includes("WINDOWS_CONTINUITY_"));
    const terminals = (await client.request("terminal.list")).terminals;
    assert.equal(
      Boolean(
        terminals.find((item) => item.id === cli.terminal.id)?.cliResumePending,
      ),
      false,
    );
  }
  async function update(expected) {
    const plan = await client.request("host.update.prepare", {
      version: fixture.version,
    });
    assert.equal(plan.error, undefined);
    assert.equal(plan.canContinue, true);
    const operation = await client.request("host.update", {
      version: fixture.version,
      canContinue: plan.canContinue,
      targets: [],
    });
    result.attempts.push({
      number: result.attempts.length + 1,
      expected,
      operationId: operation.operationId,
    });
    result.waitingFor = "new-instance";
    await waitFor(async () => {
      try {
        const info = await client.request("host.info");
        return info.instanceId !== original.instanceId ? info : undefined;
      } catch {
        return reconnect();
      }
    }, Boolean);
    result.waitingFor = "maintenance-result";
    const status = await waitFor(
      async () => {
        try {
          result.lastStatus = (
            await client.request("host.maintenance.status", {
              operationId: operation.operationId,
            })
          ).status;
          return result.lastStatus;
        } catch {
          await reconnect();
          return undefined;
        }
      },
      (value) => value?.phase === expected,
    );
    delete result.waitingFor;
    return status;
  }
  let original = await client.request("host.info");
  const failed = await update("failed");
  result.rollbackStatus = failed;
  assert.equal(failed.restored, true);
  assert.equal(
    await readFile(join(hostRoot, "failed-version-ran"), "utf8"),
    "yes",
  );
  const restored = new DatabaseSync(join(hostRoot, "host.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    restored.prepare("SELECT value FROM update_probe").get().value,
    "before-update",
  );
  restored.close();
  assert.equal((await client.request("host.info")).version, fixture.previous);
  await continuity();
  const retainedFile = join(hostRoot, "maintenance/previous-update.txt");
  const previousWork = await waitFor(
    () => readFile(retainedFile, "utf8").catch(() => undefined),
    Boolean,
  );
  fixture.publishGood();
  original = await client.request("host.info");
  await update("succeeded");
  assert.equal((await client.request("host.info")).version, fixture.version);
  await continuity();
  const currentWork = await waitFor(
    () => readFile(retainedFile, "utf8").catch(() => undefined),
    (value) => value && value !== previousWork,
  );
  assert.equal(
    await stat(previousWork).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal((await stat(join(currentWork, "previous"))).isDirectory(), true);
  assert.equal(
    (await stat(join(currentWork, "database/host.sqlite"))).isFile(),
    true,
  );
  result.backups = { previousRemoved: true, currentRetained: true };
  original = await client.request("host.info");
  const plan = await client.request("host.restart.prepare");
  await client.request("host.restart", {
    canContinue: plan.canContinue,
    targets: [],
  });
  await waitFor(async () => {
    try {
      const info = await client.request("host.info");
      return info.instanceId !== original.instanceId;
    } catch {
      await reconnect();
      return false;
    }
  });
  await continuity();
  result.passed = true;
  result.rollback = true;
  result.restart = true;
  result.terminalContinued = true;
  result.cliContinued = true;
} catch (error) {
  result.error = error.message;
  // Preserve the failing operation before the outer runner removes its folder.
  if (fixture) {
    try {
      const folders = await readdir(dirname(fixture.bundle));
      result.updateFolders = [];
      for (const name of folders.filter((name) =>
        name.startsWith(".iori-host-update-"),
      )) {
        const work = join(dirname(fixture.bundle), name);
        const request = JSON.parse(
          await readFile(join(work, "request.json"), "utf8"),
        );
        const exists = (path) =>
          stat(path).then(
            () => true,
            () => false,
          );
        result.updateFolders.push({
          operationId: request.status.operationId,
          status: JSON.parse(await readFile(request.statusFile, "utf8")),
          staged: await exists(join(work, "host")),
          previous: await exists(join(work, "previous")),
          failed: await exists(join(work, "failed")),
          bundle: await exists(fixture.bundle),
        });
      }
    } catch (diagnosticError) {
      result.diagnosticError = diagnosticError.code ?? "unknown";
    }
  }
  process.exitCode = 1;
} finally {
  await client?.close();
  if (fixture) {
    await run(process.execPath, [join(fixture.bundle, "stop.mjs")]);
    await run(process.execPath, [join(fixture.bundle, "stop.mjs")]);
    result.alreadyStopped = true;
    await stopTerminalDaemon(hostRoot);
    await fixture.close();
  }
  await writeFile(
    join(root, "host-update-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
