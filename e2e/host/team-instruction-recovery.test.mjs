import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { stopTerminalDaemon } from "../../verification/terminal/daemon-process.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";

async function launch(client, dataRoot) {
  const cli = await registerScriptedCli(client, dataRoot, { resumable: true });
  const team = await client.request("teams.create", {
    definition: {
      name: "Instruction recovery",
      description: "",
      instruction: "Keep this instruction.",
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
  const parent = await client.terminal(terminal.id);
  await parent.output("ACTOR_READY");
  const db = new DatabaseSync(join(dataRoot, "iori-host", "host.sqlite"), {
    readOnly: true,
  });
  let conversation;
  try {
    conversation = db
      .prepare("SELECT value_json FROM team_conversations")
      .all()
      .map((row) => JSON.parse(row.value_json))
      .find((row) => row.terminalId === terminal.id);
  } finally {
    db.close();
  }
  return {
    teamId: team.saved.id,
    terminalId: terminal.id,
    instructions: conversation.instructionFile,
    events,
  };
}

test("親の指示ファイルがなくても元のチーム版から復元して再開する", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const parent = await launch(client, dataRoot);
    const original = await readFile(parent.instructions, "utf8");
    stage("指示ファイルを失ってから検証Hostを再起動する");
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await parent.events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === parent.terminalId &&
        event.terminal.cliResumePending,
    );
    await rm(parent.instructions);
    const reconnected = await restart();
    stage("復元された指示で親を再開する");
    assert.equal(await readFile(parent.instructions, "utf8"), original);
    const pty = await reconnected.terminal(parent.terminalId);
    await reconnected.request("cli.resume", { terminalId: parent.terminalId });
    const output = await pty.output("ACTOR_INSTRUCTIONS:");
    assert.match(output, /Keep this instruction\./u);
    await actorCommand(pty, "tasks", ["tasks"]);
  }));

test("元のチームも指示ファイルもない親の再開は失敗を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const parent = await launch(client, dataRoot);
    stage("元のチームと指示ファイルをなくして検証Hostを再起動する");
    await client.request("teams.delete", { teamId: parent.teamId });
    await stopTerminalDaemon(join(dataRoot, "iori-host"));
    await parent.events.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === parent.terminalId &&
        event.terminal.cliResumePending,
    );
    await rm(parent.instructions);
    const reconnected = await restart();
    stage("親の再開に失敗が返る");
    await assert.rejects(
      reconnected.request("cli.resume", { terminalId: parent.terminalId }),
      /Host request failed: cli\.resume \(invalid_request\)/u,
    );
  }));
