import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { HeadlessEmulator } from "../../apps/host/src/terminal/daemon/headless-emulator.ts";
import { writeTerminal } from "../../apps/client/src/terminal/terminal-write.ts";
import { buildTerminalSnapshotRestoreSequence } from "../../packages/protocol/src/terminal.ts";

const { Terminal } = createRequire(
  new URL("../../apps/client/package.json", import.meta.url),
)(
  "@xterm/xterm",
) as typeof import("../../apps/client/node_modules/@xterm/xterm");

// E2E cannot place a layout resize between xterm's write enqueue and its timer.
// Use the real Host's initial snapshot and the Client's real xterm/write path.
test("an initial empty snapshot does not leave restoration pending when layout resizes", async () => {
  const host = new HeadlessEmulator({ cols: 80, rows: 24 });
  const terminal = new Terminal();
  try {
    const snapshot = host.getSnapshot();
    terminal.reset();
    terminal.resize(snapshot.cols, snapshot.rows);
    let restored = false;
    void writeTerminal(
      terminal,
      buildTerminalSnapshotRestoreSequence(snapshot),
    ).then(() => {
      restored = true;
    });
    terminal.resize(81, 25);
    // Completing a later write proves xterm has drained the earlier work.
    await writeTerminal(terminal, "CLI ready");
    assert.equal(restored, true);
    assert.equal(
      terminal.buffer.active.getLine(0)?.translateToString(true),
      "CLI ready",
    );
  } finally {
    terminal.dispose();
    host.dispose();
  }
});
