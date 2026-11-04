import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { HostStore } from "../store.ts";
import { TerminalManager } from "./manager.ts";
import { stopTerminalDaemon } from "./daemon/launch.ts";
const context = () => ({ clientPublicKey: "test", operationId: randomUUID() });

// A Client opens a Terminal it learnt of from a list or an event, which can
// come while the Host is still creating it. A UI scenario cannot open the
// stream inside that interval; this opens it as soon as the Terminal is listed,
// through the real creation, stream opening, Terminal daemon and shell.
test("a view opened while a CLI's Terminal is created never drops the CLI's start", async () => {
  const root = await mkdtemp(join(tmpdir(), "iori-terminal-open-test-"));
  const started = join(root, "cli-started");
  const actor = join(root, "actor.mjs");
  await writeFile(
    actor,
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(started)},'started');process.stdin.resume();`,
  );
  const quote = (v: string) =>
    process.platform === "win32"
      ? `'${v.replaceAll("'", "''")}'`
      : `'${v.replaceAll("'", "'\\''")}'`;
  const store = new HostStore(join(root, "host.sqlite"));
  const terminals = await TerminalManager.create(store, () => {}, root);
  let closeView!: () => void;
  // Stops the stand-in view's search when the creation itself failed.
  let watching = true;
  const viewClosed = new Promise<undefined>((resolve) => {
    closeView = () => resolve(undefined);
  });
  try {
    // The actor is a CLI added by name and launch command.
    const added = await terminals.saveSimpleCliDefinition(context(), {
      name: "Start marker",
      command: `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(actor)}`,
      modelArgument: "",
    });
    assert.ok(added.ok && "cliId" in added.result);
    const cliId = added.result.cliId;
    const listed = new Set(store.listTerminals().map((item) => item.id));
    let opened = false;
    const view = (async () => {
      while (watching) {
        const found = store
          .listTerminals()
          .find((item) => !listed.has(item.id));
        if (found) {
          opened = true;
          // The Client's side of the stream only receives frames here.
          const stream = {
            write: async () => {},
            finish: async () => {},
            stop: async () => {},
            reset: async () => {},
          };
          return terminals.openStream(
            {} as never,
            stream as never,
            {
              kind: "terminal",
              action: "open",
              operationId: randomUUID(),
              terminalId: found.id,
              viewId: randomUUID(),
              deviceClass: "desktop",
              cols: 80,
              rows: 24,
              snapshotMaxLines: 100,
              snapshotMaxBytes: 1024 * 1024,
              viewAttributes: {
                foreground: [255, 255, 255],
                background: [0, 0, 0],
                cursor: [255, 255, 255],
                ansi: Array.from(
                  { length: 16 },
                  () => [0, 0, 0] as [number, number, number],
                ),
                colorSchemeMode: "dark",
                cursorStyle: "block",
                cursorBlink: false,
              },
            },
            () => viewClosed,
          );
        }
        await nextTurn();
      }
    })();
    const created = await terminals.createTerminal(
      context(),
      root,
      undefined,
      cliId,
    );
    assert.ok(created.ok);
    assert.ok(opened, "作成の途中でTerminalを開いた");
    // Ends inside the test, so a missing start stops the daemon and its shell
    // below instead of waiting for the runner's timeout.
    for (const deadline = Date.now() + 30_000; ;) {
      const value = await readFile(started, "utf8").catch(() => undefined);
      if (value === "started") break;
      assert.ok(Date.now() < deadline, "CLIが30秒以内に始まる");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(store.terminalCli(created.result.terminal.id)?.cli.id, cliId);
    closeView();
    await view;
  } finally {
    watching = false;
    closeView();
    await terminals.close();
    await stopTerminalDaemon(root);
    store.close();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
