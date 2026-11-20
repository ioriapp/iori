import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { writeFakeCli } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { registerWatchCli } from "./fixtures/watch-definition.mjs";

const STALL_MS = 1200;

const RAW_ECHO_CLI = `if (process.argv.includes("--version") || process.argv.includes("version") || process.argv.includes("--help")) {
  console.log("1.0.0");
} else {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  console.log("RAW_CLI_READY");
  process.stdin.on("data", (chunk) => {
    process.stdout.write("\\nRAW_HEX:" + chunk.toString("hex") + "\\n");
  });
  process.stdin.resume();
}
`;

async function extractControlFile(terminal) {
  const output = await terminal.output(/WATCH_CONTROL:([^\r\n]+)\r?\n/u);
  return output.match(/WATCH_CONTROL:([^\r\n]+)\r?\n/u)[1];
}

async function parentCommand(parent, id, command, raw = false) {
  await parent.input(`\n${JSON.stringify({ id, command, raw })}\r`);
  const pattern = new RegExp(`ACTOR_RESULT:${id}:([^\\r\\n]+)\\r?\\n`, "u");
  const { output } = await parent.waitFor(({ output }) => pattern.test(output));
  const payload = output.match(pattern)[1];
  return JSON.parse(payload);
}

async function delegateChild(
  parent,
  client,
  events,
  id,
  { role = "Worker", title, body },
) {
  const delegated = await parentCommand(parent, id, [
    "delegate",
    "--role",
    role,
    "--difficulty",
    "medium",
    "--title",
    title,
    "--worktree",
    "parent",
    "--body",
    body,
  ]);
  assert.equal(delegated.ok, true, JSON.stringify(delegated));
  const childId = delegated.data.child;
  const started = await events.waitFor(
    (event) =>
      event.type === "teams.child.updated" &&
      event.child.id === childId &&
      event.child.terminalId,
  );
  const terminal = await client.terminal(started.child.terminalId);
  return {
    childId,
    taskId: delegated.data.task,
    terminalId: started.child.terminalId,
    terminal,
  };
}

function rawHexAfter(output, marker) {
  const start = marker ? output.lastIndexOf(marker) : 0;
  const slice = start >= 0 ? output.slice(start) : output;
  return [...slice.matchAll(/RAW_HEX:([0-9a-f]+)/gu)]
    .map((match) => match[1])
    .join("");
}

async function waitForRawHex(terminal, marker, expectedHex) {
  const { output } = await terminal.waitFor(({ output }) =>
    rawHexAfter(output, marker).includes(expectedHex),
  );
  return rawHexAfter(output, marker);
}

function createEventReader(events) {
  let cursor = 0;
  return async (predicate) => {
    let matchedIndex = -1;
    const found = await events.waitFor((event, index) => {
      if (index < cursor || !predicate(event)) return false;
      matchedIndex = index;
      return true;
    });
    cursor = matchedIndex + 1;
    return found;
  };
}

function teamRole(id, name, cli) {
  return {
    id,
    name,
    when: "",
    limit: "8",
    reuse: true,
    split: false,
    instruction: "",
    request: "",
    report: "",
    candidates: {
      high: [],
      medium: [{ id: `${id}-cand`, cli, model: "", tools: [], minimum: "" }],
      low: [],
    },
  };
}

for (const periodic of [false, true]) {
  test(
    periodic
      ? "CLIの状態がない子も定期確認する"
      : "CLIの状態がない子の停止を知らせ入力で解除する",
    (t) =>
      runHostTest(
        t,
        async ({ client, dataRoot }) => {
          const parentCli = await registerWatchCli(
            client,
            dataRoot,
            "initial-parent",
          );
          const childCli = await registerWatchCli(
            client,
            dataRoot,
            "initial-child",
            ["--no-hook", ...(periodic ? ["--heartbeat"] : [])],
          );
          const team = await client.request("teams.create", {
            definition: {
              name: "Initial child",
              description: "",
              instruction: "",
              ...(periodic ? { checkMinutes: 15 } : {}),
              parent: {
                id: "parent",
                cli: parentCli,
                model: "",
                tools: [],
                minimum: "",
              },
              roles: [teamRole("worker", "Worker", childCli)],
            },
          });
          await client.request("teams.settings", {
            defaultTeam: team.saved.id,
            limits: {},
          });
          const events = await client.events();
          const nextEvent = createEventReader(events);
          await nextEvent((event) => event.type === "snapshot");
          const { terminal: launched } = await client.request("team.launch", {
            teamId: team.saved.id,
            cwd: dataRoot,
          });
          const parent = await client.terminal(launched.id);
          await parent.output("WATCH_READY:startup");
          const child = await delegateChild(parent, client, events, "initial", {
            title: "Initial",
            body: "Wait",
          });
          await child.terminal.output("Trust this folder?");
          if (periodic) {
            const notice = `NOTICE_RECEIVED:[iori] Worker "Initial" has been working for 15m. Read its screen with iori screen ${child.childId}. If it repeats itself or works off task, act; otherwise do nothing.`;
            await parent.output(notice);
            const twice = await parent.waitFor(
              ({ output }) => output.split(notice).length - 1 >= 2,
            );
            assert.equal(twice.output.split(notice).length - 1, 2);
          } else {
            const notice = `NOTICE_RECEIVED:[iori] Worker "Initial" is not responding (no output for 2m). Read its screen with iori screen ${child.childId}, act once, and do not check it again.`;
            await parent.output(notice);
            const stalled = await nextEvent(
              (event) =>
                event.type === "terminal.updated" &&
                event.terminal.id === child.terminalId &&
                event.terminal.cliStatus?.stalledSince !== undefined,
            );
            assert.equal(
              typeof stalled.terminal.cliStatus.stalledSince,
              "number",
            );
            const screen = await parentCommand(parent, "screen-initial", [
              "screen",
              child.childId,
            ]);
            assert.equal(screen.ok, true, JSON.stringify(screen));
            assert.ok(
              screen.data.lines.some((line) =>
                line.includes("Trust this folder?"),
              ),
            );
            await new Promise((resolve) => setTimeout(resolve, STALL_MS + 300));
            assert.equal(
              (await parent.output(notice)).split(notice).length - 1,
              1,
            );
            await child.terminal.input("y\r");
            await nextEvent(
              (event) =>
                event.type === "terminal.updated" &&
                event.terminal.id === child.terminalId &&
                event.terminal.cliStatus?.stalledSince === undefined,
            );
          }
        },
        {
          environment: {
            IORI_TEST_STALL_MS: String(STALL_MS),
            IORI_TEST_CHECK_MINUTE_MS: "80",
          },
        },
      ),
  );
}

