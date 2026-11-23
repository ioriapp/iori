import {
  fail,
  record,
  readable,
  nonEmptyString,
  string,
  hostPath,
  boolean,
  readableItems,
  nonNegativeInteger,
  type ValueSchema,
} from "./primitives.ts";
import {
  type TerminalState,
  type TerminalSize,
  type TerminalSummary,
  type TerminalShell,
  type TerminalWindowsPty,
  type TerminalListResult,
  type TerminalCreatedResult,
  type TerminalClosedResult,
  type TerminalDefaultShellResult,
  type TerminalModes,
  type TerminalMouseTrackingMode,
  type TerminalOscLinkRange,
  type TerminalSnapshot,
  type TerminalServerMessage,
} from "./terminal.ts";
import {
  type CliSummary,
  parseCliUsage,
  parseCliStatus,
  type CliListResult,
} from "./cli.ts";
import {
  parseCliSimpleDefinition,
  type CliSupport,
  CLI_FEATURES,
  type CliDefinitionFailure,
  type CliDefinitionReason,
} from "./cli-definitions.ts";

function terminalDimension(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    return fail(`${field} must be an integer from 1 to 65535`);
  }
  return value;
}

function terminalState(value: unknown): TerminalState | undefined {
  if (value === "running" || value === "exited" || value === "error") {
    return value;
  }
  return undefined;
}

function parseTerminalSize(value: unknown, field: string): TerminalSize {
  const input = record(value);
  return {
    cols: terminalDimension(input.cols, `${field}.cols`),
    rows: terminalDimension(input.rows, `${field}.rows`),
  };
}

