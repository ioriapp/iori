import assert from "node:assert/strict";
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import {
  actorCommand,
  registerScriptedCli,
} from "../../verification/host/scripted-definition.mjs";
import { registerResponseCli } from "../../verification/host/response-definition.mjs";

async function responseTurn(child, turn) {
  const output = await child.output(`RESPONSE_TURN_DONE:${turn}`);
  for (const match of output.matchAll(/RESPONSE_COMMAND:([^\r\n]+)/gu)) {
    const result = JSON.parse(match[1]);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  return output;
}

async function launchChild(
  client,
  dataRoot,
  body = "Do the work.",
  { muse = false, tokensScript } = {},
) {
  const parentCli = await registerScriptedCli(client, dataRoot, {
    noReady: true,
  });
  const cli =
    muse || tokensScript
      ? await registerScriptedCli(client, dataRoot, {
          id: tokensScript ? "scripted-tokens" : "muse-code",
          resumable: true,
          observeEnvironment: true,
        })
      : await registerResponseCli(client, dataRoot);
  if (tokensScript) {
    const definition = JSON.parse(
      await readFile(
        join(dataRoot, "iori-host", "cli-definitions", cli, "definition.json"),
        "utf8",
      ),
    );
    const uploadId = crypto.randomUUID();
    await client.request("cli.definition.file.write", {
      uploadId,
      first: true,
      data: Buffer.from(tokensScript).toString("base64"),
    });
    const saved = await client.request("cli.definition.save", {
      definition: JSON.stringify({
        ...definition,
        tokens: { script: "tokens.mjs" },
      }),
      files: [{ name: "tokens.mjs", uploadId }],
    });
    assert.equal(saved.cliId, cli, JSON.stringify(saved));
  }
  const candidate = { id: "candidate", cli, model: "", tools: [], minimum: "" };
  const team = await client.request("teams.create", {
    definition: {
      name: "Messages",
      description: "",
      instruction: "",
      parent: { ...candidate, id: "parent", cli: parentCli },
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "",
          limit: "",
          reuse: true,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { high: [], medium: [candidate], low: [] },
        },
      ],
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
  await parent.output("NO_READY_SCREEN");
  await parent.output("INITIAL_REQUEST_RECEIVED:");
  const delegated = await actorCommand(parent, "delegate", [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Messages",
    "--worktree",
    "parent",
    "--body",
    body,
  ]);
  const childId = delegated.data.child;
  const started = await events.waitFor(
    (event) =>
      event.type === "teams.child.updated" &&
      event.child.id === childId &&
      event.child.terminalId,
  );
  const child = await client.terminal(started.child.terminalId);
  if (muse || tokensScript) await child.output("ACTOR_READY");
  else {
    await child.output("RESPONSE_READY");
    await responseTurn(child, 1);
  }
  return {
    parent,
    child,
    childId,
    events,
    delegated,
    terminalId: started.child.terminalId,
  };
}

test("子の再開でもCLI定義の起動時の環境変数を渡す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { parent, child, childId, terminalId, events } = await launchChild(
      client,
      dataRoot,
      "Do the work.",
      { muse: true },
    );
    assert.match(
      await child.output("ACTOR_LAUNCH_ENV:"),
      /ACTOR_LAUNCH_ENV:present/u,
    );
    stage("子を停止して同じ会話を再開する");
    await actorCommand(parent, "stop", ["stop", childId]);
    await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === childId &&
        event.child.state === "stopped",
    );
    await actorCommand(parent, "resume", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "Continue after stopping.",
    ]);
    const { output } = await client.terminalUntil(
      terminalId,
      ({ output }) => (output.match(/ACTOR_LAUNCH_ENV:/gu) ?? []).length >= 2,
    );
    assert.equal(
      [...output.matchAll(/ACTOR_LAUNCH_ENV:(present|missing)/gu)].at(-1)?.[1],
      "present",
    );
  }));

test("子の報告が親に通知され、親が本文を読める", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親から子へ委譲し、子が報告する");
    const { parent, childId, events } = await launchChild(
      client,
      dataRoot,
      "AUTO_REPORT_COMPLETED",
    );
    await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === childId &&
        event.child.state === "reported",
    );
    await parent.output("reported");
    stage("親が報告の本文を読む");
    const result = await actorCommand(parent, "read", ["read", childId]);
    assert.match(JSON.stringify(result), /Completed the work\./u);
  }));