test("作業中の子の端末でマウスをクリックしても、応答後に未報告の入力待ちを親へ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const cli = await registerWatchCli(client, dataRoot);
    const team = await client.request("teams.create", {
      definition: {
        name: "Mouse Input",
        description: "",
        instruction: "",
        parent: { id: "parent", cli, model: "", tools: [], minimum: "" },
        roles: [teamRole("worker", "Worker", cli)],
      },
    });
    await client.request("teams.settings", {
      defaultTeam: team.saved.id,
      limits: {},
    });
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    const { terminal: launched } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    const parent = await client.terminal(launched.id);
    await parent.output("WATCH_READY:startup");
    const child = await delegateChild(parent, client, events, "delegate", {
      title: "Mouse",
      body: "BEHAVIOR_STAY_ACTIVE CAPTURE_RAW",
    });
    await child.terminal.output("WATCH_ACTIVE");

    const click = "\x1b[<0;10;5M\x1b[<0;10;5m";
    await child.terminal.input(click);
    await waitForRawHex(
      child.terminal,
      "WATCH_ACTIVE",
      Buffer.from(click).toString("hex"),
    );
    const beforeStop = await parentCommand(parent, "tasks-active", ["tasks"]);
    assert.equal(
      beforeStop.data.children.find((entry) => entry.child === child.childId)
        .userInput,
      undefined,
    );

    const controlFile = await extractControlFile(child.terminal);
    await appendFile(controlFile, "HOOK_STOP\n");
    await parent.output(
      'NOTICE_RECEIVED:[iori] Worker "Mouse" is idle without a report or question',
    );
    const tasks = await parentCommand(parent, "tasks-unreported", ["tasks"]);
    const entry = tasks.data.children.find(
      (item) => item.child === child.childId,
    );
    assert.equal(entry.userInput, undefined);
    assert.equal(entry.waiting, "report");
    assert.deepEqual(entry.waitingReasons, [{ reason: "no_report" }]);
  }));