function parseCliSummary(value: unknown): CliSummary {
  const input = record(value);
  const usage = parseCliUsage(input.usage);
  const icon = readable(record, input.icon);
  const support = parseCliSupport(input.support);
  const simple = readable(parseCliSimpleDefinition, input.simple);
  const files = Array.isArray(input.files)
    ? input.files.flatMap((value): import("./cli.ts").CliDefinitionFile[] => {
        const item = readable(record, value);
        return typeof item?.name === "string" &&
          item.name.length > 0 &&
          (item.kind === "usage" ||
            item.kind === "tokens" ||
            item.kind === "plugin")
          ? [{ name: item.name, kind: item.kind }]
          : [];
      })
    : undefined;
  return {
    id: nonEmptyString(input.id, "cli.id"),
    name: nonEmptyString(input.name, "cli.name"),
    ...(typeof input.hidden === "boolean" ? { hidden: input.hidden } : {}),
    ...(typeof icon?.light === "string"
      ? {
          icon: {
            light: icon.light,
            ...(icon.source === "host" ? { source: "host" as const } : {}),
            ...(typeof icon.dark === "string" ? { dark: icon.dark } : {}),
          },
        }
      : {}),
    ...(typeof input.version === "string" && input.version
      ? { version: input.version }
      : {}),
    ...(typeof input.supportsUsage === "boolean"
      ? { supportsUsage: input.supportsUsage }
      : {}),
    ...(typeof input.launchEffort === "boolean"
      ? { launchEffort: input.launchEffort }
      : {}),
    ...(usage ? { usage } : {}),
    ...(typeof input.startupArguments === "string"
      ? { startupArguments: input.startupArguments }
      : {}),
    ...(input.source === "official" ||
    input.source === "bundled" ||
    input.source === "user" ||
    input.source === "override"
      ? { source: input.source }
      : {}),
    ...(input.missing === true ? { missing: true } : {}),
    ...(input.customIcon === true ? { customIcon: true } : {}),
    ...(support ? { support } : {}),
    ...(typeof input.definition === "string"
      ? { definition: input.definition }
      : {}),
    ...(simple ? { simple } : {}),
    ...(files ? { files } : {}),
  };
}
const supportValues: CliSupport[] = ["available", "unavailable", "undefined"];
function parseCliSupport(value: unknown): CliSummary["support"] {
  const input = readable(record, value);
  if (!input) return undefined;
  const entries = CLI_FEATURES.map(
    (feature) => [feature, input[feature]] as const,
  );
  return entries.every(([, support]) =>
    supportValues.includes(support as CliSupport),
  )
    ? (Object.fromEntries(entries) as CliSummary["support"])
    : undefined;
}
function parseCliDefinitionFailure(value: unknown): CliDefinitionFailure {
  const input = record(value);
  return {
    folder: nonEmptyString(input.folder, "folder"),
    reason: record(input.reason) as CliDefinitionReason,
    definition: string(input.definition, "definition"),
  };
}
export function parseChildSummary(
  value: unknown,
): import("./teams.ts").ChildSummary {
  const input = record(value);
  const state = input.state;
  if (
    state !== "waiting" &&
    state !== "starting" &&
    state !== "running" &&
    state !== "reported" &&
    state !== "question" &&
    state !== "stopped" &&
    state !== "failed" &&
    state !== "finished"
  )
    return fail("invalid child state");
  if (
    input.waiting !== undefined &&
    input.waiting !== "capacity" &&
    input.waiting !== "candidates"
  )
    return fail("invalid child waiting reason");
  if (
    input.stoppedBy !== undefined &&
    input.stoppedBy !== "parent" &&
    input.stoppedBy !== "user" &&
    input.stoppedBy !== "host_restart" &&
    input.stoppedBy !== "parent_exit"
  )
    return fail("invalid child stop reason");
  if (
    input.decision !== undefined &&
    input.decision !== "accept" &&
    input.decision !== "reject"
  )
    return fail("invalid child decision");
  const optionalNumber = (field: string) => {
    const value = input[field];
    if (value === undefined) return {};
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return fail(`invalid child ${field}`);
    return { [field]: value };
  };
  const optionalText = (field: string) =>
    input[field] === undefined
      ? {}
      : { [field]: string(input[field], `child.${field}`) };
  const cliStatus = parseCliStatus(input.cliStatus);
  return {
    id: nonEmptyString(input.id, "child.id"),
    createdAt: nonNegativeInteger(input.createdAt, "child.createdAt"),
    conversation: nonEmptyString(input.conversation, "child.conversation"),
    parentTerminalId: nonEmptyString(
      input.parentTerminalId,
      "child.parentTerminalId",
    ),
    parentCwd: hostPath(input.parentCwd, "child.parentCwd"),
    teamId: nonEmptyString(input.teamId, "child.teamId"),
    role: string(input.role, "child.role"),
    title: string(input.title, "child.title"),
    state,
    ...optionalText("terminalId"),
    ...(input.createdWorktree === undefined
      ? {}
      : {
          createdWorktree: boolean(
            input.createdWorktree,
            "child.createdWorktree",
          ),
        }),
    ...(input.worktreeRemoved === undefined
      ? {}
      : {
          worktreeRemoved: boolean(
            input.worktreeRemoved,
            "child.worktreeRemoved",
          ),
        }),
    ...optionalText("repositoryName"),
    ...optionalText("branch"),
    ...(input.cwd === undefined
      ? {}
      : { cwd: hostPath(input.cwd, "child.cwd") }),
    ...(input.cli === undefined
      ? {}
      : { cli: readable(parseCliSummary, input.cli) }),
    ...(cliStatus ? { cliStatus } : {}),
    ...optionalText("model"),
    ...optionalText("reason"),
    ...optionalText("failure"),
    ...optionalNumber("startedAt"),
    ...optionalNumber("elapsedMs"),
    ...(input.waiting === undefined ? {} : { waiting: input.waiting }),
    ...(input.stoppedBy === undefined ? {} : { stoppedBy: input.stoppedBy }),
    ...(input.decision === undefined ? {} : { decision: input.decision }),
    ...(input.notified === undefined
      ? {}
      : {
          notified:
            typeof input.notified === "boolean"
              ? input.notified
              : fail("invalid child.notified"),
        }),
  };
}
export function parseChildrenResult(value: unknown): {
  children: import("./teams.ts").ChildSummary[];
} {
  const input = record(value);
  if (!Array.isArray(input.children)) return fail("children must be an array");
  return { children: readableItems(parseChildSummary, input.children) };
}
export function parseCliListResult(value: unknown): CliListResult {
  const input = record(value);
  if (!Array.isArray(input.clis)) return fail("clis must be an array");
  return {
    ...(typeof input.shell === "string" ? { shell: input.shell } : {}),
    ...(input.orderable === true ? { orderable: true as const } : {}),
    clis: readableItems(parseCliSummary, input.clis).map((cli) => ({
      ...cli,
      hidden: cli.hidden === true,
    })),
    ...(typeof input.lastUsedId === "string"
      ? { lastUsedId: input.lastUsedId }
      : {}),
    ...(Array.isArray(input.failed)
      ? { failed: readableItems(parseCliDefinitionFailure, input.failed) }
      : {}),
  };
}
export function cliStartupArguments(value: unknown): string {
  const text = string(value, "arguments");
  if (text.length > 4096 || /[\u0000-\u001f\u007f]/u.test(text))
    return fail("arguments is invalid");
  return text;
}

