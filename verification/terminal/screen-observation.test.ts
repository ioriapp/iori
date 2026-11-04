import assert from "node:assert/strict";
import test from "node:test";
import type { TerminalServerMessage } from "../../packages/protocol/src/index.ts";
import { HeadlessEmulator } from "../../apps/host/src/terminal/daemon/headless-emulator.ts";
import { TerminalScreenObservation } from "./screen-observation.ts";

async function attach(
  observer: TerminalScreenObservation,
  stream: string,
  cols = 12,
) {
  const source = new HeadlessEmulator({ cols, rows: 4 });
  try {
    await observer.apply(stream, {
      kind: "terminal.snapshot",
      snapshot: source.getSnapshot(),
      terminal: {
        id: stream,
        shell: "bash",
        title: "test",
        cwd: "/tmp",
        cols,
        rows: 4,
        lastDesktopSize: { cols, rows: 4 },
      },
      sequence: 0,
      sizeOwnerViewId: "view",
    });
  } finally {
    source.dispose();
  }
}
const output = (data: string): TerminalServerMessage => ({
  kind: "terminal.output",
  data,
  sequence: 1,
});
// E2E assertions use this observer, so they cannot independently detect its
// false matches from unchanged rows, other streams, or automatic wrapping.
test("screen observation excludes unchanged rows after clear, separates streams, and joins wrapped lines", async () => {
  const redraw = "not deiivered yet\x1b[1;7Hl";
  const observer = new TerminalScreenObservation();
  try {
    await attach(observer, "parent", 40);
    await attach(observer, "other", 40);
    await observer.apply("parent", output(redraw));
    assert.ok(observer.text("parent").includes("not delivered yet"));
    assert.equal(observer.text("other").includes("not delivered yet"), false);
    observer.clear();
    await observer.apply("parent", output("\x1b[1;1Hnot delivered yet"));
    assert.equal(observer.text("parent"), "");
    await observer.apply("parent", output("\x1b[2;1Hnew result"));
    assert.ok(observer.text("parent").includes("new result"));
    assert.equal(observer.text("parent").includes("not delivered yet"), false);
    assert.ok(observer.currentText("parent").includes("new result"));
    await observer.apply("parent", output("\x1b[2;1H\x1b[2Kerased"));
    // Historical observations can match a reply that a later repaint erased.
    assert.ok(observer.text("parent").includes("new result"));
    assert.equal(observer.currentText("parent").includes("new result"), false);
    await attach(observer, "wrapped");
    await observer.apply("wrapped", output("not delivered yet"));
    assert.ok(observer.text("wrapped").includes("not delivered yet"));
  } finally {
    observer.dispose();
  }
});
// A snapshot may arrive in the middle of an escape sequence, which UI actions
// cannot choose. Clear must keep the parser's unfinished sequence too.
test("screen observation replays alternate-screen snapshots and preserves parser state across clear", async () => {
  const observer = new TerminalScreenObservation();
  const source = new HeadlessEmulator({ cols: 40, rows: 4 });
  try {
    await source.write(
      "old history\x1b[?1049h\x1b[2J\x1b[Hvisible reply\x1b[2;",
    );
    await observer.apply("parent", {
      kind: "terminal.snapshot",
      snapshot: source.getSnapshot(),
      terminal: {
        id: "parent",
        shell: "bash",
        title: "test",
        cwd: "/tmp",
        cols: 40,
        rows: 4,
        lastDesktopSize: { cols: 40, rows: 4 },
      },
      sequence: 0,
      sizeOwnerViewId: "view",
    });
    assert.ok(observer.text("parent").includes("visible reply"));
    assert.equal(observer.text("parent").includes("old history"), false);
    observer.clear();
    await observer.apply("parent", output("1Hsecond reply"));
    assert.ok(observer.text("parent").includes("second reply"));
    assert.equal(observer.text("parent").includes("1Hsecond reply"), false);
  } finally {
    observer.dispose();
    source.dispose();
  }
});
