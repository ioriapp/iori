import assert from "node:assert/strict";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { registerApprovalCli } from "./fixtures/approval-definition.mjs";

async function setup(context, cli = "claude") {
  await registerApprovalCli(context.client, cli);
  const events = await context.client.events();
  const { terminal } = await context.client.request("cli.launch", {
    cliId: cli,
    cwd: context.dataRoot,
  });
  context.stage("承認用の台本の起動画面を待つ");
  const pty = await context.client.terminal(terminal.id);
  await pty.output("APPROVAL_READY");
  let previous;
  const ask = async (id, command = "echo approval") => {
    context.stage("台本の承認に回答できる状態を待つ");
    await pty.input(JSON.stringify({ id, command }) + "\r");
    const event = await events.waitFor(
      (e) =>
        e.type === "terminal.updated" &&
        e.terminal.id === terminal.id &&
        e.terminal.cliStatus?.attention?.approval?.id &&
        e.terminal.cliStatus.attention.approval.id !== previous,
    );
    previous = event.terminal.cliStatus.attention.approval.id;
    return event.terminal.cliStatus.attention.approval;
  };
  return {
    pty,
    ask,
    terminalId: terminal.id,
    respond: (approvalId, decision = "allow") =>
      context.client.request("terminal.approval.respond", {
        terminalId: terminal.id,
        approvalId,
        decision,
      }),
  };
}

test("スマホの許可をClaudeのhookへ返し状態を進める", (t) =>
  runHostTest(t, async (context) => {
    const { ask, respond, pty } = await setup(context);
    const command = "echo " + "x".repeat(5000) + " password=private-value";
    const approval = await ask("first", command);
    assert.equal(
      approval.command,
      command.replace("private-value", "[redacted]"),
    );
    assert.deepEqual(await respond(approval.id), { status: "sent" });
    const output = await pty.output("APPROVAL_RESULT:first:");
    assert.match(output, /\\"behavior\\":\\"allow\\"/u);
    await pty.output("APPROVAL_RESULT:PostToolUse:");
  }));

for (const [name, step] of [
  [
    "表示できる内容のない承認",
    { tool: "WebFetch", toolInput: { url: "https://example.com" } },
  ],
  ["64KiBを超える承認", { command: "x".repeat(65537) }],
]) {
  test(`${name}はCLIの画面で回答する`, (t) =>
    runHostTest(t, async (context) => {
      const { pty, terminalId } = await setup(context);
      const events = await context.client.events();
      await pty.input(JSON.stringify({ id: "unsupported", ...step }) + "\r");
      const event = await events.waitFor(
        (e) =>
          e.type === "terminal.updated" &&
          e.terminal.id === terminalId &&
          e.terminal.cliStatus?.attention?.kind === "approval",
      );
      assert.equal(event.terminal.cliStatus.attention.approval, undefined);
    }));
}

test("同じ承認への2回目の回答はstaleになる", (t) =>
  runHostTest(t, async (context) => {
    const { ask, respond, pty } = await setup(context);
    const approval = await ask("first");
    assert.deepEqual(await respond(approval.id), { status: "sent" });
    assert.deepEqual(await respond(approval.id, "deny"), { status: "stale" });
    assert.match(
      await pty.output("APPROVAL_RESULT:first:"),
      /\\"behavior\\":\\"allow\\"/u,
    );
  }));

test("承認の入れ替わり後に古いIDへ答えても新しい承認へ届かない", (t) =>
  runHostTest(t, async (context) => {
    const { ask, respond, pty } = await setup(context);
    const first = await ask("first");
    const second = await ask("second");
    assert.deepEqual(await respond(first.id), { status: "stale" });
    assert.deepEqual(await respond(second.id, "deny"), { status: "sent" });
    const output = await pty.output("APPROVAL_RESULT:second:");
    assert.match(output, /\\"behavior\\":\\"deny\\"/u);
  }));

test("Hostの再起動でhookはstdout無しで終わり新しい承認から答えられる", (t) =>
  runHostTest(t, async (context) => {
    const { ask, terminalId } = await setup(context);
    const first = await ask("first");
    const client = await context.restart();
    const restored = await client.terminal(terminalId);
    await restored.output('APPROVAL_RESULT:first:""');
    assert.deepEqual(
      await client.request("terminal.approval.respond", {
        terminalId,
        approvalId: first.id,
        decision: "allow",
      }),
      { status: "stale" },
    );
    const events = await client.events();
    await restored.input(JSON.stringify({ id: "next" }) + "\r");
    const event = await events.waitFor(
      (e) =>
        e.type === "terminal.updated" &&
        e.terminal.id === terminalId &&
        e.terminal.cliStatus?.attention?.approval,
    );
    assert.deepEqual(
      await client.request("terminal.approval.respond", {
        terminalId,
        approvalId: event.terminal.cliStatus.attention.approval.id,
        decision: "allow",
      }),
      { status: "sent" },
    );
    assert.match(
      await restored.output("APPROVAL_RESULT:next:"),
      /\\"behavior\\":\\"allow\\"/u,
    );
  }));

test("OpenCode V2のpluginは許可をonceで返す", (t) =>
  runHostTest(t, async (context) => {
    const { ask, respond, pty } = await setup(context, "opencode");
    const approval = await ask("request-one");
    assert.deepEqual(await respond(approval.id), { status: "sent" });
    const output = await pty.output("OPENCODE_REPLY:");
    assert.match(output, /"requestID":"request-one","decision":"once"/u);
  }));
