import { createRequire } from "node:module";
import type { Terminal } from "@xterm/headless";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import {
  buildTerminalSnapshotRestoreSequence,
  type TerminalSnapshot,
} from "@iori/protocol";
import { activateOrcaTerminalUnicodeProvider } from "./shared/terminal-unicode-provider.ts";

const { Terminal: HeadlessTerminal } = createRequire(import.meta.url)(
  "@xterm/headless",
) as typeof import("@xterm/headless");

/** Replay a viewport snapshot to read only the currently visible lines. */
export async function visibleScreenLinesFromSnapshot(
  snapshot: TerminalSnapshot,
): Promise<string[]> {
  const terminal: Terminal = new HeadlessTerminal({
    cols: Math.max(1, snapshot.cols),
    rows: Math.max(1, snapshot.rows),
    scrollback: 0,
    allowProposedApi: true,
  });
  try {
    terminal.loadAddon(new Unicode11Addon());
    activateOrcaTerminalUnicodeProvider(terminal);
    const sequence = buildTerminalSnapshotRestoreSequence(snapshot);
    await new Promise<void>((resolve) => {
      terminal.write(sequence, resolve);
    });
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let row = 0; row < terminal.rows; row++) {
      const line = buffer.getLine(buffer.viewportY + row);
      lines.push(line ? line.translateToString(true) : "");
    }
    while (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines;
  } finally {
    terminal.dispose();
  }
}
