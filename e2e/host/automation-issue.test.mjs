import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { forgeFixture } from "../../verification/host/forge-fixture.mjs";
import {
  automationDefinition,
  delivered,
  launchedRun,
  registerAutomationCli,
} from "../../verification/host/automation-definition.mjs";

async function setup(t, client, dataRoot) {
  const forge = await forgeFixture(t, dataRoot);
  await client.request("forge.token.set", {
    origin: forge.origin,
    token: forge.token,
  });
  const cli = await registerAutomationCli(client, dataRoot);
  const definition = automationDefinition(cli, forge.repository, {
    issue: { label: "agent-ready" },
  });
  const { automation } = await client.request("automation.save", {
    definition,
  });
  return { forge, automation };
}

async function waitAutomation(client, id, predicate) {
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");
  for (;;) {
    const seen = events.values.length;
    const automation = (
      await client.request("automation.list")
    ).automations.find((item) => item.id === id);
    if (predicate(automation)) return automation;
    await events.waitFor(() => events.values.length > seen);
  }
}

test("他の人が付けたIssueのlabelでは自動化を始めない", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const { forge, automation } = await setup(t, client, dataRoot);
    const at = Date.now();
    forge.state.marks = [
      { number: 1, login: "someone-else", at },
      { number: 2, login: "owner", at: at + 1 },
    ];
    stage("古い他の人のlabelを飛ばして自分のIssueだけを始める");
    client = await restart();
    const run = await launchedRun(client, automation.id);
    assert.equal(run.issue.number, 2);
    assert.equal(
      (await client.request("automation.history", { id: automation.id })).runs
        .length,
      1,
    );
  }));

test("自分のIssueのlabelからworktreeで指示を渡し、前の作業が終わってから次を始める", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const { forge, automation } = await setup(t, client, dataRoot);
    const at = Date.now();
    forge.state.marks = [
      { number: 1, login: "owner", at },
      { number: 2, login: "owner", at: at + 1 },
    ];
    stage("Host起動時に古いlabelから順に作業を始める");
    client = await restart();
    const first = await launchedRun(
      client,
      automation.id,
      (run) => run.issue?.number === 1,
    );
    let terminal = await client.terminal(first.terminalId);
    const body = await delivered(terminal);
    assert.match(body, /Work on issue #1\./u);
    assert.match(body, /iori issue show 1/u);
    assert.match(body, /iori pr create --issue 1/u);
    assert.equal(body.includes("Issue body"), false);
    assert.equal(body.includes(forge.token), false);
    const running = (await client.request("terminal.list")).terminals.find(
      (item) => item.id === first.terminalId,
    );
    assert.equal(running.cwd, join(dataRoot, "repository-1-issue-1"));
    assert.equal(
      (await client.request("automation.history", { id: automation.id })).runs
        .length,
      1,
    );
    stage("作業中の次の見回りは、Forgeが復帰しても次のIssueを始めない");
    forge.state.unreachable = true;
    client = await restart();
    await waitAutomation(
      client,
      automation.id,
      (item) => item.issueError?.reason === "unreachable",
    );
    forge.state.unreachable = false;
    await waitAutomation(client, automation.id, (item) => !item.issueError);
    assert.equal(
      (await client.request("automation.history", { id: automation.id })).runs
        .length,
      1,
    );
    terminal = await client.terminal(first.terminalId);
    stage("前のCLIの終了hookを受けて、次の見回りで次のIssueを始める");
    await terminal.input(JSON.stringify({ id: "done", hook: "Stop" }) + "\r");
    await terminal.output("ACTOR_HOOK:done");
    const completed = (await client.request("terminal.list")).terminals.find(
      (item) => item.id === first.terminalId,
    ).cliStatus.since;
    client = await restart();
    const second = await launchedRun(
      client,
      automation.id,
      (run) => run.issue?.number === 2,
    );
    assert.ok(second.startedAt >= completed);
    assert.equal(
      (await client.request("automation.history", { id: automation.id })).runs
        .length,
      2,
    );
  }));
