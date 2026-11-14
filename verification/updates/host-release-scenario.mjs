import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { waitFor } from "../ui.mjs";

function descendants(all, pid) {
  const owned = all.filter((item) => item.ProcessId === pid);
  for (let i = 0; i < owned.length; i++) {
    for (const item of all)
      if (
        item.ParentProcessId === owned[i].ProcessId &&
        item.CreationDate >= owned[i].CreationDate &&
        !owned.includes(item)
      )
        owned.push(item);
  }
  return owned;
}
export async function runReleaseScenario({
  root,
  hostRoot,
  client,
  fixture,
  result,
  runningClis,
  checkpoint,
  processes,
  shell,
  shellCommand,
  setupTerminal,
  activeCommand,
  activePattern,
  pulseCommand,
  checkpointCliWait = false,
}) {
  const daemon = JSON.parse(
    await readFile(join(hostRoot, "terminal-daemon/connection.json"), "utf8"),
  );
  result.before = {
    ...(await client.request("host.info")),
    daemon: { pid: daemon.pid, version: daemon.version },
  };
  await setupTerminal(root);
  await checkpoint("start-terminal");
  const terminal = await client.request("terminal.create", {
    cwd: root,
    shell,
  });
  const stream = await client.open(terminal.terminal.id);
  await waitFor(() => stream.snapshot);
  if (runningClis) {
    await stream.input(activeCommand);
    await waitFor(() => activePattern.test(stream.text));
  } else {
    await stream.input(pulseCommand);
    result.activeProcess = await waitFor(
      () =>
        readFile(join(root, "pulse.json"), "utf8")
          .then(JSON.parse)
          .catch(() => undefined),
      Boolean,
    );
  }
  await checkpoint("start-cli");
  let clis;
  if (runningClis) {
    clis = [];
    const screens = [];
    for (const [cliId, args, prompt] of [
      ["claude", "--model claude-haiku-4-5", /❯[\s\S]*(?:shortcuts|Try\s*")/iu],
      ["codex", "--model gpt-6-luna", /Ask\s*Codex[\s\S]*GPT-6-Luna/iu],
    ]) {
      await client.request("cli.arguments.set", { cliId, arguments: args });
      if (checkpointCliWait) await checkpoint(`${cliId}-input-ready`);
      const cli = await client.request("cli.launch", { cwd: root, cliId });
      const screen = await client.open(cli.terminal.id);
      let pressedAt = 0;
      try {
        await waitFor(async () => {
          if (cliId === "claude") {
            const words = screen.text.replaceAll(/\s+/gu, "");
            const trust = words.lastIndexOf("Yes,Itrustthisfolder");
            const ready = Math.max(
              words.lastIndexOf("forshortcuts"),
              words.lastIndexOf('Try"'),
            );
            if (trust >= 0 && trust > ready) {
              if (Date.now() - pressedAt >= 500) {
                const no = words.lastIndexOf("❯No,exit");
                const yes = words.lastIndexOf("❯Yes,Itrustthisfolder");
                if (Math.max(no, yes) >= 0) {
                  await screen.input(no > yes ? "\u001b[B" : "\r");
                  pressedAt = Date.now();
                }
              }
              return false;
            }
          }
          const terminals = (await client.request("terminal.list")).terminals;
          const current = terminals.find((item) => item.id === cli.terminal.id);
          const status = current?.cliStatus;
          return (
            screen.snapshot &&
            prompt.test(screen.text) &&
            current?.cli?.id === cliId &&
            (status?.state === "idle" || !status)
          );
        });
      } catch (error) {
        const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
        const text = screen.text.slice(-4000);
        result.cliInputErrors ??= {};
        result.cliInputErrors[cliId] = token
          ? text.replaceAll(token, "[REDACTED]")
          : text;
        result.cliInputStatus = (
          await client.request("terminal.list")
        ).terminals.find((item) => item.id === cli.terminal.id)?.cliStatus;
        throw error;
      }
      clis.push(cli);
      screens.push({ cliId, cli, screen });
      await checkpoint(`${cliId}-input-ready`);
    }
    const terminals = (await client.request("terminal.list")).terminals;
    result.cliInputReady = screens.map(({ cliId, cli, screen }) => {
      const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const text = screen.text.slice(-4000);
      return {
        cliId,
        id: cli.terminal.id,
        cli: terminals.find((item) => item.id === cli.terminal.id)?.cli,
        cliStatus: terminals.find((item) => item.id === cli.terminal.id)
          ?.cliStatus,
        screen: token ? text.replaceAll(token, "[REDACTED]") : text,
      };
    });
    for (const cli of result.cliInputReady) {
      assert.equal(cli.cli?.id, cli.cliId);
      if (cli.cliStatus) assert.equal(cli.cliStatus.state, "idle");
    }
  } else {
    const registration = await client.request("cli.definition.simple", {
      simple: {
        name: "Shell update verification",
        command: shellCommand,
        modelArgument: "",
      },
    });
    const cli = await client.request("cli.launch", {
      cwd: root,
      cliId: registration.cliId,
    });
    const cliScreen = await client.open(cli.terminal.id);
    await waitFor(() => cliScreen.snapshot && cliScreen.text.length > 0);
    clis = [cli];
  }
  await checkpoint("prepare-update");
  if (runningClis) {
    result.before.processes = descendants(await processes(), daemon.pid);
    await checkpoint("prepare-update");
  }
  const plan = await client.request("host.update.prepare", {
    version: fixture.version,
  });
  assert.equal(plan.error, undefined);
  result.plan = plan;
  await checkpoint("request-update");
  const operation = await client.request("host.update", {
    version: fixture.version,
    canContinue: plan.canContinue,
    targets: plan.targets.map((target) => target.id),
  });
  result.attempts.push({
    operationId: operation.operationId,
    previous: fixture.previous,
    target: fixture.version,
  });
  await checkpoint("new-host-ready");
  await waitFor(async () => {
    try {
      await client.reconnect();
      const info = await client.request("host.info");
      return info.instanceId !== result.before.instanceId ? info : undefined;
    } catch {
      return undefined;
    }
  }, Boolean);
  await checkpoint("maintenance-result");
  await waitFor(
    async () => {
      result.lastStatus = (
        await client.request("host.maintenance.status", {
          operationId: operation.operationId,
        })
      ).status;
      return result.lastStatus;
    },
    (value) => value?.phase === "succeeded" || value?.phase === "failed",
  );
  assert.equal(result.lastStatus.phase, "succeeded");
  result.after = await client.request("host.info");
  assert.equal(result.after.version, fixture.version);
  const currentDaemon = JSON.parse(
    await readFile(join(hostRoot, "terminal-daemon/connection.json"), "utf8"),
  );
  result.after.daemon = {
    pid: currentDaemon.pid,
    version: currentDaemon.version,
  };
  if (plan.canContinue) {
    assert.equal(currentDaemon.pid, daemon.pid);
    const continued = await client.open(terminal.terminal.id);
    await waitFor(() => continued.snapshot);
    if (!runningClis) {
      const before = await stat(join(root, "pulse.json"));
      await waitFor(
        async () =>
          (await stat(join(root, "pulse.json"))).mtimeMs > before.mtimeMs,
      );
      assert.equal(
        JSON.parse(await readFile(join(root, "pulse.json"), "utf8")).pid,
        result.activeProcess.pid,
      );
    }
  }
  const { DAEMON_PROTOCOL } = await import(
    pathToFileURL(join(fixture.bundle, "src/terminal/daemon/protocol.js")).href
  );
  assert.equal(currentDaemon.version, DAEMON_PROTOCOL);
  if (!plan.canContinue) {
    assert.notEqual(currentDaemon.pid, daemon.pid);
    const terminals = (await client.request("terminal.list")).terminals;
    result.cliResumePending = clis.map((cli) => ({
      id: cli.terminal.id,
      pending: terminals.find((item) => item.id === cli.terminal.id)
        ?.cliResumePending,
      reason: terminals.find((item) => item.id === cli.terminal.id)
        ?.cliResumeReason,
    }));
    for (const cli of result.cliResumePending) assert.equal(cli.pending, true);
    if (runningClis) {
      const current = await processes();
      result.remainingOldProcesses = result.before.processes.filter((old) =>
        current.some(
          (item) =>
            item.ProcessId === old.ProcessId &&
            item.CreationDate === old.CreationDate,
        ),
      );
      assert.deepEqual(result.remainingOldProcesses, []);
    }
  }
  return result;
}
