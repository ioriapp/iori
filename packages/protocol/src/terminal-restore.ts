import type { TerminalSnapshot, TerminalWindowsPty } from "./terminal.ts";

export type WindowsPtyCompatibilityOptions = {
  windowsPty?: TerminalWindowsPty;
  reflowCursorLine?: boolean;
};

// Derived from Orca terminal helpers.
// Copyright (c) 2026 Lovecast Inc.; see ../../../apps/client/third-party/ORCA-MIT-LICENSE.txt for the MIT license.
/** xterm receives the PTY backend and Windows build reported by its Host. */
export function buildWindowsPtyCompatibilityOptions(
  hostPty: TerminalWindowsPty | undefined,
): WindowsPtyCompatibilityOptions {
  if (!hostPty) return {};
  const windowsPty =
    hostPty.buildNumber === undefined || hostPty.buildNumber < 21_376
      ? { backend: hostPty.backend }
      : hostPty;
  return {
    windowsPty,
    ...(hostPty.backend === "conpty" ? { reflowCursorLine: true } : {}),
  };
}

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
