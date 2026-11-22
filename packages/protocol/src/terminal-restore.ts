import type { TerminalSnapshot } from "./terminal.ts";

/** Shared Host/Client byte order for rebuilding the visible xterm state. */
export function buildTerminalSnapshotRestoreSequence(
  snapshot: TerminalSnapshot,
): string {
  const kittyKeyboard =
    snapshot.modes.kittyKeyboardFlags > 0
      ? `\u001b[=${snapshot.modes.kittyKeyboardFlags};1u`
      : "";
  return [
    snapshot.scrollbackAnsi,
    snapshot.rehydrateSequences,
    snapshot.snapshotAnsi,
    snapshot.frameRestoreAnsi ?? "",
    kittyKeyboard,
    // This may end in an unfinished escape sequence, so it must remain last.
    snapshot.pendingEscapeTailAnsi ?? "",
  ].join("");
}