test("作業中の子の止まりを親へ1回だけ知らせ、同時停止は1行にまとめ、hook後は再び知らせる", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot, stage }) => {
      const parentCli = await registerWatchCli(
        client,
        dataRoot,
        "watch-parent",
      );
      const childCli = await registerWatchCli(client, dataRoot, "watch-child");
      const team = await client.request("teams.create", {
        definition: {
          name: "Stall Notice",
          description: "",
          instruction: "",
          parent: {
            id: "parent",
            cli: parentCli,
            model: "",
            tools: [],
            minimum: "",
          },
          roles: [teamRole("worker", "Worker", childCli)],
        },
      });
      await client.request("teams.settings", {
        defaultTeam: team.saved.id,
        limits: {},
      });
      const events = await client.events();
      const nextEvent = createEventReader(events);
      await nextEvent((event) => event.type === "snapshot");

      const { terminal: launched } = await client.request("team.launch", {
        teamId: team.saved.id,
        cwd: dataRoot,
      });
      const parent = await client.terminal(launched.id);
      await parent.output("WATCH_READY:startup");
      const parentControl = await extractControlFile(parent);

      stage("親をactiveかつ入力欄に書きかけにしても止まりの知らせが届く");
      const alpha = await delegateChild(parent, client, events, "del-alpha", {
        title: "Alpha",
        body: "BEHAVIOR_SILENT_STALL",
      });
      await alpha.terminal.output("WATCH_ACTIVE");
      const alphaControl = await extractControlFile(alpha.terminal);

      await appendFile(parentControl, "HOOK_ACTIVE\n");
      await parent.output("HOOK_ACTIVE_SENT");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === launched.id &&
          event.terminal.cliStatus?.state === "active",
      );
      await parent.input("drafting");

      const expectedAlpha = `NOTICE_RECEIVED:[iori] Worker "Alpha" is not responding (no output for 2m). Read its screen with iori screen ${alpha.childId}, act once, and do not check it again.`;
      const firstOutput = await parent.output(expectedAlpha);
      assert.equal(firstOutput.split(expectedAlpha).length - 1, 1);

      const alphaStalledList = await client.request("terminal.list");
      assert.equal(
        typeof alphaStalledList.terminals.find(
          (term) => term.id === alpha.terminalId,
        ).cliStatus.stalledSince,
        "number",
      );

      await new Promise((resolve) => setTimeout(resolve, STALL_MS + 300));
      const noDupCheck = await parent.output(expectedAlpha);
      assert.equal(noDupCheck.split(expectedAlpha).length - 1, 1);

      stage("親への完了前にhookでstalledSinceが消え、次の停止で再び1回届く");
      await appendFile(alphaControl, "HOOK_ACTIVE\n");
      await alpha.terminal.output("HOOK_ACTIVE_SENT");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === alpha.terminalId &&
          event.terminal.cliStatus?.stalledSince === undefined,
      );
      const secondAlphaOutput = await parent.waitFor(
        ({ output }) => output.split(expectedAlpha).length - 1 >= 2,
      );
      assert.equal(secondAlphaOutput.output.split(expectedAlpha).length - 1, 2);

      await appendFile(alphaControl, "HOOK_STOP\n");
      await alpha.terminal.output("HOOK_STOP_SENT");
      await parent.output(
        `NOTICE_RECEIVED:[iori] Worker "Alpha" is idle without a report or question`,
      );
      await appendFile(parentControl, "HOOK_STOP\n");
      await parent.output("HOOK_STOP_SENT");

      if (process.platform === "linux") {
        stage("Linuxで子孫プロセスが停止した子について停止理由の知らせが届く");
        const stopped = await delegateChild(
          parent,
          client,
          events,
          "del-stop",
          {
            title: "Stopped",
            body: "BEHAVIOR_STOPPED_CHILD",
          },
        );
        await stopped.terminal.output("STOPPED_CHILD_STARTED:");
        const stoppedControl = await extractControlFile(stopped.terminal);
        await parent.output(
          `NOTICE_RECEIVED:[iori] Worker "Stopped" is not responding (a command it started is stopped). Read its screen with iori screen ${stopped.childId}, act once, and do not check it again.`,
        );
        await appendFile(stoppedControl, "KILL_STOPPED\n");
        await stopped.terminal.output("STOPPED_CHILD_CLEARED");
        await appendFile(stoppedControl, "HOOK_STOP\n");
        await stopped.terminal.output("HOOK_STOP_SENT");
        await parent.output(
          `NOTICE_RECEIVED:[iori] Worker "Stopped" is idle without a report or question`,
        );
      }

      // Windowsでは到着時刻が同じ見回りに揃わないと考えられるため、OS非依存のまとめをLinuxで確かめる。
      if (process.platform === "linux") {
        stage("同時に止まった複数の子は1行にまとめて知らせる");
        const beta = await delegateChild(parent, client, events, "del-beta", {
          title: "Beta",
          body: "BEHAVIOR_PASSIVE",
        });
        await beta.terminal.output("WATCH_PASSIVE");
        const betaControl = await extractControlFile(beta.terminal);

        const gamma = await delegateChild(parent, client, events, "del-gamma", {
          title: "Gamma",
          body: "BEHAVIOR_PASSIVE",
        });
        await gamma.terminal.output("WATCH_PASSIVE");
        const gammaControl = await extractControlFile(gamma.terminal);

        await appendFile(betaControl, "HOOK_ACTIVE\n");
        await nextEvent(
          (event) =>
            event.type === "terminal.updated" &&
            event.terminal.id === beta.terminalId &&
            event.terminal.cliStatus?.state === "active",
        );
        await appendFile(gammaControl, "HOOK_ACTIVE\n");
        await nextEvent(
          (event) =>
            event.type === "terminal.updated" &&
            event.terminal.id === gamma.terminalId &&
            event.terminal.cliStatus?.state === "active",
        );

        // Reset both output timestamps mid-interval via live PTY writes (no hook spawn skew).
        await new Promise((resolve) => setTimeout(resolve, 120));
        await Promise.all([
          appendFile(betaControl, "EMIT_OUTPUT\n"),
          appendFile(gammaControl, "EMIT_OUTPUT\n"),
        ]);
        await Promise.all([
          beta.terminal.output("RESUMED_PTY_OUTPUT"),
          gamma.terminal.output("RESUMED_PTY_OUTPUT"),
        ]);
        const combinedNotice = `NOTICE_RECEIVED:[iori] Worker "Beta" is not responding (no output for 2m). Read its screen with iori screen ${beta.childId}; Worker "Gamma" is not responding (no output for 2m). Read its screen with iori screen ${gamma.childId}, act once, and do not check it again.`;
        await parent.output(combinedNotice);
      }
    },
    { environment: { IORI_TEST_STALL_MS: String(STALL_MS) } },
  ));

