import assert from "node:assert/strict";
import test from "node:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runHostTest } from "../../verification/host/process.mjs";
import { registerScriptedCli } from "../../verification/host/scripted-definition.mjs";

function confirmed(plan) {
  return {
    canContinue: plan.canContinue,
    hasOpenTerminals: plan.hasOpenTerminals,
    targets: plan.targets.map((target) => target.id),
    generations: Object.fromEntries(
      plan.targets.map((target) => [target.id, target.generation]),
    ),
    deleteData: false,
  };
}

test("確認後に同じCLIで新しい作業が始まると再確認する", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const cliId = await registerScriptedCli(client, dataRoot);
      const { terminal: created } = await client.request("cli.launch", {
        cliId,
        cwd: dataRoot,
      });
      const terminal = await client.terminal(created.id);
      await terminal.output("ACTOR_READY");
      const hook = async (id, event) => {
        await terminal.input(JSON.stringify({ id, hook: event }) + "\r");
        await terminal.output(`ACTOR_HOOK:${id}`);
      };
      await hook("first", "UserPromptSubmit");
      const plan = await client.request("host.uninstall.prepare");
      assert.ok(plan.targets.some((target) => target.id === created.id));
      await hook("done", "Stop");
      await hook("second", "UserPromptSubmit");
      const result = await client.request("host.uninstall", confirmed(plan));
      assert.equal(result.phase, "failed");
      assert.ok(
        result.plan?.targets.some((target) => target.id === created.id),
      );
    },
    { maintenance: true },
  ));

test("確認後に待機中のTerminalが開いた場合は再確認する", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const plan = await client.request("host.uninstall.prepare");
      assert.equal(plan.hasOpenTerminals, false);
      await client.request("terminal.create", { cwd: dataRoot, shell: "bash" });
      const result = await client.request("host.uninstall", confirmed(plan));
      assert.equal(result.phase, "failed");
      assert.equal(result.plan?.hasOpenTerminals, true);
    },
    { maintenance: true },
  ));

test("確認したTerminalのコマンドが替わっても再確認しない", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const { terminal: created } = await client.request("terminal.create", {
        cwd: dataRoot,
        shell: "bash",
      });
      const terminal = await client.terminal(created.id);
      await terminal.input(
        "i=0; while true; do i=$((i+1)); printf 'LOOP_%s\\n' \"$i\"; /bin/sleep 2; done\r",
      );
      await terminal.output("LOOP_1");
      const plan = await client.request("host.uninstall.prepare");
      assert.ok(plan.targets.some((target) => target.id === created.id));
      await terminal.output("LOOP_2");
      const result = await client.request("host.uninstall", confirmed(plan));
      assert.equal(result.plan, undefined);
      assert.equal(result.reason, "uninstall");
      assert.ok(result.stage);
    },
    { maintenance: true },
  ));

test("確認後に待機中のTerminalでコマンドが始まると再確認する", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const { terminal: created } = await client.request("terminal.create", {
        cwd: dataRoot,
        shell: "bash",
      });
      const terminal = await client.terminal(created.id);
      await terminal.input("printf 'SHELL_%s\\n' READY\r");
      await terminal.output("SHELL_READY");
      const plan = await client.request("host.uninstall.prepare");
      assert.equal(plan.hasOpenTerminals, true);
      assert.ok(!plan.targets.some((target) => target.id === created.id));
      await terminal.input(
        "sh -c 'printf %s%s COMMAND_ STARTED; exec /bin/sleep 300'\r",
      );
      await terminal.output("COMMAND_STARTED");
      const result = await client.request("host.uninstall", confirmed(plan));
      assert.equal(result.phase, "failed");
      assert.ok(
        result.plan?.targets.some((target) => target.id === created.id),
      );
    },
    { maintenance: true },
  ));

test("確認済みのCLIの作業が終わっただけなら再確認しない", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const cliId = await registerScriptedCli(client, dataRoot);
      const { terminal: created } = await client.request("cli.launch", {
        cliId,
        cwd: dataRoot,
      });
      const terminal = await client.terminal(created.id);
      await terminal.output("ACTOR_READY");
      await terminal.input(
        JSON.stringify({ id: "start", hook: "UserPromptSubmit" }) + "\r",
      );
      await terminal.output("ACTOR_HOOK:start");
      const plan = await client.request("host.uninstall.prepare");
      assert.ok(plan.targets.some((target) => target.id === created.id));
      await terminal.input(JSON.stringify({ id: "done", hook: "Stop" }) + "\r");
      await terminal.output("ACTOR_HOOK:done");
      const result = await client.request("host.uninstall", confirmed(plan));
      assert.equal(result.plan, undefined);
    },
    { maintenance: true },
  ));

test("確認済みのCLIが同じ作業で承認待ちに変わっても再確認しない", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const cliId = await registerScriptedCli(client, dataRoot, {
        waiting: true,
      });
      const events = await client.events();
      await events.waitFor((event) => event.type === "snapshot");
      const { terminal: created } = await client.request("cli.launch", {
        cliId,
        cwd: dataRoot,
      });
      const terminal = await client.terminal(created.id);
      await terminal.output("ACTOR_READY");
      await terminal.input(
        JSON.stringify({ id: "start", hook: "UserPromptSubmit" }) + "\r",
      );
      await terminal.output("ACTOR_HOOK:start");
      const plan = await client.request("host.uninstall.prepare");
      assert.ok(plan.targets.some((target) => target.id === created.id));
      await terminal.input(
        JSON.stringify({
          id: "approval",
          hook: "PermissionRequest",
          payload: { tool_name: "shell" },
        }) + "\r",
      );
      await events.waitFor(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.state === "waiting",
      );
      const result = await client.request("host.uninstall", confirmed(plan));
      assert.equal(result.plan, undefined);
    },
    { maintenance: true },
  ));

test("失敗した再起動の結果を後のHost起動後も保持する", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot, restart }) => {
      const systemctl = join(dataRoot, "bin", "systemctl");
      await rm(systemctl, { force: true });
      await writeFile(systemctl, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      const events = await client.events();
      await events.waitFor((event) => event.type === "snapshot");
      const started = await client.request("host.restart", {
        canContinue: true,
        targets: [],
      });
      assert.equal(started.phase, "restarting");
      await events.waitFor(
        (event) =>
          event.type === "host.maintenance.changed" &&
          event.status.operationId === started.operationId &&
          event.status.phase === "failed",
      );
      client = await restart();
      const { status } = await client.request("host.maintenance.status", {
        operationId: started.operationId,
      });
      assert.equal(status.phase, "failed");
      assert.equal(status.reason, "restart");
    },
    { maintenance: true },
  ));
