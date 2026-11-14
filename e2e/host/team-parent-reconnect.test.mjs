import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { stopTerminalDaemon } from "../../apps/host/src/terminal/daemon/launch.ts";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";

async function launchParent(client, dataRoot) {
  const cli = await registerScriptedCli(client, dataRoot, { resumable: true });
  const team = await client.request("teams.create", {
    definition: {
      name: "Reconnect",
      description: "",
      instruction: "KEEP_TEAM_INSTRUCTIONS",
      parent: { id: "parent", cli, model: "", tools: [], minimum: "" },
      roles: [],
    },
  });
  await client.request("teams.settings", {
    enabled: true,
    defaultTeam: team.saved.id,
    limits: {},
  });
  const { terminal } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd: dataRoot,
  });
  const pty = await client.terminal(terminal.id);
  const startup = await readyStartup(pty);
  await actorCommand(pty, "before-loss", ["tasks"]);
  return { id: terminal.id, startup };
}

async function readyStartup(pty, previous) {
  const { output } = await pty.waitFor(({ output }) =>
    [...output.matchAll(/ACTOR_START:([^\r\n]+)\r?\n/gu)].some(
      ([, startup]) => startup !== previous,
    ),
  );
  return [...output.matchAll(/ACTOR_START:([^\r\n]+)\r?\n/gu)]
    .map(([, startup]) => startup)
    .find((startup) => startup !== previous);
}

test("デーモンと繋ぎ直した後も親をチームの指示とコマンドで再開できる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("チームの親からiori tasksを実行する");
    const parent = await launchParent(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("検証専用のデーモンを停止してHostの繋ぎ直しを待つ");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === parent.id &&
        event.terminal.cliResumePending,
    );
    stage("再開した台本CLIが新しい入力を受け付ける");
    const pty = await client.terminal(parent.id);
    await client.request("cli.resume", { terminalId: parent.id });
    const startup = await readyStartup(pty, parent.startup);
    stage("再開した親からiori tasksを実行する");
    await actorCommand(pty, "after-loss", ["tasks"]);
    const output = await pty.output(`ACTOR_INSTRUCTIONS:${startup}:`);
    assert.ok(
      output
        .slice(output.indexOf(`ACTOR_INSTRUCTIONS:${startup}:`))
        .includes("KEEP_TEAM_INSTRUCTIONS"),
    );
  }));

test("繋ぎ直し後のシェルが残っていてもHost再起動後に親をチームとして再開できる", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    stage("チームの親からiori tasksを実行する");
    const parent = await launchParent(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("検証専用のデーモンを停止してHostの繋ぎ直しを待つ");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === parent.id &&
        event.terminal.cliResumePending,
    );
    stage("親の画面を開いて再開前のシェルを起動する");
    const shell = await client.terminal(parent.id);
    await shell.input("printf '%s%s\\n' 'SURVIVING_' 'SHELL'\r");
    await shell.output("SURVIVING_SHELL");
    stage("シェルを残してHostを再起動する");
    const restarted = await restart();
    const pty = await restarted.terminal(parent.id);
    await restarted.request("cli.resume", { terminalId: parent.id });
    stage("再開した台本CLIが新しい入力を受け付ける");
    const startup = await readyStartup(pty, parent.startup);
    stage("Host再起動後の親からiori tasksを実行する");
    await actorCommand(pty, "after-host-restart", ["tasks"]);
    const output = await pty.output(`ACTOR_INSTRUCTIONS:${startup}:`);
    assert.ok(
      output
        .slice(output.indexOf(`ACTOR_INSTRUCTIONS:${startup}:`))
        .includes("KEEP_TEAM_INSTRUCTIONS"),
    );
  }));

test("チームの経路が同じなら親の再開で既存シェルの状態を保つ", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("チームの親からiori tasksを実行する");
    const parent = await launchParent(client, dataRoot);
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    stage("検証専用のデーモンを停止してHostの繋ぎ直しを待つ");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === parent.id &&
        event.terminal.cliResumePending,
    );
    stage("親の再開前のシェルに利用者の状態を設定する");
    const pty = await client.terminal(parent.id);
    await pty.input(
      "export IORI_TEST_SHELL_STATE=preserved; printf '%s%s\\n' 'SHELL_' 'PREPARED'\r",
    );
    await pty.output("SHELL_PREPARED");
    stage("同じ経路で親を再開する");
    await client.request("cli.resume", { terminalId: parent.id });
    await readyStartup(pty, parent.startup);
    await actorCommand(pty, "same-route", ["tasks"]);
    const output = await pty.output("ACTOR_RESULT:same-route:");
    assert.ok(output.includes("ACTOR_SHELL_STATE:preserved"));
  }));

test("最初の指示を引数で受けるCLIの親は、再開の時に指示を受け直さない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("最初の指示を引数で受けるCLIでチームの親を始める");
    const cli = await registerScriptedCli(client, dataRoot, {
      promptArgument: true,
    });
    const team = await client.request("teams.create", {
      definition: {
        name: "Prompt argument",
        description: "",
        instruction: "",
        parent: { id: "parent", cli, model: "", tools: [], minimum: "" },
        roles: [],
      },
    });
    await client.request("teams.settings", {
      enabled: true,
      defaultTeam: team.saved.id,
      limits: {},
    });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    let pty = await client.terminal(terminal.id);
    const startup = await readyStartup(pty);
    const argument = async (id) => {
      const prefix = `ACTOR_PROMPT_ARGUMENT:${id}:`;
      const { output } = await pty.waitFor(({ output }) =>
        new RegExp(`${prefix}[^\\r\\n]*\\r?\\n`, "u").test(output),
      );
      const start = output.indexOf(prefix) + prefix.length;
      const end = output.indexOf("\n", start);
      return JSON.parse(output.slice(start, end).trim());
    };
    stage("最初の起動は指示のファイルを読む指示を引数で受け取る");
    assert.match(
      await argument(startup),
      /^Read .+ and follow its instructions\.$/u,
    );
    await actorCommand(pty, "before-loss", ["tasks"]);
    stage("検証専用のデーモンを停止してHostの繋ぎ直しを待つ");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === terminal.id &&
        event.terminal.cliResumePending,
    );
    stage("再開した起動は指示を引数で受け取らない");
    pty = await client.terminal(terminal.id);
    await client.request("cli.resume", { terminalId: terminal.id });
    const resumed = await readyStartup(pty, startup);
    assert.equal(await argument(resumed), null);
  }));