test("子の質問を親が読み、回答を子へ届ける", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親から子へ委譲し、子が質問する");
    const { parent, child, childId, events } = await launchChild(
      client,
      dataRoot,
      "AUTO_ASK",
    );
    await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === childId &&
        event.child.state === "question",
    );
    await parent.output("asked a question");
    const result = await actorCommand(parent, "read", ["read", childId]);
    assert.match(JSON.stringify(result), /May I finish\?/u);
    stage("親の回答が子に届く");
    await actorCommand(parent, "answer", [
      "send",
      childId,
      "--kind",
      "answer",
      "--body",
      "Yes, finish.",
    ]);
    const output = await responseTurn(child, 2);
    const bodies = [...output.matchAll(/RESPONSE_BODY:([^\r\n]+)/gu)];
    assert.equal(JSON.parse(bodies.at(-1)[1]), "Yes, finish.");
  }));

test("トークン量のスクリプトが終了しなくても子の質問と報告が親へ届く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const release = join(dataRoot, "tokens-release");
    const unblock = () => writeFile(release, "done");
    const onAbort = () => void unblock().catch(() => {});
    t.signal.addEventListener("abort", onAbort, { once: true });
    let watcher;
    const started = new Promise((resolve) => {
      watcher = watch(dataRoot, (_event, name) => {
        if (name === "tokens-started") resolve();
      });
    });
    try {
      stage("トークン量のスクリプトを持つCLIへ委譲する");
      const { parent, child, childId, events } = await launchChild(
        client,
        dataRoot,
        "Do the work.",
        {
          tokensScript: `
import { existsSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { cwd } = JSON.parse(input);
await new Promise(resolve => {
  const watcher = watch(cwd, () => {
    if (existsSync(join(cwd, "tokens-release"))) {
      watcher.close();
      resolve();
    }
  });
  writeFileSync(join(cwd, "tokens-started"), "started");
  if (existsSync(join(cwd, "tokens-release"))) {
    watcher.close();
    resolve();
  }
});
console.log(JSON.stringify({ input: 27, output: 9 }));
`,
        },
      );
      stage("計測が終了しない間も質問の応答と親への通知が届く");
      const asked = actorCommand(child, "ask", [
        "ask",
        "--body",
        "May I finish?",
      ]);
      await started;
      await asked;
      await parent.output("asked a question");
      stage("同じ子の報告も応答し、親が本文を読める");
      await actorCommand(child, "report", [
        "report",
        "--body",
        "Completed the work.",
      ]);
      await parent.output("reported");
      await events.waitFor(
        (event) =>
          event.type === "teams.child.updated" &&
          event.child.id === childId &&
          event.child.state === "reported",
      );
      const children = await client.request("teams.children", {});
      assert.equal(
        children.children.find((entry) => entry.id === childId).state,
        "reported",
      );
      const result = await actorCommand(parent, "read", ["read", childId]);
      assert.deepEqual(result.data.questions, ["May I finish?"]);
      assert.deepEqual(result.data.reports, ["Completed the work."]);
    } finally {
      await unblock();
      watcher.close();
      t.signal.removeEventListener("abort", onAbort);
    }
  }));

test("受け入れた子の依頼、差し戻しと報告を次の子に引き継ぐ", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親から子へ委譲し、子の報告を差し戻す");
    const { parent, child, childId, events, delegated } = await launchChild(
      client,
      dataRoot,
      "Do the work. AUTO_REPORT_FIRST",
    );
    await parent.output("reported");
    await actorCommand(parent, "revise", [
      "send",
      childId,
      "--kind",
      "revise",
      "--body",
      "Check the result again. AUTO_REPORT_AGAIN",
    ]);
    await responseTurn(child, 2);
    await actorCommand(parent, "finish", [
      "finish",
      childId,
      "--decision",
      "accept",
      "--reason",
      "Verified",
      "--worktree",
      "keep",
    ]);
    stage("次の子への依頼に前の経緯が入る");
    const continued = await actorCommand(parent, "continue", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Continue",
      "--worktree",
      "parent",
      "--continue",
      delegated.data.task,
      "--body",
      "Continue the work.",
    ]);
    const nextId = continued.data.child;
    const started = await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === nextId &&
        event.child.terminalId,
    );
    const next = await client.terminal(started.child.terminalId);
    const nextOutput = await responseTurn(next, 1);
    const request = JSON.parse(nextOutput.match(/RESPONSE_BODY:(.+)\r?\n/u)[1]);
    for (const text of [
      "Continue the work.",
      "Do the work.",
      "Check the result again.",
      "Checked again.",
      "Verified",
    ])
      assert.ok(request.includes(text), text);
  }));

