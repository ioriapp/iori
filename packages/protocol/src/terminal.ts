import * as v from "valibot";
import {
  integer,
  identifier,
  schema,
  type ValueSchema,
  record,
} from "./primitives.ts";
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
  teamName?: string;
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

const channel = integer(0, 255);
const rgb = v.strictTuple([channel, channel, channel]);
export type TerminalViewRgb = v.InferOutput<typeof rgb>;
const viewAttributes = v.object({
  foreground: rgb,
  background: rgb,
  cursor: rgb,
  ansi: v.pipe(v.array(rgb), v.length(256)),
  colorSchemeMode: v.picklist(["dark", "light"]),
  cursorStyle: v.picklist(["bar", "block", "underline"]),
  cursorBlink: v.boolean(),
});
export type TerminalViewAttributes = v.InferOutput<typeof viewAttributes>;
const size = { cols: integer(1, 65535), rows: integer(1, 65535) };
const openStream = v.object({
  kind: v.literal("terminal"),
  action: v.literal("open"),
  operationId: identifier,
  terminalId: identifier,
  viewId: identifier,
  viewAttributes,
  deviceClass: v.picklist(["desktop", "mobile"]),
  claimSize: v.optional(v.boolean()),
  ...size,
  snapshotMaxLines: integer(1, MAX_TERMINAL_SNAPSHOT_LINES),
  snapshotMaxBytes: integer(1, MAX_TERMINAL_SNAPSHOT_BYTES),
});
export type TerminalOpenStream = v.InferOutput<typeof openStream>;
export const terminalOpenStreamSchema = schema(openStream);
const clientMessages = v.variant("kind", [
  v.object({ kind: v.literal("terminal.seen") }),
  v.pipe(
    v.object({
      kind: v.literal("terminal.input"),
      data: v.string(),
      origin: v.optional(v.unknown()),
    }),
    v.transform(({ kind, data, origin }) => ({
      kind,
      data,
      ...(origin === "scroll" ? { origin: "scroll" as const } : {}),
    })),
  ),
  v.object({
    kind: v.literal("terminal.submit"),
    data: v.string(),
    id: v.optional(identifier),
  }),
  v.object({ kind: v.literal("terminal.resize"), ...size }),
  v.object({ kind: v.literal("terminal.focus"), ...size }),
  v.object({ kind: v.literal("terminal.theme"), viewAttributes }),
]);
export type TerminalClientMessage = v.InferOutput<typeof clientMessages>;
const knownMessage = schema(clientMessages);
export const terminalClientMessageSchema: ValueSchema<
  TerminalClientMessage | undefined
> = {
  parse(value) {
    const input = record(value);
    if (
      clientMessages.options.some(
        (option) => option.entries.kind.literal === input.kind,
      )
    )
      return knownMessage.parse(input);
    return undefined;
  },
};
export { buildTerminalSnapshotRestoreSequence } from "./terminal-restore.ts";

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
