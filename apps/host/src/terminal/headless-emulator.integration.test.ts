import assert from "node:assert/strict";
import test from "node:test";
import { replayTerminalSnapshot } from "./daemon/terminal-snapshot-replay.ts";
import { HeadlessEmulator } from "./daemon/headless-emulator.ts";
// E2E cannot place a PTY receive boundary inside an unfinished escape sequence.
test("headless replay does not lose alt screen, escape tail or kitty keyboard mode", async () => {
  const source = new HeadlessEmulator({ cols: 40, rows: 6 });
  const restored = new HeadlessEmulator({ cols: 40, rows: 6 });

  try {
    await source.write("old one\r\nold two\r\nold cursor");
    await source.write(
      "\x1b[?1000h\x1b[?2004h\x1b[?1h\x1b[?1049h\x1b[=1;1u\x1b[2J\x1b[HVIM SCREEN TOP\r\n~\r\n-- INSERT --",
    );
    await source.write("\x1b]2;");
    const snapshot = source.getSnapshot();
    assert.equal(snapshot.modes.alternateScreen, true);
    assert.equal(snapshot.pendingEscapeTailAnsi, "\x1b]2;");

    await replayTerminalSnapshot(restored, snapshot);
    assert.ok(
      restored
        .getVisibleLines()
        .some((line) => line.includes("VIM SCREEN TOP")),
    );
    assert.equal(restored.getSnapshot().modes.alternateScreen, true);
    assert.equal(restored.getSnapshot().modes.kittyKeyboardFlags, 1);
    await restored.write("restored title\x07");
    assert.equal(restored.getLastTitle(), "restored title");
  } finally {
    source.dispose();
    restored.dispose();
  }
});

test("headless replay keeps an OSC title tail at every split boundary", async () => {
  const sequence = "\x1b]2;split title\x07";
  for (let split = 1; split < sequence.length; split += 1) {
    const source = new HeadlessEmulator({ cols: 40, rows: 6 });
    const restored = new HeadlessEmulator({ cols: 40, rows: 6 });
    try {
      await source.write(sequence.slice(0, split));
      const snapshot = source.getSnapshot();
      assert.equal(snapshot.pendingEscapeTailAnsi, sequence.slice(0, split));
      await replayTerminalSnapshot(restored, snapshot);
      await restored.write(sequence.slice(split));
      assert.equal(restored.getLastTitle(), "split title");
    } finally {
      source.dispose();
      restored.dispose();
    }
  }
});
