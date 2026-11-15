import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";
import { registerWatchCli } from "./fixtures/watch-definition.mjs";

const STALL_MS = 500;

async function extractControlFile(terminal) {
  const output = await terminal.output(/WATCH_CONTROL:([^\r\n]+)\r?\n/u);
  return output.match(/WATCH_CONTROL:([^\r\n]+)\r?\n/u)[1];
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

test("作業中のCLIは出力停止でstalledSinceが付き、再開出力では消えず、hook更新と入力で消え、active以外は付かない", (t) =>
  runHostTest(
    t,
    async ({ client, dataRoot, stage }) => {
      const cliId = await registerWatchCli(client, dataRoot);
      const events = await client.events();
      const nextEvent = createEventReader(events);
      await nextEvent((event) => event.type === "snapshot");

      stage("単独のCLIを起動してactiveにする");
      const { terminal: created } = await client.request("cli.launch", {
        cliId,
        cwd: dataRoot,
      });
      const pty = await client.terminal(created.id);
      await pty.output("WATCH_READY:startup");
      const controlFile = await extractControlFile(pty);

      await appendFile(controlFile, "HOOK_ACTIVE\n");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.state === "active",
      );

      stage("出力が止まるとstalledSinceが付く");
      const stalledEvent = await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.stalledSince !== undefined,
      );
      const firstSince = stalledEvent.terminal.cliStatus.stalledSince;
      assert.equal(stalledEvent.terminal.cliStatus.state, "active");
      assert.equal(typeof firstSince, "number");

      stage("入力なしのPTY出力だけではstalledSinceが消えない");
      await appendFile(controlFile, "EMIT_OUTPUT\n");
      await pty.output("RESUMED_PTY_OUTPUT");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const listAfterOutput = await client.request("terminal.list");
      const persistedAfterOutput = listAfterOutput.terminals.find(
        (term) => term.id === created.id,
      );
      assert.equal(persistedAfterOutput.cliStatus.stalledSince, firstSince);

      stage("CLIのhookによる状態更新でstalledSinceが消える");
      await appendFile(controlFile, "HOOK_ACTIVE\n");
      const clearedByHook = await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.state === "active" &&
          event.terminal.cliStatus.stalledSince === undefined,
      );
      assert.equal(clearedByHook.terminal.cliStatus.stalledSince, undefined);

      stage("再び止まった後、Terminal入力でstalledSinceが消える");
      const secondStall = await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.stalledSince !== undefined,
      );
      assert.ok(secondStall.terminal.cliStatus.stalledSince > firstSince);

      await pty.input("continue");
      const clearedByInput = await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.stalledSince === undefined,
      );
      assert.equal(clearedByInput.terminal.cliStatus.stalledSince, undefined);

      stage("waitingおよびdone状態ではstalledSinceが付かない");
      await appendFile(controlFile, "HOOK_WAITING\n");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.state === "waiting",
      );
      await new Promise((resolve) => setTimeout(resolve, STALL_MS + 250));
      const waitList = await client.request("terminal.list");
      assert.equal(
        waitList.terminals.find((term) => term.id === created.id).cliStatus
          .stalledSince,
        undefined,
      );

      await appendFile(controlFile, "HOOK_STOP\n");
      await nextEvent(
        (event) =>
          event.type === "terminal.updated" &&
          event.terminal.id === created.id &&
          event.terminal.cliStatus?.state === "done",
      );
      await new Promise((resolve) => setTimeout(resolve, STALL_MS + 250));
      const doneList = await client.request("terminal.list");
      assert.equal(
        doneList.terminals.find((term) => term.id === created.id).cliStatus
          .stalledSince,
        undefined,
      );
    },
    { environment: { IORI_TEST_STALL_MS: String(STALL_MS) } },
  ));

test(
  "Linuxで作業中のCLIが停止状態の子孫を持つ間は出力が続いていてもstalledSinceが付く",
  { skip: process.platform !== "linux" },
  (t) =>
    runHostTest(
      t,
      async ({ client, dataRoot, stage }) => {
        const cliId = await registerWatchCli(client, dataRoot);
        const events = await client.events();
        const nextEvent = createEventReader(events);
        await nextEvent((event) => event.type === "snapshot");

        stage("CLIを起動し停止状態の子プロセスと連続出力を始める");
        const { terminal: created } = await client.request("cli.launch", {
          cliId,
          cwd: dataRoot,
        });
        const pty = await client.terminal(created.id);
        await pty.output("WATCH_READY:startup");
        const controlFile = await extractControlFile(pty);

        await appendFile(controlFile, "BEHAVIOR_STOPPED_CHILD\n");
        await pty.output("STOPPED_CHILD_STARTED:");
        const beforeStall = await pty.output("HEARTBEAT");
        const heartbeatsBefore = beforeStall.split("HEARTBEAT").length - 1;

        stage("出力が途切れなくてもstopped子孫でstalledSinceが付く");
        const stalledEvent = await nextEvent(
          (event) =>
            event.type === "terminal.updated" &&
            event.terminal.id === created.id &&
            event.terminal.cliStatus?.stalledSince !== undefined,
        );
        const { output: afterStall } = await pty.waitFor(
          ({ output }) =>
            output.split("HEARTBEAT").length - 1 > heartbeatsBefore,
        );
        const heartbeatsAfter = afterStall.split("HEARTBEAT").length - 1;
        assert.ok(
          heartbeatsAfter > heartbeatsBefore,
          "HEARTBEAT出力が続いている間で止まりを見分ける",
        );
        assert.equal(
          typeof stalledEvent.terminal.cliStatus.stalledSince,
          "number",
        );

        stage("停止子プロセスとCLI終了で状態が片付く");
        await appendFile(controlFile, "KILL_STOPPED\n");
        await pty.output("STOPPED_CHILD_CLEARED");
        await appendFile(controlFile, "HOOK_STOP\n");
        await nextEvent(
          (event) =>
            event.type === "terminal.updated" &&
            event.terminal.id === created.id &&
            event.terminal.cliStatus?.state === "done" &&
            event.terminal.cliStatus.stalledSince === undefined,
        );
      },
      { environment: { IORI_TEST_STALL_MS: String(STALL_MS) } },
    ),
);
