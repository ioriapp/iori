import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { emit } from "@tauri-apps/api/event";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";

// Use the same platform adapter as the native Client, with Tauri's IPC fixture.
Object.assign(globalThis, { window: { crypto } });
registerHooks({
  resolve(specifier, context, next) {
    return next(
      specifier === "#native-platform"
        ? new URL("./native-platform-tauri.ts", import.meta.url).href
        : specifier,
      context,
    );
  },
});
const { native } = await import("./native.ts");
const { PagedList } = await import("./reading/paged.ts");
const { createReadingTransport } = await import("./reading/transport.ts");
const { ConnectionController } = await import("./connection.ts");

test("a failed notification fetch releases its pending-event listener", async (t) => {
  t.after(clearMocks);
  let reads = 0;
  mockIPC(
    (command) => {
      assert.equal(command, "native_take_notifications");
      if (++reads === 1) throw new Error("fetch failed");
      return [];
    },
    { shouldMockEvents: true },
  );
  await assert.rejects(
    native.onNotification(() => {}),
    /fetch failed/u,
  );
  await emit("native://notification-pending");
  assert.equal(reads, 1);
});

test("refresh reads the current page after the previous read fails", async () => {
  let failPrevious!: (error: Error) => void;
  const previous = new Promise<{ items: string[] }>((_, reject) => {
    failPrevious = reject;
  });
  let reads = 0;
  const list = new PagedList(() =>
    ++reads === 1
      ? previous
      : Promise.resolve({ items: ["current"], total: 1 }),
  );
  const errors: unknown[] = [];
  list.subscribe(() => {
    if (list.error) errors.push(list.error);
  });
  list.ensure(0, 0);
  list.refresh();
  failPrevious(new Error("previous page failed"));
  await setImmediate();
  assert.deepEqual(errors, []);
  assert.equal(list.get(0), "current");
});

test("ending one reading watch restores only that subscription and rereads the folder", async (t) => {
  const ids: string[] = [];
  mockIPC(
    (command, args) => {
      if (command === "native_subscribe" && args && "cancelKey" in args) {
        const subscriptionId = String(args.cancelKey);
        ids.push(subscriptionId);
        return { subscriptionId };
      }
    },
    { shouldMockEvents: true },
  );
  const controller = new ConnectionController();
  t.mock.method(controller, "connectionIdOf", () => "connection");
  t.mock.method(controller, "getSnapshot", () => ({
    connectedHosts: ["host"],
  }));
  const changes: unknown[] = [];
  const stop = createReadingTransport("host", controller).watch(
    "/folder",
    "files",
    (change) => changes.push(change),
    assert.fail,
  );
  t.after(() => {
    stop();
  });
  await setImmediate();
  const ended = (id: string) =>
    emit("native://subscription-ended", {
      connectionId: "connection",
      subscriptionId: id,
    });
  const [first] = ids;
  assert.ok(first);
  await ended("another-watch");
  assert.deepEqual(ids, [first]);
  await ended(first);
  await setImmediate();
  assert.equal(ids.length, 2);
  assert.notEqual(ids[1], first);
  assert.deepEqual(changes, [{}, {}]);
  stop();
  await ended(ids[1]);
  assert.equal(ids.length, 2);
});

test("a delayed CLI snapshot preserves intervening order and usage updates", async () => {
  const { updateCliList } = await import("./cli-list.ts");
  const previousUsage = { windows: [{ minutes: 60, remaining: 80 }] };
  const newUsage = { windows: [{ minutes: 60, remaining: 65 }] };
  const first = { id: "a", name: "A", hidden: false, usage: previousUsage };
  const second = { id: "b", name: "B", hidden: false };
  let state = updateCliList(
    { hostKey: "host", list: { clis: [] }, error: false },
    "host",
    { type: "reading" },
  );
  state = updateCliList(state, "host", {
    type: "changed",
    event: { type: "cli.usage", cliId: "a" },
  });
  state = updateCliList(state, "host", {
    type: "changed",
    event: { type: "cli.order.changed", order: ["b", "a"] },
  });
  state = updateCliList(state, "host", {
    type: "changed",
    event: { type: "cli.usage", cliId: "b", usage: newUsage },
  });
  const { list } = updateCliList(state, "host", {
    type: "received",
    list: { clis: [first, second] },
  });
  assert.deepEqual(list.clis, [
    { ...second, usage: newUsage },
    { ...first, usage: undefined },
  ]);
});

test("an opening terminal drains accepted input through stream replacement and tab close", async (t) => {
  const { TerminalStreamController } =
    await import("./terminal/terminal-stream-controller.ts");
  let finishOpening!: () => void;
  const opened = new Promise<void>((resolve) => {
    finishOpening = resolve;
  });
  let finishWriting!: () => void;
  const written = new Promise<void>((resolve) => {
    finishWriting = resolve;
  });
  const messages: { command: string; id: string; data?: string }[] = [];
  mockIPC(
    async (command, args) => {
      if (!args || !("streamId" in args)) return;
      const id = String(args.streamId);
      if (command === "native_terminal_open") await opened;
      if (command === "native_terminal_write") await written;
      const data =
        "json" in args ? JSON.parse(String(args.json)).data : undefined;
      messages.push({ command, id, data });
    },
    { shouldMockEvents: true },
  );
  t.after(clearMocks);
  const stream = new TerminalStreamController(
    "view",
    () => true,
    () => ({ cols: 80, rows: 24 }),
    assert.fail,
  );
  const stop = stream.attach({
    connectionId: "connection",
    terminalId: "terminal",
    mobile: false,
    fullHistory: () => true,
    measure: async () => ({
      fitted: true,
      attributes: {
        foreground: [255, 255, 255],
        background: [0, 0, 0],
        cursor: [255, 255, 255],
        ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
        colorSchemeMode: "dark",
        cursorStyle: "block",
        cursorBlink: true,
      },
    }),
    claimOnOpen: () => true,
    apply: async () => {},
    ended: () => true,
  });
  const first = stream.snapshot().id;
  stream.input("first");
  await setImmediate();
  stream.reopen();
  const second = stream.snapshot().id;
  stream.input("second");
  stop();
  await setImmediate();
  assert.equal(messages.length, 0);
  finishOpening();
  await setImmediate();
  assert.ok(
    messages.every((message) => message.command === "native_terminal_open"),
  );
  finishWriting();
  await setImmediate();
  for (const [id, data] of [
    [first, "first"],
    [second, "second"],
  ]) {
    assert.deepEqual(
      messages.filter((message) => message.id === id),
      [
        { command: "native_terminal_open", id, data: undefined },
        { command: "native_terminal_write", id, data },
        { command: "native_terminal_detach", id, data: undefined },
      ],
    );
  }
});
