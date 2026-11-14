import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import {
  registerScriptedCli,
  actorCommand,
} from "../../verification/host/scripted-definition.mjs";
import {
  withCli,
  launch,
  submit,
  status,
  savedSession,
  marker,
  model,
  commandStep,
} from "./fixture.mjs";

export async function launchTeam(context, parentCli, cli, instruction) {
  const { client, dataRoot } = context;
  const candidate = {
    id: "worker-candidate",
    cli,
    model: cli.startsWith("scripted-") ? "" : model(cli),
    tools: [],
    minimum: "",
    ...(cli === "codex"
      ? { permission: "never", sandbox: "danger-full-access" }
      : cli === "omp"
        ? { permission: "yolo" }
        : {}),
  };
  const team = await client.request("teams.create", {
    definition: {
      name: "Compatibility",
      description: "",
      instruction: "",
      parent: {
        ...candidate,
        cli: parentCli,
        model: parentCli === "claude" ? model("claude") : "",
        id: "parent",
      },
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
  await events.waitFor((e) => e.type === "snapshot");
  const { terminal: created } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd: join(dataRoot, "repository"),
    ...(instruction ? { instruction } : {}),
  });
  return { created, events };
}

export async function scriptedChildStarted(context, events, parentTerminalId) {
  const started = await events.waitFor(
    (event) =>
      event.type === "teams.child.updated" &&
      event.child.parentTerminalId === parentTerminalId &&
      event.child.terminalId,
  );
  const child = await context.terminal(
    context.client,
    started.child.terminalId,
  );
  await child.output("ACTOR_READY");
}

export async function teamChild(
  context,
  cli,
  script,
  request = `Complete the request. ${marker(script)}`,
) {
  const { client, dataRoot } = context;
  const parentCli = await registerScriptedCli(client, dataRoot, {
    capturePrompts: true,
  });
  const { created, events } = await launchTeam(context, parentCli, cli);
  const parent = await context.terminal(client, created.id);
  await parent.output("ACTOR_READY");
  await parent.output("ACTOR_PROMPT:");
  const result = await actorCommand(parent, "delegate", [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Compatibility",
    "--worktree",
    "parent",
    "--body",
    request,
  ]);
  const childId = result.data.child;
  const started = await events.waitFor(
    (e) =>
      e.type === "teams.child.updated" &&
      e.child.id === childId &&
      e.child.terminalId,
  );
  await context.terminal(client, started.child.terminalId);
  return { childId, terminalId: started.child.terminalId, events, parent };
}

async function reportArrives(context, child) {
  await child.events.waitFor(
    (e) =>
      e.type === "teams.child.updated" &&
      e.child.id === child.childId &&
      e.child.state === "reported",
  );
  await child.parent.output('\\"Compatibility\\" reported.');
  const report = await actorCommand(child.parent, "read", [
    "read",
    child.childId,
  ]);
  assert.match(JSON.stringify(report), /COMPAT_REPORT/u);
}

export function contracts(cli, { approval = true } = {}) {
  test("起動して最初の入力を受け付ける", (t) =>
    withCli(t, cli, {}, (context) => launch(context, cli)));

  test("入力すると応答中から完了へ変わる", (t) => {
    const gate = Promise.withResolvers();
    t.after(() => gate.resolve());
    return withCli(
      t,
      cli,
      { state: [{ text: "COMPAT_DONE", after: gate.promise, delayMs: 0 }] },
      async (context) => {
        const { id, pty } = await launch(context, cli);
        const events = await context.client.events();
        await submit(pty, marker("state"));
        context.stage("hookから応答中の状態を受信する");
        await status(events, id, "active");
        gate.resolve();
        context.stage("hookから完了の状態を受信する");
        await status(events, id, "done");
        await pty.output("COMPAT_DONE");
      },
    );
  });

  if (approval)
    test("道具の承認待ちと要約を受信する", (t) =>
      withCli(
        t,
        cli,
        {
          approval: [
            commandStep(cli, 'node -e "console.log(42)"'),
            { text: "42", delayMs: 0 },
          ],
        },
        async (context) => {
          const { id, pty } = await launch(context, cli);
          const events = await context.client.events();
          await submit(pty, marker("approval"));
          context.stage("道具の承認待ちと実行する内容を受信する");
          const waiting = await status(events, id, "waiting");
          assert.equal(waiting.attention?.kind, "approval");
          assert.match(waiting.attention?.summary ?? "", /node|console\.log/u);
        },
      ));

  test("HostとTerminalの再起動後に同じ会話を再開する", (t) =>
    withCli(
      t,
      cli,
      {
        resume: [
          {
            text: "COMPAT_RESUMED",
            expectTokens: ["COMPAT_MEMORY"],
            delayMs: 0,
          },
        ],
      },
      async (context) => {
        const { id } = await launch(context, cli);
        const before = savedSession(context.dataRoot, id);
        context.stage("HostとTerminalのデーモンを停止して再起動する");
        await context.stop({ stopDaemon: true });
        const client = await context.start();
        const events = await client.events();
        const pty = await context.terminal(client, id);
        const offset = pty.values.at(-1).output.length;
        await client.request("cli.resume", { terminalId: id });
        context.stage("再開したCLIの入力画面を受信する");
        if (cli === "codex" || cli === "opencode")
          await Promise.any([
            status(events, id, "idle"),
            pty.waitFor(({ output }) =>
              output.slice(offset).includes(`\x1b]7501;state=idle:app=${cli}`),
            ),
          ]);
        else await status(events, id, "idle");
        if (cli === "opencode")
          await pty.waitFor(({ output }) =>
            output.slice(offset).includes("\x1b[?25h"),
          );
        context.stage("再開したCLIへ次の入力を送る");
        await submit(pty, marker("resume"));
        context.stage("再開した会話の応答と同じ会話のIDを確認する");
        await status(events, id, "done");
        await pty.output("COMPAT_RESUMED");
        assert.equal(savedSession(context.dataRoot, id).id, before.id);
        assert.ok(
          context.fake.requests.some(
            (r) => r.marker === "resume" && r.tokensPresent.COMPAT_MEMORY,
          ),
        );
      },
    ));

  test("子が最初の依頼を受信して報告が親へ届く", (t) =>
    withCli(
      t,
      cli,
      {
        child: [
          commandStep(cli, "iori report --body COMPAT_REPORT"),
          { text: "COMPAT_REPORTED", delayMs: 0 },
        ],
      },
      async (context) => {
        context.stage("本物のCLIの子へ最初の依頼を送る");
        const child = await teamChild(context, cli, "child");
        context.stage("子の報告を親のPTYで受信して本文を取得する");
        await reportArrives(context, child);
      },
      { team: true },
    ));

  if (cli === "claude")
    test("バックグラウンドの処理完了後に報告が親へ届く", async (t) => {
      const connection = Promise.withResolvers();
      let backgroundSocket;
      const server = createServer((socket) => {
        backgroundSocket = socket;
        connection.resolve(socket);
      });
      t.after(async () => {
        backgroundSocket?.destroy();
        await new Promise((resolve) => server.close(resolve));
      });
      await withCli(
        t,
        cli,
        {},
        async (context) => {
          const socketPath = join(context.dataRoot, "background.sock");
          await new Promise((resolve) => server.listen(socketPath, resolve));
          const script = join(context.dataRoot, "background.mjs");
          await writeFile(
            script,
            'import {connect} from "node:net"; const socket=connect(process.argv[2]); socket.once("data",()=>{socket.end(); console.log("COMPAT_BACKGROUND_DONE");});',
          );
          const command = `node ${script} ${socketPath}`;
          // The script is installed before the first child model request.
          context.scripts.background = [
            commandStep(cli, command, {
              run_in_background: true,
              description: "Compatibility background task",
            }),
            { text: "COMPAT_BACKGROUND_WAIT", delayMs: 0 },
            commandStep(cli, "iori report --body COMPAT_REPORT"),
            { text: "COMPAT_REPORTED", delayMs: 0 },
          ];
          const child = await teamChild(context, cli, "background");
          const socket = await connection.promise;
          t.after(() => socket.destroy());
          context.stage("応答完了後もバックグラウンドの子は報告待ちにならない");
          await child.events.waitFor(
            (e) =>
              e.type === "terminal.updated" &&
              e.terminal.id === child.terminalId &&
              e.terminal.cliStatus?.state === "done" &&
              e.terminal.cliStatus.backgroundTasks?.length,
          );
          const tasks = await actorCommand(child.parent, "background", [
            "tasks",
          ]);
          const entry = tasks.data.children.find(
            (e) => e.child === child.childId,
          );
          assert.equal(entry.state, "running");
          assert.equal(entry.waiting, undefined);
          assert.ok(entry.backgroundTasks.length);
          socket.end("release");
          context.stage("バックグラウンドの処理完了後の報告を受信する");
          await reportArrives(context, child);
          assert.ok(
            !child.parent.values.some(({ output }) =>
              /is idle without a report or question/u.test(output),
            ),
          );
        },
        { team: true },
      );
    });

  test("モデルの一覧を読み込む", (t) =>
    (async () => {
      const definition = JSON.parse(
        await readFile(
          new URL(
            `../../apps/host/src/cli/${cli}/definition.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (definition.models?.unavailable)
        return t.skip("その CLI に機能がない");
      return withCli(t, cli, {}, async ({ client, stage }) => {
        stage("公開の要求でモデル一覧を取得する");
        const result = await client.request("cli.models", { cliId: cli });
        assert.equal(result.error, undefined, result.errorDetail);
        assert.ok(result.models.length);
      });
    })());
}