test("iori screenが見えている画面だけを返し別会話を拒み、interruptがCLIごとのキーを送る", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot, stage }) => {
      for (const name of ["claude", "cursor-agent", "amp"]) {
        await writeFakeCli(join(dataRoot, "bin"), name, RAW_ECHO_CLI);
      }
      const parentCli = await registerWatchCli(
        client,
        dataRoot,
        "watch-parent",
      );
      const watchCli = await registerWatchCli(client, dataRoot, "watch-child");

      const team = await client.request("teams.create", {
        definition: {
          name: "Watch Commands",
          description: "",
          instruction: "",
          parent: {
            id: "parent",
            cli: parentCli,
            model: "",
            tools: [],
            minimum: "",
          },
          roles: [
            teamRole("worker", "Worker", watchCli),
            teamRole("claude", "ClaudeWorker", "claude"),
            teamRole("cursor", "CursorWorker", "cursor"),
            teamRole("amp", "AmpWorker", "amp"),
          ],
        },
      });
      await client.request("teams.settings", {
        defaultTeam: team.saved.id,
        limits: {},
      });
      const events = await client.events();
      const nextEvent2 = createEventReader(events);
      await nextEvent2((event) => event.type === "snapshot");

      const { terminal: launched1 } = await client.request("team.launch", {
        teamId: team.saved.id,
        cwd: dataRoot,
      });
      const parent1 = await client.terminal(launched1.id);
      await parent1.output("WATCH_READY:startup");

      stage("親の固定の指示とhelpが新しい段落・コマンドを含む");
      const db = new DatabaseSync(join(dataRoot, "iori-host", "host.sqlite"), {
        readOnly: true,
      });
      let instructionFile;
      try {
        instructionFile = db
          .prepare("SELECT value_json FROM team_conversations")
          .all()
          .map((row) => JSON.parse(row.value_json))
          .find((row) => row.terminalId === launched1.id).instructionFile;
      } finally {
        db.close();
      }
      const instructions = await readFile(instructionFile, "utf8");
      const instructionLines = instructions.split("\n");
      const sendIndex = instructionLines.findIndex((line) =>
        line.startsWith("Use iori send "),
      );
      assert.notEqual(sendIndex, -1);
      assert.equal(
        instructionLines[sendIndex + 1],
        "When iori says a child is not responding or asks you to check on it, read its screen with iori screen once and act: iori interrupt, iori stop, or delegate again with --continue. If the team allows parent input, iori input can answer its prompts. If it waits for an approval or confirmation you may not answer, tell the user instead of delegating again. Do not check the same child again until iori tells you.",
      );

      const helpText = await parentCommand(
        parent1,
        "help-cmd",
        ["--help"],
        true,
      );
      const helpLines = helpText.split("\n");
      assert.ok(helpLines.includes("iori screen CHILD_ID"));
      assert.ok(helpLines.includes("iori interrupt CHILD_ID"));
      assert.ok(
        helpLines.includes(
          "iori input CHILD_ID (--text TEXT [--enter] | --key KEY)",
        ),
      );

      stage("iori screenは見えている画面だけを返しスクロールバックを含まない");
      const screenChild = await delegateChild(
        parent1,
        client,
        events,
        "del-screen",
        { title: "Screen", body: "BEHAVIOR_SCREEN_SCROLL" },
      );
      await screenChild.terminal.output("VISIBLE_LINE_C");
      const screenControl = await extractControlFile(screenChild.terminal);

      const screenNormal = await parentCommand(parent1, "screen-1", [
        "screen",
        screenChild.childId,
      ]);
      assert.equal(screenNormal.ok, true, JSON.stringify(screenNormal));
      assert.ok(screenNormal.data.lines.includes("VISIBLE_LINE_A"));
      assert.ok(screenNormal.data.lines.includes("VISIBLE_LINE_B"));
      assert.ok(screenNormal.data.lines.includes("VISIBLE_LINE_C"));
      assert.equal(
        screenNormal.data.lines.some((line) => line.includes("SCROLL_LINE_01")),
        false,
      );
      assert.notEqual(screenNormal.data.lines.at(-1), "");

      await appendFile(screenControl, "ALT_SCREEN\n");
      await screenChild.terminal.output("ALT_SCREEN_ROW_2");
      const screenAlt = await parentCommand(parent1, "screen-alt", [
        "screen",
        screenChild.childId,
      ]);
      assert.equal(screenAlt.ok, true, JSON.stringify(screenAlt));
      assert.deepEqual(screenAlt.data.lines, [
        "ALT_SCREEN_ROW_1",
        "ALT_SCREEN_ROW_2",
      ]);

      stage("別会話の親はscreen・interrupt・inputで他の会話の子を操作できない");
      const { terminal: launched2 } = await client.request("team.launch", {
        teamId: team.saved.id,
        cwd: dataRoot,
      });
      const parent2 = await client.terminal(launched2.id);
      await parent2.output("WATCH_READY:startup");
      for (const args of [
        ["screen", screenChild.childId],
        ["interrupt", screenChild.childId],
        ["input", screenChild.childId, "--text", "hi"],
      ]) {
        const denied = await parentCommand(parent2, `cross-${args[0]}`, args);
        assert.equal(denied.ok, false, JSON.stringify(denied));
      }

      stage(
        "iori interruptはparentInputがオフでもCLIごとの中断キーを送りInput履歴を残す",
      );
      await appendFile(screenControl, "EXIT_ALT_SCREEN\nCAPTURE_RAW\n");
      await screenChild.terminal.output("RAW_CAPTURE_READY");
      await appendFile(screenControl, "HOOK_STOP\n");
      await nextEvent2(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === screenChild.terminalId &&
          event.terminal.cliStatus?.state === "done",
      );
      await parent1.output(
        `NOTICE_RECEIVED:[iori] Worker "Screen" is idle without a report or question`,
      );
      await appendFile(screenControl, "HOOK_ACTIVE\n");
      await nextEvent2(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === screenChild.terminalId &&
          event.terminal.cliStatus?.state === "active" &&
          event.terminal.cliStatus.stalledSince === undefined,
      );
      const stallBeforeInt = await nextEvent2(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === screenChild.terminalId &&
          event.terminal.cliStatus?.stalledSince !== undefined,
      );
      assert.equal(
        typeof stallBeforeInt.terminal.cliStatus.stalledSince,
        "number",
      );
      await parent1.waitFor(
        ({ output }) =>
          output.split(
            `NOTICE_RECEIVED:[iori] Worker "Screen" is not responding (no output for 2m). Read its screen with iori screen ${screenChild.childId}`,
          ).length -
            1 >=
          1,
      );

      const unknownInt = await parentCommand(parent1, "int-watch", [
        "interrupt",
        screenChild.childId,
      ]);
      assert.equal(unknownInt.ok, true, JSON.stringify(unknownInt));
      await waitForRawHex(screenChild.terminal, "RAW_CAPTURE_READY", "1b");
      await nextEvent2(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === screenChild.terminalId &&
          event.terminal.cliStatus?.stalledSince === undefined,
      );

      const cliChecks = [
        { role: "ClaudeWorker", expectedHex: "1b", expectedBody: "escape" },
        { role: "CursorWorker", expectedHex: "03", expectedBody: "ctrl-c" },
        {
          role: "AmpWorker",
          expectedHex: "1b1b",
          expectedBody: "escape escape",
        },
      ];
      for (const check of cliChecks) {
        const child = await delegateChild(
          parent1,
          client,
          events,
          `del-${check.role}`,
          { role: check.role, title: check.role, body: "Interrupt test" },
        );
        await child.terminal.output("RAW_CLI_READY");
        const intRes = await parentCommand(parent1, `int-${check.role}`, [
          "interrupt",
          child.childId,
        ]);
        assert.equal(intRes.ok, true, JSON.stringify(intRes));
        await waitForRawHex(child.terminal, "RAW_CLI_READY", check.expectedHex);
        const history = await client.request("teams.task.history", {
          taskId: child.taskId,
        });
        assert.ok(
          history.events.some(
            (event) =>
              event.kind === "Input" && event.body === check.expectedBody,
          ),
          JSON.stringify(history.events),
        );
      }
    },
    { environment: { IORI_TEST_STALL_MS: String(STALL_MS) } },
  ));