function parseSetupState(
  value: unknown,
): NonNullable<TerminalSummary["setup"]> {
  const input = record(value);
  if (input.state !== "running" && input.state !== "failed")
    return fail("Unsupported setup state");
  if (
    input.exitCode !== undefined &&
    (typeof input.exitCode !== "number" ||
      !Number.isSafeInteger(input.exitCode))
  )
    return fail("Invalid setup exit code");
  return {
    state: input.state,
    ...(input.exitCode === undefined
      ? {}
      : { exitCode: input.exitCode as number }),
  };
}

export function parseTerminalSummary(value: unknown): TerminalSummary {
  const input = record(value);
  const cliStatus =
    input.cliStatus === undefined ? undefined : parseCliStatus(input.cliStatus);
  return {
    id: nonEmptyString(input.id, "terminal.id"),
    createdAt: nonNegativeInteger(input.createdAt, "terminal.createdAt"),
    shell: nonEmptyString(input.shell, "terminal.shell"),
    cwd: nonEmptyString(input.cwd, "terminal.cwd"),
    ...(typeof input.worktreePath === "string"
      ? { worktreePath: input.worktreePath }
      : {}),
    ...(input.cwdFromShell === true ? { cwdFromShell: true } : {}),
    title: string(input.title, "terminal.title"),
    ...(input.cli === undefined
      ? {}
      : { cli: readable(parseCliSummary, input.cli) }),
    ...(cliStatus ? { cliStatus } : {}),
    ...(input.setup === undefined
      ? {}
      : { setup: parseSetupState(input.setup) }),
    state: terminalState(input.state),
    ...(input.exitCode === null ||
    (typeof input.exitCode === "number" && Number.isSafeInteger(input.exitCode))
      ? { exitCode: input.exitCode }
      : {}),
    cols: terminalDimension(input.cols, "terminal.cols"),
    rows: terminalDimension(input.rows, "terminal.rows"),
    lastDesktopSize: parseTerminalSize(
      input.lastDesktopSize,
      "terminal.lastDesktopSize",
    ),
    ...(typeof input.teamConversation === "string"
      ? { teamConversation: input.teamConversation }
      : {}),
    ...(typeof input.teamName === "string" && input.teamName
      ? { teamName: input.teamName }
      : {}),
    ...(typeof input.teamChild === "string" && input.teamChild
      ? { teamChild: input.teamChild }
      : {}),
    ...(input.cliResumeReason === "exit"
      ? { cliResumeReason: "exit" as const }
      : {}),
    ...(input.cliResumePending === true ? { cliResumePending: true } : {}),
    ...(input.restartPending === true ? { restartPending: true } : {}),
  };
}

function parseTerminalShell(value: unknown): TerminalShell {
  const input = record(value);
  return {
    id: nonEmptyString(input.id, "shell.id"),
    label: nonEmptyString(input.label, "shell.label"),
  };
}

function parseTerminalWindowsPty(value: unknown): TerminalWindowsPty {
  const input = record(value);
  if (input.backend !== "conpty" && input.backend !== "winpty") {
    return fail("windowsPty.backend is unsupported");
  }
  return {
    backend: input.backend,
    ...(typeof input.buildNumber === "number" &&
    Number.isSafeInteger(input.buildNumber) &&
    input.buildNumber > 0
      ? { buildNumber: input.buildNumber }
      : {}),
  };
}

export function parseTerminalListResult(value: unknown): TerminalListResult {
  const input = record(value);
  if (!Array.isArray(input.terminals))
    return fail("terminals must be an array");
  if (!Array.isArray(input.shells)) return fail("shells must be an array");
  return {
    terminals: readableItems(parseTerminalSummary, input.terminals),
    shells: readableItems(parseTerminalShell, input.shells),
    defaultShell: nonEmptyString(input.defaultShell, "defaultShell"),
    homeDirectory: nonEmptyString(input.homeDirectory, "homeDirectory"),
    ...(input.windowsPty === undefined
      ? {}
      : { windowsPty: readable(parseTerminalWindowsPty, input.windowsPty) }),
  };
}

export function parseTerminalCreatedResult(
  value: unknown,
): TerminalCreatedResult {
  const input = record(value);
  return { terminal: parseTerminalSummary(input.terminal) };
}

export function parseTerminalClosedResult(
  value: unknown,
): TerminalClosedResult {
  const input = record(value);
  return {
    terminalId: nonEmptyString(input.terminalId, "terminalId"),
    ...(input.command === undefined
      ? {}
      : { command: nonEmptyString(input.command, "command") }),
    ...(input.confirmationRequired === true
      ? { confirmationRequired: true }
      : {}),
  };
}