test("報告も質問もなく応答を終えた子を親に知らせ、待ち理由を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親から子へ委譲し、子が報告せずに応答を終える");
    const { parent, childId } = await launchChild(client, dataRoot);
    const notice = "is idle without a report or question";
    await parent.output(notice);
    const tasks = await actorCommand(parent, "tasks", ["tasks"]);
    const output = await parent.output("ACTOR_RESULT:tasks:");
    assert.equal(output.split(notice).length - 1, 1);
    const entry = tasks.data.children.find((item) => item.child === childId);
    assert.equal(entry.waiting, "report");
    assert.deepEqual(entry.waitingReasons, [{ reason: "no_report" }]);
  }));

test("親の追加依頼ごとに未報告の応答を一度知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("子が最初の依頼を報告せずに終える");
    const { parent, child, childId } = await launchChild(client, dataRoot);
    const notice = "is idle without a report or question";
    await parent.output(notice);
    stage("親から追加依頼を送り、次の応答を待つ");
    await actorCommand(parent, "send-again", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "Check once more.",
    ]);
    await child.output("RESPONSE_TURN_DONE:2");
    const { output } = await parent.waitFor(
      ({ output }) => output.split(notice).length - 1 >= 2,
    );
    assert.equal(output.split(notice).length - 1, 2);
    const tasks = await actorCommand(parent, "after-send", ["tasks"]);
    const afterTasks = await parent.output("ACTOR_RESULT:after-send:");
    assert.equal(afterTasks.split(notice).length - 1, 2);
    assert.equal(
      tasks.data.children.find((entry) => entry.child === childId).waiting,
      "report",
    );
  }));

test("利用者が子へ直接入力した応答では未報告の知らせを増やさない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親が最初の未報告の知らせを受け取る");
    const { parent, child, childId } = await launchChild(client, dataRoot);
    const notice = "is idle without a report or question";
    await parent.output(notice);
    stage("利用者が子に直接入力し、その応答を終える");
    await child.input("Direct user request.\r");
    await child.output("RESPONSE_TURN_DONE:2");
    stage("親の次の依頼への報告までに追加の未報告通知がない");
    await actorCommand(parent, "request-report", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "AUTO_REPORT_COMPLETED",
    ]);
    await responseTurn(child, 3);
    const output = await parent.output("reported");
    assert.equal(output.split(notice).length - 1, 1);
  }));

test("子を停止しても親は操作でき、sendで同じ会話を再開し未報告を知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("子の最初の応答を待つ");
    const { parent, child, childId, terminalId, events } = await launchChild(
      client,
      dataRoot,
    );
    const initial = await child.output(/RESPONSE_SESSION:[^\r\n]+\r?\n/u);
    const session = initial.match(/RESPONSE_SESSION:([^\r\n]+)/u)[1];
    const notice = "is idle without a report or question";
    await parent.output(notice);
    stage("子を停止し、親から操作する");
    await actorCommand(parent, "stop", ["stop", childId]);
    await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === childId &&
        event.child.state === "stopped",
    );
    await actorCommand(parent, "parent-alive", ["tasks"]);
    stage("親から同じ子に追加依頼を送る");
    await actorCommand(parent, "resume", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "Continue after stopping.",
    ]);
    const { output } = await client.terminalUntil(terminalId, ({ output }) => {
      const start = output.indexOf("RESPONSE_READY:resume");
      return (
        start !== -1 && output.slice(start).includes("RESPONSE_TURN_DONE:1")
      );
    });
    assert.ok(
      output
        .slice(output.indexOf("RESPONSE_READY:resume"))
        .includes(`RESPONSE_SESSION:${session}`),
    );
    const result = await parent.waitFor(
      ({ output }) => output.split(notice).length - 1 >= 2,
    );
    assert.equal(result.output.split(notice).length - 1, 2);
    const tasks = await actorCommand(parent, "resumed-tasks", ["tasks"]);
    const entry = tasks.data.children.find((item) => item.child === childId);
    assert.equal(entry.waiting, "report");
    assert.deepEqual(entry.waitingReasons, [{ reason: "no_report" }]);
  }));