test("parentInputは再起動後も保たれ、オフで拒み、オンではwaiting中もすぐ送り、経緯にInputを残す", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart, stage }) => {
    const parentCli = await registerWatchCli(client, dataRoot, "watch-parent");
    const childCli = await registerWatchCli(client, dataRoot, "watch-child");

    const definition = {
      name: "Parent Input",
      description: "",
      instruction: "",
      parent: {
        id: "parent",
        cli: parentCli,
        model: "",
        tools: [],
        minimum: "",
      },
      roles: [teamRole("worker", "Worker", childCli)],
    };
    const team = await client.request("teams.create", { definition });
    const legacy = await client.request("teams.create", {
      definition: { ...definition, name: "Legacy Team" },
    });
    assert.equal(team.saved.parentInput, undefined);
    await client.request("teams.settings", {
      defaultTeam: team.saved.id,
      limits: {},
    });
    const events1 = await client.events();
    await events1.waitFor((event) => event.type === "snapshot");

    stage("parentInputがオフの時は指定文で拒む");
    const { terminal: launched1 } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    const parent1 = await client.terminal(launched1.id);
    await parent1.output("WATCH_READY:startup");
    const waiting1 = await delegateChild(parent1, client, events1, "del-off", {
      title: "OffChild",
      body: "BEHAVIOR_WAITING",
    });
    await waiting1.terminal.output("WATCH_WAITING");

    const rejected = await parentCommand(parent1, "input-off", [
      "input",
      waiting1.childId,
      "--text",
      "yes",
    ]);
    assert.equal(rejected.ok, false);
    assert.equal(
      rejected.text,
      "Parent input to children is off in this team's settings. Ask the user to answer on the child's screen.",
    );

    stage(
      "parentInputをオンにして保存しHost再起動後も設定と古いチームの互換を保つ",
    );
    const saved = await client.request("teams.save", {
      teamId: team.saved.id,
      definition: { ...team.saved, parentInput: true },
    });
    assert.equal(saved.saved.parentInput, true);

    const restarted = await restart();
    const readEnabled = await restarted.request("teams.read", {
      teamId: team.saved.id,
    });
    assert.equal(readEnabled.saved.parentInput, true);
    const readLegacy = await restarted.request("teams.read", {
      teamId: legacy.saved.id,
    });
    assert.equal(readLegacy.saved.parentInput, undefined);

    stage(
      "waiting中の子へ--text・--enter・全--keyがすぐ届き、経緯にInputが残る",
    );
    const events2 = await restarted.events();
    await events2.waitFor((event) => event.type === "snapshot");
    const { terminal: launched2 } = await restarted.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    const parent2 = await restarted.terminal(launched2.id);
    await parent2.output("WATCH_READY:startup");
    const waiting2 = await delegateChild(
      parent2,
      restarted,
      events2,
      "del-on",
      {
        title: "OnChild",
        body: "BEHAVIOR_WAITING",
      },
    );
    await waiting2.terminal.output("WATCH_WAITING");
    await events2.waitFor(
      (event) =>
        event.type === "terminal.updated" &&
        event.terminal.id === waiting2.terminalId &&
        event.terminal.cliStatus?.state === "waiting",
    );

    const sendSteps = [
      {
        id: "in-text",
        args: ["input", waiting2.childId, "--text", "partial"],
        expectedHex: Buffer.from("partial", "utf8").toString("hex"),
        expectedBody: "partial",
      },
      {
        id: "in-text-enter",
        args: ["input", waiting2.childId, "--text", "confirm", "--enter"],
        expectedHex: Buffer.from("confirm\r", "utf8").toString("hex"),
        expectedBody: "confirm",
      },
      {
        id: "key-enter",
        args: ["input", waiting2.childId, "--key", "enter"],
        expectedHex: "0d",
        expectedBody: "enter",
      },
      {
        id: "key-escape",
        args: ["input", waiting2.childId, "--key", "escape"],
        expectedHex: "1b",
        expectedBody: "escape",
      },
      {
        id: "key-up",
        args: ["input", waiting2.childId, "--key", "up"],
        expectedHex: "1b5b41",
        expectedBody: "up",
      },
      {
        id: "key-down",
        args: ["input", waiting2.childId, "--key", "down"],
        expectedHex: "1b5b42",
        expectedBody: "down",
      },
      {
        id: "key-tab",
        args: ["input", waiting2.childId, "--key", "tab"],
        expectedHex: "09",
        expectedBody: "tab",
      },
      {
        id: "key-ctrl-c",
        args: ["input", waiting2.childId, "--key", "ctrl-c"],
        expectedHex: "03",
        expectedBody: "ctrl-c",
      },
    ];
    let expectedAllHex = "";
    for (const step of sendSteps) {
      const res = await parentCommand(parent2, step.id, step.args);
      assert.equal(res.ok, true, JSON.stringify(res));
      expectedAllHex += step.expectedHex;
      await waitForRawHex(waiting2.terminal, "WATCH_WAITING", expectedAllHex);
    }

    const history = await restarted.request("teams.task.history", {
      taskId: waiting2.taskId,
    });
    const inputBodies = history.events
      .filter((event) => event.kind === "Input")
      .map((event) => event.body);
    assert.deepEqual(
      inputBodies,
      sendSteps.map((step) => step.expectedBody),
    );
  }));