export function parseTerminalDefaultShellResult(
  value: unknown,
): TerminalDefaultShellResult {
  const input = record(value);
  return { shell: nonEmptyString(input.shell, "shell") };
}

function parseTerminalModes(value: unknown): TerminalModes {
  const input = record(value);
  const trackingMode = input.mouseTrackingMode;
  return {
    bracketedPaste: input.bracketedPaste === true,
    mouseTracking: input.mouseTracking === true,
    ...(["none", "x10", "vt200", "drag", "any"].includes(String(trackingMode))
      ? { mouseTrackingMode: trackingMode as TerminalMouseTrackingMode }
      : {}),
    sgrMouseMode: input.sgrMouseMode === true,
    sgrMousePixelsMode: input.sgrMousePixelsMode === true,
    applicationCursor: input.applicationCursor === true,
    alternateScreen: input.alternateScreen === true,
    kittyKeyboardFlags:
      typeof input.kittyKeyboardFlags === "number" &&
      Number.isSafeInteger(input.kittyKeyboardFlags)
        ? input.kittyKeyboardFlags
        : 0,
  };
}

function parseTerminalOscLinkRange(value: unknown): TerminalOscLinkRange {
  const input = record(value);
  return {
    row: nonNegativeInteger(input.row, "oscLink.row"),
    startCol: nonNegativeInteger(input.startCol, "oscLink.startCol"),
    endCol: nonNegativeInteger(input.endCol, "oscLink.endCol"),
    uri: nonEmptyString(input.uri, "oscLink.uri"),
  };
}

export function parseTerminalSnapshot(value: unknown): TerminalSnapshot {
  const input = record(value);
  const snapshot: TerminalSnapshot = {
    snapshotAnsi: string(input.snapshotAnsi, "snapshotAnsi"),
    scrollbackAnsi: string(input.scrollbackAnsi, "scrollbackAnsi"),
    rehydrateSequences: string(input.rehydrateSequences, "rehydrateSequences"),
    modes: parseTerminalModes(input.modes),
    cols: terminalDimension(input.cols, "snapshot.cols"),
    rows: terminalDimension(input.rows, "snapshot.rows"),
    ...(typeof input.frameRestoreAnsi === "string"
      ? { frameRestoreAnsi: input.frameRestoreAnsi }
      : {}),
    ...(typeof input.pendingEscapeTailAnsi === "string"
      ? { pendingEscapeTailAnsi: input.pendingEscapeTailAnsi }
      : {}),
  };
  if (Array.isArray(input.oscLinks)) {
    snapshot.oscLinks = readableItems(
      parseTerminalOscLinkRange,
      input.oscLinks,
    );
  }
  if (input.scrollbackTruncated === true) snapshot.scrollbackTruncated = true;
  return snapshot;
}

function parseTerminalServerMessage(
  value: unknown,
): TerminalServerMessage | undefined {
  const input = record(value);
  switch (input.kind) {
    case "terminal.snapshot":
      return {
        kind: "terminal.snapshot",
        terminal: parseTerminalSummary(input.terminal),
        snapshot: parseTerminalSnapshot(input.snapshot),
        sequence: typeof input.sequence === "number" ? input.sequence : 0,
        // No view has claimed a restarted PTY yet; Host represents that as "".
        sizeOwnerViewId: string(input.sizeOwnerViewId, "sizeOwnerViewId"),
        ...(input.submitResult === true ? { submitResult: true } : {}),
      };
    case "terminal.submitted":
      return {
        kind: "terminal.submitted",
        id: nonEmptyString(input.id, "id"),
        success: boolean(input.success, "success"),
      };
    case "terminal.output":
      return {
        kind: "terminal.output",
        data: string(input.data, "data"),
        sequence: typeof input.sequence === "number" ? input.sequence : 0,
      };
    case "terminal.size":
      return {
        kind: "terminal.size",
        cols: terminalDimension(input.cols, "cols"),
        rows: terminalDimension(input.rows, "rows"),
        lastDesktopSize: parseTerminalSize(
          input.lastDesktopSize,
          "lastDesktopSize",
        ),
        sizeOwnerViewId: string(input.sizeOwnerViewId, "sizeOwnerViewId"),
      };
    case "terminal.exit":
      return {
        kind: "terminal.exit",
        code: typeof input.code === "number" ? input.code : null,
        signal: typeof input.signal === "number" ? input.signal : null,
      };
    case "terminal.error":
      return {
        kind: "terminal.error",
        message: nonEmptyString(input.message, "message"),
      };
    default:
      return undefined;
  }
}

export const terminalServerMessageSchema: ValueSchema<
  TerminalServerMessage | undefined
> = {
  parse: parseTerminalServerMessage,
};