test("iori --jsonの成功と失敗を重複のないJSONで読める", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("チームの親を起動する");
    const cli = await registerResponseCli(client, dataRoot);
    const team = await client.request("teams.create", {
      definition: {
        name: "JSON",
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
    const { terminal } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    const parent = await client.terminal(terminal.id);
    await parent.output("RESPONSE_TURN_DONE:1");
    stage("成功と失敗の応答を読む");
    const success = await actorCommand(parent, "json-success", ["tasks"]);
    assert.deepEqual(Object.keys(success).sort(), ["data", "ok"]);
    const successOutput = await parent.output("ACTOR_RESULT:json-success:");
    const successLine = successOutput
      .split("ACTOR_RESULT:json-success:")[1]
      .split("\n")[0];
    assert.equal((successLine.match(/"data"\s*:/gu) ?? []).length, 1);
    await parent.input(
      JSON.stringify({
        id: "json-failure",
        command: ["read", "00000000-0000-0000-0000-000000000000"],
      }) + "\r",
    );
    const prefix = "ACTOR_RESULT:json-failure:";
    const { output } = await parent.waitFor(({ output }) => {
      const start = output.indexOf(prefix);
      return start !== -1 && output.indexOf("\n", start) !== -1;
    });
    const start = output.indexOf(prefix) + prefix.length;
    const failure = JSON.parse(
      output.slice(start, output.indexOf("\n", start)),
    );
    assert.deepEqual(Object.keys(failure).sort(), ["ok", "text"]);
    assert.equal(failure.ok, false);
    assert.equal(typeof failure.text, "string");
  }));

test("複数の子の未報告通知がそれぞれの子に届く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("最初の子の未報告通知を受け取る");
    const { parent, childId, events } = await launchChild(client, dataRoot);
    await parent.output(
      '[iori] Worker "Messages" is idle without a report or question',
    );
    stage("別の子を委譲し、その子の通知を受け取る");
    const second = await actorCommand(parent, "second", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Second",
      "--worktree",
      "parent",
      "--body",
      "Do the second task.",
    ]);
    const secondId = second.data.child;
    const started = await events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === secondId &&
        event.child.terminalId,
    );
    const secondChild = await client.terminal(started.child.terminalId);
    await secondChild.output("RESPONSE_TURN_DONE:1");
    const output = await parent.output(
      '[iori] Worker "Second" is idle without a report or question',
    );
    assert.equal(
      output.split(
        '[iori] Worker "Messages" is idle without a report or question',
      ).length - 1,
      1,
    );
    assert.equal(
      output.split(
        '[iori] Worker "Second" is idle without a report or question',
      ).length - 1,
      1,
    );
    const tasks = await actorCommand(parent, "both-tasks", ["tasks"]);
    for (const id of [childId, secondId])
      assert.equal(
        tasks.data.children.find((entry) => entry.child === id).waiting,
        "report",
      );
  }));

test("利用者が子の応答を中断した時は未報告の知らせを増やさない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親が最初の未報告通知を受け取る");
    const { parent, child, childId } = await launchChild(client, dataRoot);
    const notice = "is idle without a report or question";
    await parent.output(notice);
    stage("親の次の依頼への応答を利用者が中断する");
    await actorCommand(parent, "interrupt-request", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "AUTO_INTERRUPT",
    ]);
    await child.output("RESPONSE_ACTIVE");
    await child.input("\x1b\r");
    await child.output("RESPONSE_TURN_DONE:2");
    stage("親が次の報告を受け取るまで追加の未報告通知がない");
    await actorCommand(parent, "after-interrupt", [
      "send",
      childId,
      "--kind",
      "request",
      "--body",
      "AUTO_REPORT_COMPLETED",
    ]);
    await responseTurn(child, 3);
    const output = await parent.output("reported");
    assert.equal(output.split(notice).length - 1, 1);
  }));

test("即時委譲の応答は起動開始を示す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("親から子へ委譲し応答を読む");
    const { delegated } = await launchChild(client, dataRoot);
    assert.ok(["starting", "running"].includes(delegated.data.state));
  }));