test("checkMinutesがあると作業中の子へ間隔ごとに知らせ、報告や質問で起点が戻り、止まりの子は除き、同時達成は1行にまとめる", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot, restart, stage }) => {
      const parentCli = await registerWatchCli(
        client,
        dataRoot,
        "watch-parent",
      );
      const childCli = await registerWatchCli(client, dataRoot, "watch-child");

      const legacy = await client.request("teams.create", {
        definition: {
          name: "Legacy Check",
          description: "",
          instruction: "",
          parent: {
            id: "parent",
            cli: parentCli,
            model: "",
            tools: [],
            minimum: "",
          },
          roles: [teamRole("worker", "Worker", childCli)],
        },
      });
      const legacyRead = await client.request("teams.read", {
        teamId: legacy.saved.id,
      });
      assert.equal(legacyRead.saved.checkMinutes, undefined);

      stage("checkMinutes=15を保存しHost再起動後も設定を保持する");
      const created = await client.request("teams.create", {
        definition: {
          name: "Periodic Check",
          description: "",
          instruction: "",
          checkMinutes: 15,
          parent: {
            id: "parent",
            cli: parentCli,
            model: "",
            tools: [],
            minimum: "",
          },
          roles: [teamRole("worker", "Worker", childCli)],
        },
      });
      assert.equal(created.saved.checkMinutes, 15);
      await client.request("teams.settings", {
        defaultTeam: created.saved.id,
        limits: {},
      });

      const restarted = await restart();
      const readAfterRestart = await restarted.request("teams.read", {
        teamId: created.saved.id,
      });
      assert.equal(readAfterRestart.saved.checkMinutes, 15);

      const events = await restarted.events();
      const nextEvent = createEventReader(events);
      await nextEvent((event) => event.type === "snapshot");

      const { terminal: launched } = await restarted.request("team.launch", {
        teamId: created.saved.id,
        cwd: dataRoot,
      });
      const parent = await restarted.terminal(launched.id);
      await parent.output("WATCH_READY:startup");

      stage(
        "作業中の子には間隔ごとに確認知らせが届き、stalledSinceが付いた子は除かれる",
      );
      const stalled = await delegateChild(parent, restarted, events, "del-st", {
        title: "Stalled",
        body: "BEHAVIOR_SILENT_STALL",
      });
      await stalled.terminal.output("WATCH_ACTIVE");
      const stalledControl = await extractControlFile(stalled.terminal);

      const active = await delegateChild(parent, restarted, events, "del-act", {
        title: "Active",
        body: "BEHAVIOR_WORKING_HEARTBEAT",
      });
      await active.terminal.output("WATCH_WORKING");
      const activeControl = await extractControlFile(active.terminal);

      const expectedCheck = `NOTICE_RECEIVED:[iori] Worker "Active" has been working for 15m. Read its screen with iori screen ${active.childId}. If it repeats itself or works off task, act; otherwise do nothing.`;
      const firstCheckOutput = await parent.output(expectedCheck);
      assert.equal(firstCheckOutput.split(expectedCheck).length - 1, 1);

      const secondCheck = await parent.waitFor(
        ({ output }) => output.split(expectedCheck).length - 1 >= 2,
      );
      assert.equal(secondCheck.output.split(expectedCheck).length - 1, 2);
      assert.equal(
        secondCheck.output.includes(
          `Worker "Stalled" has been working for 15m`,
        ),
        false,
      );
      await parent.output(
        `NOTICE_RECEIVED:[iori] Worker "Stalled" is not responding (no output for 2m). Read its screen with iori screen ${stalled.childId}, act once, and do not check it again.`,
      );

      stage("質問と報告により確認の起点がリセットされる");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const askStartedAt = Date.now();
      await appendFile(activeControl, "ASK_PARENT\n");
      await active.terminal.output("WATCH_CMD:");
      const thirdCheck = await parent.waitFor(
        ({ output }) => output.split(expectedCheck).length - 1 >= 3,
      );
      const elapsedAfterAsk = Date.now() - askStartedAt;
      assert.ok(
        elapsedAfterAsk >= 950,
        `expected ask to reset interval (elapsedAfterAsk=${elapsedAfterAsk}ms)`,
      );
      assert.equal(thirdCheck.output.split(expectedCheck).length - 1, 3);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const reportStartedAt = Date.now();
      await appendFile(activeControl, "REPORT_WORK\n");
      await active.terminal.waitFor(
        ({ output }) => output.split("WATCH_CMD:").length - 1 >= 2,
      );
      const fourthCheck = await parent.waitFor(
        ({ output }) => output.split(expectedCheck).length - 1 >= 4,
      );
      const elapsedAfterReport = Date.now() - reportStartedAt;
      assert.ok(
        elapsedAfterReport >= 950,
        `expected report to reset interval (elapsedAfterReport=${elapsedAfterReport}ms)`,
      );
      assert.equal(fourthCheck.output.split(expectedCheck).length - 1, 4);

      await appendFile(activeControl, "STOP_HEARTBEAT\nHOOK_STOP\n");
      await active.terminal.output("HOOK_STOP_SENT");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === active.terminalId &&
          event.terminal.cliStatus?.state === "done",
      );
      await appendFile(stalledControl, "HOOK_STOP\n");
      await stalled.terminal.output("HOOK_STOP_SENT");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === stalled.terminalId &&
          event.terminal.cliStatus?.state === "done",
      );

      // Windowsでは到着時刻が同じ見回りに揃わないと考えられるため、OS非依存のまとめをLinuxで確かめる。
      if (process.platform === "linux") {
        stage("同時に間隔に達した複数の子は1行にまとめて知らせる");
        const first = await delegateChild(parent, restarted, events, "del-f", {
          title: "First",
          body: "BEHAVIOR_PASSIVE",
        });
        await first.terminal.output("WATCH_PASSIVE");
        const firstControl = await extractControlFile(first.terminal);

        const second = await delegateChild(parent, restarted, events, "del-s", {
          title: "Second",
          body: "BEHAVIOR_PASSIVE",
        });
        await second.terminal.output("WATCH_PASSIVE");
        const secondControl = await extractControlFile(second.terminal);

        await appendFile(firstControl, "BEHAVIOR_WORKING_HEARTBEAT\n");
        await first.terminal.output("WATCH_WORKING");
        await appendFile(secondControl, "BEHAVIOR_WORKING_HEARTBEAT\n");
        await second.terminal.output("WATCH_WORKING");

        // Anchor both baselines mid-poll interval via ask so both reach 15m in the same tick.
        await new Promise((resolve) => setTimeout(resolve, 200));
        await Promise.all([
          appendFile(firstControl, "ASK_PARENT\n"),
          appendFile(secondControl, "ASK_PARENT\n"),
        ]);
        await Promise.all([
          first.terminal.output("WATCH_CMD:"),
          second.terminal.output("WATCH_CMD:"),
        ]);
        const combinedCheck = `NOTICE_RECEIVED:[iori] Worker "First" has been working for 15m. Read its screen with iori screen ${first.childId}; Worker "Second" has been working for 15m. Read its screen with iori screen ${second.childId}. If one repeats itself or works off task, act; otherwise do nothing.`;
        await parent.output(combinedCheck);
        await appendFile(firstControl, "STOP_HEARTBEAT\nHOOK_STOP\n");
        await appendFile(secondControl, "STOP_HEARTBEAT\nHOOK_STOP\n");
      }
    },
    {
      environment: {
        IORI_TEST_STALL_MS: "500",
        IORI_TEST_CHECK_MINUTE_MS: "80",
      },
    },
  ));

