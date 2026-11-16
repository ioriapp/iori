import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";
import { registerResponseCli } from "../../verification/host/response-definition.mjs";

// Hold the provider's first reply at the real usage script boundary. The
// allocator must use that reply even when delegate arrives before it does.
async function usageProvider(t) {
  const replies = [];
  let wake;
  const server = createServer((_request, response) => {
    replies.push(response);
    wake?.();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async requested() {
      while (!replies.length)
        await new Promise((resolve) => {
          wake = resolve;
        });
      wake = undefined;
    },
    async reply(value) {
      await this.requested();
      replies.shift().end(JSON.stringify(value));
    },
  };
}

async function setup(client, dataRoot, url, minimum = "50") {
  const cli = await registerScriptedCli(client, dataRoot, { resumable: true });
  const worker = await registerResponseCli(client, dataRoot);
  const folder = join(dataRoot, "iori-host", "cli-definitions", worker);
  const definition = JSON.parse(
    await readFile(join(folder, "definition.json"), "utf8"),
  );
  await writeFile(
    join(folder, "usage.mjs"),
    `console.log(await (await fetch(${JSON.stringify(url)})).text());\n`,
  );
  await client.request("cli.definition.save", {
    cliId: worker,
    definition: JSON.stringify({
      ...definition,
      usage: { script: "usage.mjs" },
    }),
  });
  const candidate = (id, cli, minimum = "") => ({
    id,
    cli,
    minimum,
    model: "",
    tools: [],
  });
  const team = await client.request("teams.create", {
    definition: {
      name: "Initial usage",
      description: "",
      instruction: "",
      parent: candidate("parent", cli),
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "",
          limit: "1",
          reuse: false,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: {
            high: [],
            low: [],
            medium: [candidate("worker-candidate", worker, minimum)],
          },
        },
      ],
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
  const parent = await client.terminal(terminal.id);
  await parent.output("ACTOR_READY");
  return { parent, terminalId: terminal.id };
}

const delegate = (parent, id) =>
  actorCommand(parent, id, [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    id,
    "--worktree",
    "parent",
    "--body",
    "AUTO_INTERRUPT",
  ]);

test("初回読み取り中は下限の候補を待たせ、下限以上と分かったら割り当てる", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const provider = await usageProvider(t);
    const { terminalId } = await setup(client, dataRoot, provider.url);
    client = await restart();
    const parent = await client.terminal(terminalId);
    await client.request("cli.list", {});
    await provider.requested();
    stage("初回の残量を待つ間は下限を設定した候補を割り当てない");
    const result = await delegate(parent, "waiting");
    assert.equal(result.data.waiting, "candidates");
    const { children } = await client.request("teams.children", {});
    const child = children.find((entry) => entry.id === result.data.child);
    assert.equal(child.state, "waiting");
    assert.equal(child.terminalId, undefined);
    const tasks = await actorCommand(parent, "waiting-tasks", ["tasks"]);
    assert.deepEqual(
      tasks.data.children.find((entry) => entry.child === result.data.child)
        .waitingReasons,
      [{ cli: "response-cli", reason: "usage", minimum: "50" }],
    );
    stage("読み取った残量が下限以上なら待っていた子を割り当てる");
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await provider.reply({ windows: [{ remaining: 80, minutes: 300 }] });
    const started = await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === result.data.child &&
        event.child.terminalId,
    );
    await (
      await client.terminal(started.child.terminalId)
    ).output("RESPONSE_ACTIVE");
  }));

test("初回読み取りが戻らなくても下限のない候補を割り当てる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const provider = await usageProvider(t);
    const { parent } = await setup(client, dataRoot, provider.url, "");
    await client.request("cli.list", {});
    await provider.requested();
    stage("読み取りを保留したまま下限のない候補へ割り当てる");
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const result = await delegate(parent, "no-minimum");
    const started = await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === result.data.child &&
        event.child.terminalId,
    );
    await (
      await client.terminal(started.child.terminalId)
    ).output("RESPONSE_ACTIVE");
  }));
