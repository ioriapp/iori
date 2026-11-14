import type { CliSummary, CliStatus } from "./cli.ts";
export const MAX_TERMINAL_SNAPSHOT_LINES = 5_000;
export const MAX_TERMINAL_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MOBILE_TERMINAL_SNAPSHOT_LINES = 1_000;
export const MOBILE_TERMINAL_SNAPSHOT_BYTES = 512 * 1024;

export type TerminalState = "running" | "exited" | "error";

export interface TerminalSize {
  cols: number;
  rows: number;
}

export interface TerminalSummary {
  id: string;
  createdAt: number;
  shell: string;
  cwd: string;
  /** Worktree/folder where the user created this Terminal; cwd can change. */
  worktreePath?: string;
  /** The shell reported cwd (OSC 7). Without it, cwd is where the shell
   * started and may be out of date. */
  cwdFromShell?: boolean;
  title: string;
  cli?: CliSummary;
  cliStatus?: CliStatus;
  state?: TerminalState;
  exitCode?: number | null;
  cols: number;
  rows: number;
  lastDesktopSize: TerminalSize;
  restartPending?: boolean;
  /** The CLI was lost at Host restart; only an explicit resume launches it. */
  cliResumePending?: boolean;
  teamConversation?: string;
  /** Stable child identity, also after closing the parent or restarting Host. */
  teamChild?: string;
  cliResumeReason?: "exit";
  setup?: { state: "running" | "failed"; exitCode?: number };
}

export interface TerminalShell {
  id: string;
  label: string;
}

export interface TerminalWindowsPty {
  backend: "conpty" | "winpty";
  buildNumber?: number;
}

export interface TerminalListResult {
  terminals: TerminalSummary[];
  shells: TerminalShell[];
  defaultShell: string;
  homeDirectory: string;
  windowsPty?: TerminalWindowsPty;
}

export interface TerminalCreatedResult {
  terminal: TerminalSummary;
}

export interface TerminalClosedResult {
  terminalId: string;
  confirmationRequired?: boolean;
  command?: string;
}

export interface TerminalDefaultShellResult {
  shell: string;
}

export type TerminalMouseTrackingMode =
  "none" | "x10" | "vt200" | "drag" | "any";

export interface TerminalModes {
  bracketedPaste: boolean;
  mouseTracking: boolean;
  mouseTrackingMode?: TerminalMouseTrackingMode;
  sgrMouseMode: boolean;
  sgrMousePixelsMode: boolean;
  applicationCursor: boolean;
  alternateScreen: boolean;
  kittyKeyboardFlags: number;
}

export interface TerminalOscLinkRange {
  row: number;
  startCol: number;
  endCol: number;
  uri: string;
}

export interface TerminalSnapshot {
  snapshotAnsi: string;
  scrollbackAnsi: string;
  oscLinks?: TerminalOscLinkRange[];
  frameRestoreAnsi?: string;
  rehydrateSequences: string;
  modes: TerminalModes;
  cols: number;
  rows: number;
  pendingEscapeTailAnsi?: string;
  /** The Host keeps more scrollback than this snapshot carries. */
  scrollbackTruncated?: boolean;
}

export type TerminalViewRgb = [number, number, number];

export type TerminalViewAttributes = {
  foreground: TerminalViewRgb;
  background: TerminalViewRgb;
  cursor: TerminalViewRgb;
  ansi: TerminalViewRgb[];
  colorSchemeMode: "dark" | "light";
  cursorStyle: "bar" | "block" | "underline";
  cursorBlink: boolean;
};

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

export interface TerminalOpenStream {
  kind: "terminal";
  operationId: string;
  action: "open";
  terminalId: string;
  viewId: string;
  viewAttributes: TerminalViewAttributes;
  deviceClass: "desktop" | "mobile";
  claimSize?: boolean;
  cols: number;
  rows: number;
  snapshotMaxLines: number;
  snapshotMaxBytes: number;
}

export type TerminalClientMessage =
  | { kind: "terminal.seen" }
  | { kind: "terminal.input"; data: string; origin?: "scroll" }
  | { kind: "terminal.submit"; data: string; id?: string }
  | { kind: "terminal.resize"; cols: number; rows: number }
  | { kind: "terminal.focus"; cols: number; rows: number }
  | {
      kind: "terminal.theme";
      viewAttributes: TerminalViewAttributes;
    };

export type TerminalServerMessage =
  | {
      kind: "terminal.snapshot";
      terminal: TerminalSummary;
      snapshot: TerminalSnapshot;
      sequence: number;
      sizeOwnerViewId: string;
      submitResult?: boolean;
    }
  | { kind: "terminal.submitted"; id: string; success: boolean }
  | { kind: "terminal.output"; data: string; sequence: number }
  | {
      kind: "terminal.size";
      cols: number;
      rows: number;
      lastDesktopSize: TerminalSize;
      sizeOwnerViewId: string;
    }
  | { kind: "terminal.exit"; code: number | null; signal: number | null }
  | { kind: "terminal.error"; message: string };

export type TerminalEvent =
  | { type: "terminal.created"; terminal: TerminalSummary }
  | { type: "terminal.updated"; terminal: TerminalSummary }
  | { type: "terminal.closed"; terminalId: string; processExited?: boolean };