async function backgroundTeam(
  client,
  dataRoot,
  cli,
  backgroundWakeMinutes = 7,
) {
  const script = new URL(
    "../../verification/host/background-cli.mjs",
    import.meta.url,
  ).href;
  await writeFakeCli(
    join(dataRoot, "bin"),
    cli === "antigravity" ? "agy" : "claude",
    `process.argv.push(${JSON.stringify(cli === "antigravity" ? "--antigravity" : "--claude")}); await import(${JSON.stringify(script)});`,
  );
  const parentCli = await registerWatchCli(
    client,
    dataRoot,
    "background-parent",
  );
  const team = await client.request("teams.create", {
    definition: {
      name: "Background",
      description: "",
      instruction: "",
      backgroundWakeMinutes,
      checkMinutes: 7,
      parent: {
        id: "parent",
        cli: parentCli,
        model: "",
        tools: [],
        minimum: "",
      },
      roles: [teamRole("worker", "Worker", cli)],
    },
  });
  await client.request("teams.settings", {
    defaultTeam: team.saved.id,
    limits: {},
  });
  const events = await client.events();
  await events.waitFor((e) => e.type === "snapshot");
  const { terminal: launched } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd: dataRoot,
  });
  const parent = await client.terminal(launched.id);
  await parent.output("WATCH_READY:startup");
  async function child(title) {
    const entry = await delegateChild(parent, client, events, title, {
      title,
      body: "Wait for background work",
    });
    const output = await entry.terminal.output(
      /BACKGROUND_CONTROL:([^\r\n]+)/u,
    );
    return {
      ...entry,
      control: output.match(/BACKGROUND_CONTROL:([^\r\n]+)/u)[1],
    };
  }
  return { parent, parentId: launched.id, child, team, events };
}
const backgroundEnvironment = {
  environment: { IORI_TEST_CHECK_MINUTE_MS: "300", IORI_TEST_STALL_MS: "900" },
};
const backgroundReceived = (minutes) =>
  `BACKGROUND_RECEIVED:[iori] Your background command is still running ${minutes} minutes after your response ended. Check its status and output. If it already did what you needed but has not exited, stop it and continue; if it is still needed, keep waiting.`;

for (const cli of ["antigravity", "claude"]) {
  test(`${cli}のバックグラウンド待ちへ同じ間隔で確認し、確認後の未報告を親へ知らせる`, (t) =>
    runHostTest(
      t,
      async ({ client, dataRoot }) => {
        const context = await backgroundTeam(client, dataRoot, cli);
        const child = await context.child("Background");
        const first = await child.terminal.output(
          /BACKGROUND_RECEIVED:[^\r\n]+\r?\n/u,
        );
        assert.ok(first.includes(backgroundReceived(7)), first);
        const repeated = await child.terminal.waitFor(
          ({ output }) => output.split("BACKGROUND_RECEIVED:").length >= 3,
        );
        assert.ok(
          repeated.output.includes(backgroundReceived(14)),
          repeated.output,
        );
        assert.equal(
          (await client.terminal(context.parentId)).values
            .at(-1)
            .output.includes('Worker "Background" is idle without'),
          false,
        );
        await appendFile(child.control, "RESPOND\n");
        await child.terminal.output("BACKGROUND_WILL_RESPOND");
        await child.terminal.output("BACKGROUND_RESPONSE_ENDED");
        await context.parent.output(
          'Worker "Background" is idle without a report or question',
        );
        const tasks = await parentCommand(context.parent, "background-tasks", [
          "tasks",
        ]);
        const unreported = tasks.data.children.find(
          (entry) => entry.child === child.childId,
        );
        assert.equal(unreported.waiting, "report");
        assert.equal(unreported.userInput, undefined);
      },
      backgroundEnvironment,
    ));

  test(`${cli}のバックグラウンド待ちが再開したときとオフのときは確認を送らない`, (t) =>
    runHostTest(
      t,
      async ({ client, dataRoot }) => {
        const context = await backgroundTeam(client, dataRoot, cli);
        const child = await context.child("Background");
        await appendFile(child.control, "ACTIVE\n");
        await child.terminal.output("BACKGROUND_ACTIVE");
        await context.parent.output(
          'Worker "Background" has been working for 7m',
        );
        assert.equal(
          (await client.terminal(child.terminalId)).values
            .at(-1)
            .output.includes("BACKGROUND_RECEIVED:"),
          false,
        );
        await client.request("teams.save", {
          teamId: context.team.saved.id,
          definition: {
            ...context.team.saved,
            backgroundWakeMinutes: 0,
            checkMinutes: 21,
          },
        });
        await appendFile(child.control, "STOP\n");
        await child.terminal.output("BACKGROUND_STOP:2");
        const clock = await context.child("Clock");
        await appendFile(clock.control, "ACTIVE\n");
        await clock.terminal.output("BACKGROUND_ACTIVE");
        await context.parent.output('Worker "Clock" has been working for 21m');
        assert.equal(
          (await client.terminal(child.terminalId)).values
            .at(-1)
            .output.includes("BACKGROUND_RECEIVED:"),
          false,
        );
      },
      backgroundEnvironment,
    ));
}

test("Antigravityのバックグラウンド待ちで親へ応答なしを知らせない", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const context = await backgroundTeam(client, dataRoot, "antigravity", 0);
      await context.child("Background");
      const clock = await context.child("Clock");
      await appendFile(clock.control, "ACTIVE\n");
      await clock.terminal.output("BACKGROUND_ACTIVE");
      const output = await context.parent.output(
        'Worker "Clock" has been working for 7m',
      );
      assert.equal(
        output.includes('Worker "Background" is not responding'),
        false,
      );
    },
    backgroundEnvironment,
  ));

test("報告済みの子にはバックグラウンドの確認を送らず親の判定待ちを保つ", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot }) => {
      const context = await backgroundTeam(client, dataRoot, "claude");
      const reported = await context.child("Reported");
      await appendFile(reported.control, "REPORT\n");
      await reported.terminal.output("BACKGROUND_REPORTED");
      await context.parent.output('Worker "Reported" reported');
      const running = await context.child("Running");
      await running.terminal.output(backgroundReceived(14));
      const tasks = await parentCommand(
        context.parent,
        "reported-background-tasks",
        ["tasks"],
      );
      assert.equal(
        tasks.data.children.find((entry) => entry.child === reported.childId)
          .state,
        "reported",
      );
      assert.equal(
        (await client.terminal(reported.terminalId)).values
          .at(-1)
          .output.includes("BACKGROUND_RECEIVED:"),
        false,
      );
    },
    backgroundEnvironment,
  ));
