import {
  TerminalSession,
  type TeamTerminalOptions,
  type TeamChildIdentity,
} from "./terminal-session.ts";
export type { TeamTerminalOptions } from "./terminal-session.ts";
import {
  queueFrame,
  queueOutput,
  allBehind,
  resumeIfCaughtUp,
  detachSubscriber,
  abortStream,
  sendTerminalError,
  OUTPUT_HIGH_WATERMARK,
  OVERFLOW_RESET_CODE,
  type TerminalSubscriber,
  type NativeBiStream,
  type NativeConnection,
} from "./output-pump.ts";
import { ApprovalBroker } from "../cli/approval-broker.ts";
import { CliInput, initialPromptReadyWhen } from "./cli-input.ts";
import { commitAtomicFile } from "../fs/atomic-write.ts";
import { copyDeliveryFile } from "../fs/delivery-file.ts";
import { filterKittyKeyReleases } from "./kitty-key-release.ts";
import { isNonKeyTerminalInput } from "./non-key-input.ts";
import { CliStallMonitor } from "./cli-stall-monitor.ts";
import type { TeamInputKey } from "../teams/commands.ts";
import { trustTeamWorkspace } from "../teams/workspace-trust.ts";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { realpath, stat, mkdir, open, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { RemotePtys } from "./remote-pty.ts";
import type { PtyScreen } from "./daemon/protocol.ts";
import type { CliCaller } from "../teams/local-command.ts";
import {
  encodeFrame,
  notificationText,
  MAX_TERMINAL_SNAPSHOT_LINES,
  terminalClientMessageSchema,
  type Event,
  type CliStatus,
  type Response,
  type TeamStallReason,
  type TerminalImageExtension,
  type TerminalClientMessage,
  type TerminalClosedResult,
  type TerminalCreatedResult,
  type TerminalDefaultShellResult,
  type TerminalListResult,
  type TerminalOpenStream,
  type TerminalServerMessage,
  type TerminalSnapshot as WireSnapshot,
  type TerminalSummary,
  type TerminalViewAttributes,
  type TerminalWindowsPty,
} from "@iori/protocol";
/** Shell argv for a managed CLI or worktree setup command. Shared with native
 * verification so the shell-to-CLI boundary uses the product's launch shape. */
export function managedCommandArguments(
  command: string,
  shell: ShellDefinition,
): string[] | string {
  const dialect = shellDialect(shell);
  return dialect === "powershell"
    ? ["-NoLogo", "-Command", command]
    : dialect === "cmd"
      ? `/s /c "${command}"`
      : ["-l", "-i", "-c", command];
}

import type {
  HostStore,
  StoredTerminal,
  StoreContext,
  WorktreeSetup,
} from "../store.ts";

import type { TerminalSnapshot } from "./daemon/types.ts";
import type {
  ParserEvent,
  ParserSubscriptions,
} from "./daemon/parser-events.ts";
import { applyTerminalMetadata } from "./terminal-metadata.ts";

export const TERMINAL_PARSER_SUBSCRIPTIONS: ParserSubscriptions = {
  osc: [0, 2, 7, 133, 7501],
  csi: [{ prefix: "?", final: "h" }],
};
import {
  buildProcessBoundaryGround,
  ABORT_TRUNCATED_CONTROL_STRING,
} from "./shared/terminal-mode-reset-profiles.ts";
import {
  buildFreshShellViewportBlankingSequence,
  buildTerminalRestartRecoverySequence,
} from "./restart-sequence.ts";
import {
  getHomeDirectory,
  getWindowsPtyCompatibility,
  getWindowsPtySpawnOptions,
  isWindowsHost,
  ptyEnvironment,
  type ShellDefinition,
} from "./platform.ts";
import { discoverShells, resolveShell } from "./shells.ts";

import { shellActivity, type ShellActivity } from "./shell-activity.ts";

import { ToolActivity, type HookState } from "../cli/hooks.ts";
import { cliDefinitions, withCurrentCliIcon } from "../cli/definitions.ts";
import { osc7501Fields } from "../cli/osc7501.ts";
import type { CliRegistry } from "../cli/registry.ts";
import { readCommonHook } from "../cli/common-hook.ts";
export type RuntimeCli = Pick<
  CliRegistry,
  "launch" | "refreshUsage" | "resumeWithTeamPrompt"
>;
import {
  withCommandPath,
  cliStartup,
  cliResumeCommand,
  shellCommand,
  shellDialect,
} from "../cli/shell-command.ts";
import { LineEditorReady } from "./line-editor-ready.ts";
import { shellOwnsForeground } from "./linux-foreground.ts";
import { ShellIntegration } from "./shell-integration.ts";

const SCROLLBACK_LINES = MAX_TERMINAL_SNAPSHOT_LINES;

const CHECKPOINT_INTERVAL_MS = 5_000;
// Automatic permission replies were observed at ~100ms. Only presentation waits;
// input delivery and submission must see the waiting state immediately.
const CLI_WAIT_PRESENTATION_MS = 1_000;
// Pi enabled paste in its first output (184–249ms after spawn); a plain-input
// CLI drew its screen in one chunk (23–25ms). No startup output gaps preceded
// readiness in those samples. Allow 300ms of quiet for CLIs without a signal.
const INITIAL_INPUT_QUIET_MS = 300;
const RESTART_SEPARATOR_TEXT = "Host の再起動で前の shell は終了しました";

type FrameReader = () => Promise<unknown | undefined>;
type Publish = (event: Event) => void;

function success<T>(result: T): Response<T> {
  return { ok: true, result };
}

function failed(code: "invalid_request" | "internal_error"): Response<never> {
  return { ok: false, error: { code } };
}

function toSummary(
  record: StoredTerminal,
  cwdFromShell = false,
): TerminalSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    shell: record.shell,
    cwd: record.cwd,
    ...(cwdFromShell ? { cwdFromShell } : {}),
    title: record.title,
    state: record.state,
    exitCode: record.exitCode ?? null,
    cols: record.cols,
    rows: record.rows,
    lastDesktopSize: record.lastDesktopSize,
    restartPending: record.restartPending,
  };
}

function sameViewAttributes(
  left: TerminalViewAttributes | null,
  right: TerminalViewAttributes,
): boolean {
  if (
    !left ||
    left.colorSchemeMode !== right.colorSchemeMode ||
    left.cursorStyle !== right.cursorStyle ||
    left.cursorBlink !== right.cursorBlink ||
    left.ansi.length !== right.ansi.length
  ) {
    return false;
  }
  const sameRgb = (
    a: TerminalViewAttributes["foreground"],
    b: TerminalViewAttributes["foreground"],
  ) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  if (
    !sameRgb(left.foreground, right.foreground) ||
    !sameRgb(left.background, right.background) ||
    !sameRgb(left.cursor, right.cursor)
  ) {
    return false;
  }
  return left.ansi.every((color, index) => sameRgb(color, right.ansi[index]!));
}

function toWireSnapshot(snapshot: TerminalSnapshot): WireSnapshot {
  return {
    snapshotAnsi: snapshot.snapshotAnsi,
    scrollbackAnsi: snapshot.scrollbackAnsi,
    ...(snapshot.oscLinks === undefined ? {} : { oscLinks: snapshot.oscLinks }),
    ...(snapshot.frameRestoreAnsi === undefined
      ? {}
      : { frameRestoreAnsi: snapshot.frameRestoreAnsi }),
    rehydrateSequences: snapshot.rehydrateSequences,
    modes: snapshot.modes,
    cols: snapshot.cols,
    rows: snapshot.rows,
    ...(snapshot.pendingEscapeTailAnsi === undefined
      ? {}
      : { pendingEscapeTailAnsi: snapshot.pendingEscapeTailAnsi }),
  };
}

export class TerminalRuntime {
  readonly #store: HostStore;
  readonly #imagesRoot: string;
  readonly #shellIntegration: ShellIntegration;
  readonly #clis: RuntimeCli;
  readonly #publish: Publish;
  readonly #shells: ShellDefinition[];
  #defaultShell: string;
  readonly #windowsPty: TerminalWindowsPty | undefined;
  readonly #runtimes = new Map<string, TerminalSession>();
  readonly #operationChains = new Map<string, Promise<void>>();
  #stopping = false;
  readonly #remote: RemotePtys;
  readonly #approvals: ApprovalBroker;
  onDelivered?: (id: string) => void;
  onRestoreTeamTerminal?: (id: string) => Promise<void>;
  onCliExit?: (
    terminalId: string,
    reason: "exit" | "user",
  ) => void | Promise<void>;
  onCliNotification?: (terminal: TerminalSummary) => void;
  onCliState?: (terminalId: string, state: HookState) => void | Promise<void>;
  onSetupFailed?: (
    terminalId: string,
    exitCode: number,
  ) => void | Promise<void>;
  onCliInput?: (terminalId: string) => void;
  onCliStalled?: (
    stalled: { id: string; since: number; reason: TeamStallReason }[],
  ) => void | Promise<void>;
  onCliStallCleared?: (terminalId: string) => void;
  onCliProcessesChanged?: () => void;
  readonly #stall = new CliStallMonitor(
    this.#runtimes,
    (session) => {
      this.#saveCli(session);
      this.#publish({
        type: "terminal.updated",
        terminal: this.#summary(session.record),
      });
    },
    (items) => this.onCliStalled?.(items),
  );
  readonly #input = new CliInput({
    stopping: () => this.#stopping,
    noteCliInput: (session, preserve) => this.#noteCliInput(session, preserve),
    updateCliState: (session, state) => this.#updateCliState(session, state),
    saveCli: (session) => this.#saveCli(session),
    reportRuntimeError: (session) => this.#reportRuntimeError(session),
    delivered: (id) => this.onDelivered?.(id),
  });
  isCliRunning(id: string): boolean {
    const runtime = this.#runtimes.get(id);
    return Boolean(runtime?.pty && runtime.cli && !runtime.stopped);
  }

  async visibleScreenLines(id: string): Promise<string[] | undefined> {
    const runtime = this.#runtimes.get(id);
    if (runtime?.pty && !runtime.stopped && !this.#stopping) {
      const lines = await this.#remote.channel
        .call("visibleLines", id)
        .catch(() => undefined);
      if (lines) return lines;
    }
    const snapshot = this.#store.terminal(id)?.snapshot;
    if (snapshot)
      return this.#remote.channel.call("visibleLinesFromSnapshot", snapshot);
  }

  runningClis(): import("../teams/assignment.ts").RunningCli[] {
    return [...this.#runtimes.values()]
      .filter((r) => r.pty && r.cli && !r.stopped)
      .map((r) => ({
        cli: r.cli!.id,
        ...(r.observedModel ? { model: r.observedModel } : {}),
        ...(r.teamOptions
          ? {
              model: r.observedModel ?? r.teamOptions.team.candidate.model,
              conversation: r.teamOptions.conversation,
              role: r.teamOptions.role,
            }
          : {}),
      }));
  }
  markTeamTerminalUnrestored(id: string): void {
    const runtime = this.#storedSession(id);
    if (runtime) runtime.teamUnrestored = true;
  }
  configureTeamTerminal(id: string, options: TeamTerminalOptions): void {
    const runtime = this.#storedSession(id);
    if (runtime) {
      runtime.configureTeam(options);
      if (options.role && !runtime.teamChild) {
        runtime.teamChild = this.#savedChildIdentities().get(id);
      }
    }
  }
  #storedSession(id: string) {
    const existing = this.#runtimes.get(id);
    if (existing) return existing;
    const record = this.#store.terminal(id);
    return record && this.#runtimeForStored(record);
  }
  /** Only queued messages can survive a reconnection to the same daemon. */
  *pendingDeliveries() {
    for (const runtime of this.#runtimes.values()) {
      for (const { deliveryId, delivered } of runtime.pendingLines) {
        if (deliveryId && delivered)
          yield { terminalId: runtime.record.id, id: deliveryId, delivered };
      }
      for (const id of runtime.initialDeliveryIds ?? []) {
        const delivered =
          runtime.initialArgumentDelivered ?? runtime.initialReceipts?.get(id);
        if (delivered) yield { terminalId: runtime.record.id, id, delivered };
      }
    }
  }
  bindDelivery(id: string, delivered: () => void, terminalId?: string) {
    const sessions = terminalId
      ? [this.#runtimes.get(terminalId)]
      : this.#runtimes.values();
    for (const session of sessions) {
      if (!session) continue;
      const line = session.pendingLines.find(
        (message) => message.deliveryId === id,
      );
      if (line) line.delivered = delivered;
      else if (session.initialDeliveryIds?.includes(id))
        (session.initialReceipts ??= new Map()).set(id, delivered);
    }
  }
  async sendCliInput(
    id: string,
    input:
      | { text: string; enter?: boolean }
      | { key: TeamInputKey }
      | { sequence: string },
  ): Promise<boolean> {
    return this.#input.sendCliInput(this.#runtimes.get(id), input);
  }
  async sendLine(
    id: string,
    line: string,
    delivered?: () => void,
    deliveryId?: string,
  ): Promise<"queued" | "delivered"> {
    return this.#input.sendLine(
      this.#runtimes.get(id),
      line,
      delivered,
      deliveryId,
    );
  }
  async stopTeamTerminal(id: string): Promise<void> {
    const runtime = this.#runtimes.get(id);
    if (!runtime) return;
    await runtime.runSerial(async () => {
      await this.#persist(runtime);
      await this.#killAndWait(runtime);
      this.#clearCli(runtime, false);
      runtime.record.state = "error";
      runtime.record.restartPending = false;
      runtime.record.exitCode = null;
      this.#store.putTerminal(runtime.record);
      this.#publish({
        type: "terminal.updated",
        terminal: this.#summary(runtime.record),
      });
      this.onCliProcessesChanged?.();
    });
  }
  /** The tokens that a CLI's plugin last sent for this conversation. */
  commonTokens(
    id: string,
    sessionId: string,
  ): import("@iori/protocol").TokenUsage | undefined {
    const tokens = this.#runtimes.get(id)?.hookTokens;
    return tokens && tokens.sessionId === sessionId ? tokens.usage : undefined;
  }
  async canResumeWithInput(id: string): Promise<boolean> {
    const saved = this.#store.terminalCli(id);
    if (!saved?.session) return false;
    const definition = cliDefinitions.find((d) => d.id === saved.cli.id);
    if (definition?.resumeWithInputArguments) return true;
    const record = this.#store.terminal(id);
    const shell = record && resolveShell(this.#shells, record.shell);
    return !!shell && this.#clis.resumeWithTeamPrompt(saved.cli.id, shell);
  }
  async restartTeamTerminal(
    id: string,
    options: TeamTerminalOptions,
  ): Promise<boolean> {
    const saved = this.#store.terminalCli(id);
    const record = this.#store.terminal(id);
    const definition = cliDefinitions.find((d) => d.id === saved?.cli.id);
    const initialArgs =
      saved?.session && options.team.initial
        ? definition?.resumeWithInputArguments?.(
            saved.session,
            options.team.initial,
          )
        : undefined;
    const args =
      initialArgs ??
      (saved?.session
        ? definition?.resumeArguments?.(saved.session)
        : undefined);
    if (!saved || !record || !args?.length) return false;
    options.team.trustWorkspace = await trustTeamWorkspace(
      record.cwd,
      this.#store.sidebarOrder(),
    );
    const runtime = this.#runtimeForStored(record);
    if (!runtime) return false;
    const shell = resolveShell(this.#shells, record.shell)!;
    const teamPrompt =
      !!options.team.initial &&
      (await this.#clis.resumeWithTeamPrompt(saved.cli.id, shell));
    const launch = await this.#clis.launch(
      saved.cli.id,
      shell,
      {
        ...options.team,
        resume: true,
        initial: teamPrompt
          ? // One line: cmd /c stops reading its command at a line break.
            `Read ${options.team.instructionFile} and follow its instructions. ${options.team.initial}`
          : undefined,
      },
      { cwd: record.cwd, waitForVersion: true, arguments: args },
    );
    await runtime.runSerial(async () => {
      // A surviving shell can still carry an earlier command route. Pass the
      // current parent environment only through a newly spawned PTY.
      if (!options.role) {
        await this.#killAndWait(runtime);
      }
      runtime.configureTeam(options);
      runtime.cliExitNotified = false;
      runtime.cli = saved.cli;
      runtime.initialArgumentDelivered = initialArgs
        ? options.initialDelivered
        : undefined;
      runtime.initialDeliveryIds =
        initialArgs || teamPrompt ? options.initialDeliveryIds : undefined;
      runtime.hooks = saved.observed ? definition?.hooks : undefined;
      this.#store.setTerminalCli(id, {
        ...saved,
        ...(launch ? { command: launch.storedCommand ?? launch.command } : {}),
        resumePending: false,
      });
      try {
        await this.#spawn(
          runtime,
          shell,
          launch?.command ??
            (await shellCommand(saved.command, args, shell, {
              commandLine: true,
            })),
          launch?.env,
        );
      } catch (error) {
        try {
          await this.#killAndWait(runtime);
        } finally {
          this.#clearCli(runtime, false);
          this.#store.setTerminalCli(id, saved);
        }
        throw error;
      }
      if (teamPrompt && launch) {
        options.initialDelivered?.();
        runtime.initialDeliveryIds = undefined;
        this.#saveCli(runtime);
      }
      this.#publish({
        type: "terminal.updated",
        terminal: this.#summary(record),
      });
    });
    return true;
  }

  private constructor(
    store: HostStore,
    publish: Publish,
    shells: ShellDefinition[],
    defaultShell: string,
    windowsPty: TerminalWindowsPty | undefined,
    imagesRoot: string,
    shellIntegration: ShellIntegration,
    clis: RuntimeCli,
    remote: RemotePtys,
    approvals: ApprovalBroker,
  ) {
    this.#approvals = approvals;
    this.#remote = remote;
    this.#imagesRoot = imagesRoot;
    this.#shellIntegration = shellIntegration;
    this.#store = store;
    this.#clis = clis;
    this.#publish = publish;
    this.#shells = shells;
    this.#defaultShell = defaultShell;
    this.#windowsPty = windowsPty;
  }

  static async create(
    store: HostStore,
    publish: Publish,
    storageRoot: string,
    clis: RuntimeCli,
    remote: RemotePtys,
    preserveImages = false,
  ): Promise<TerminalRuntime> {
    const discovered = await discoverShells();
    const stored = store.defaultTerminalShell();
    const defaultShell =
      resolveShell(discovered.shells, stored)?.id ?? discovered.preferred;
    if (defaultShell) store.setDefaultTerminalShell(defaultShell);
    const approvals = new ApprovalBroker(join(storageRoot, "cli-approvals"));
    await approvals.start();
    const manager = new TerminalRuntime(
      store,
      publish,
      discovered.shells,
      defaultShell,
      getWindowsPtyCompatibility(),
      join(storageRoot, "terminal-images"),
      new ShellIntegration(storageRoot),
      clis,
      remote,
      approvals,
    );
    if (!preserveImages) {
      await manager.#removeImages(manager.#imagesRoot);
      for (const terminal of store.listTerminals()) {
        const setup = store.terminalSetup(terminal.id);
        if (setup?.state !== "running") continue;
        store.saveTerminalSetup(terminal.id, {
          ...setup,
          state: "failed",
          exitCode: undefined,
        });
        terminal.state = "error";
        terminal.exitCode = null;
        terminal.restartPending = false;
        store.putTerminalSummary(terminal);
      }
    }
    return manager;
  }

  #saveCli(runtime: TerminalSession, managed?: boolean) {
    const saved = this.#store.terminalCli(runtime.record.id);
    if (!saved) return;
    const next = {
      ...saved,
      runtime: {
        marker: runtime.cliMarker,
        observedModel: runtime.observedModel,
        userInputSinceActivity: runtime.userInputSinceActivity,
        ready: runtime.cliReady,
        shellReady: runtime.shellReady,
        status: runtime.cliStatus,
        managed:
          managed ?? saved.runtime?.managed ?? Boolean(runtime.teamOptions),
        commandPath: runtime.commandPath,
        commandSession: runtime.commandSession,
        pendingCommand: runtime.pendingCliCommand,
        initialInput: runtime.initialInput,
        initialDeliveryIds: runtime.initialDeliveryIds,
        pendingLines: runtime.pendingLines.map(({ line, deliveryId }) => ({
          line,
          deliveryId,
        })),
      },
    };
    if (JSON.stringify(saved.runtime) !== JSON.stringify(next.runtime))
      this.#store.setTerminalCli(runtime.record.id, next);
  }
  async restore(screens: PtyScreen[]) {
    for (const screen of screens) {
      const record = this.#store.terminal(screen.id);
      if (!record) continue;
      record.snapshot = toWireSnapshot(screen.snapshot);
      record.cols = screen.snapshot.cols;
      record.rows = screen.snapshot.rows;
      if (screen.live || screen.exit) record.restartPending = false;
      const runtime = this.#runtimeForStored(record)!;
      await runtime.ready;
      runtime.applyDaemonState(screen.state);
      if (record.state !== "running" || (!screen.live && !screen.exit))
        continue;
      const saved = this.#store.terminalCli(record.id),
        state = saved?.runtime;
      const shell = resolveShell(this.#shells, record.shell);
      if (!shell) {
        record.restartPending = true;
        this.#store.putTerminal(record);
        if (saved)
          this.#store.setTerminalCli(record.id, {
            ...saved,
            resumePending: true,
          });
        continue;
      }
      runtime.pty = this.#remote.attach(screen);
      runtime.cliMarker = state?.marker;
      runtime.observedModel = state?.observedModel;
      runtime.userInputSinceActivity = state?.userInputSinceActivity;
      runtime.cli = saved && !saved.resumePending ? saved.cli : undefined;
      runtime.hooks = saved?.observed
        ? cliDefinitions.find((d) => d.id === saved.cli.id)?.hooks
        : undefined;
      runtime.cliReady = state?.ready ?? false;
      runtime.initialPromptSignaled = state?.ready ?? false;
      runtime.inputModeReady =
        screen.snapshot.modes.bracketedPaste &&
        (!cliDefinitions.find((d) => d.id === runtime.cli?.id)
          ?.waitForInputCursor ||
          runtime.showCursor);
      runtime.cliStatus = state?.status;
      if (runtime.cliStatus?.attention?.approval)
        delete runtime.cliStatus.attention.approval;
      if (
        runtime.cliStatus?.state === "active" &&
        runtime.cliStatus.stalledSince === undefined
      )
        runtime.stallResetAt = Date.now();
      if (runtime.cliStatus?.state === "waiting")
        this.#deferWaitingPresentation(runtime);
      runtime.pendingCliCommand = state?.pendingCommand;
      this.#applyParserEvents(runtime, shell, screen.state.osc, true);
      runtime.commandPath = state?.commandPath;
      runtime.commandSession = state?.commandSession;
      runtime.initialInput = state?.initialInput;
      runtime.pendingLines = state?.pendingLines ?? [];
      runtime.initialDeliveryIds = state?.initialDeliveryIds;
      runtime.shellReady = state?.shellReady || runtime.modes.bracketedPaste;
      if (shellDialect(shell) === "posix") {
        runtime.lineEditorReady = new LineEditorReady();
        runtime.lineEditorReady.scan(
          screen.snapshot.pendingEscapeTailAnsi ?? "",
        );
      }
      this.#observe(runtime, shell, state?.managed ?? false);
      await this.#registerCliHooks(runtime);
      // Re-observe the actual foreground process after a gap in raw output.
      if (
        screen.live &&
        runtime.cli &&
        !runtime.setup &&
        !state?.managed &&
        !runtime.pendingCliCommand
      ) {
        const atShell = isWindowsHost()
          ? !(await shellActivity(screen.pid, { name: false })).busy
          : await shellOwnsForeground(screen.pid);
        if (atShell === true) this.#clearCli(runtime);
      }
      if (runtime.pendingCliCommand && runtime.shellReady) {
        await runtime.pty.write(runtime.pendingCliCommand + "\r");
        runtime.pendingCliCommand = undefined;
      }
      this.#store.putTerminal(record);
    }
    this.#stall.schedule();
  }

  flushPending() {
    for (const runtime of this.#runtimes.values()) {
      this.#input.sendInitialInput(runtime);
      this.#input.sendPendingLines(runtime);
    }
  }

  identifyTeamChild(
    terminalId: string,
    child: string,
    conversation: string,
  ): void {
    const runtime = this.#runtimes.get(terminalId);
    if (runtime?.pty) runtime.teamChild = { child, conversation };
  }

  summary(id: string): TerminalSummary | undefined {
    const record = this.#store.terminalSummary(id);
    return record ? this.#summary(record) : undefined;
  }

  workGeneration(id: string): string | undefined {
    const runtime = this.#runtimes.get(id);
    if (!runtime) return undefined;
    return (runtime.cliWorkGeneration ??= randomUUID());
  }

  #savedChildIdentities() {
    const children = new Map<string, TeamChildIdentity>();
    for (const child of this.#store.teamChildren()) {
      if (child.terminalId)
        children.set(child.terminalId, {
          child: child.id,
          conversation: child.conversation,
        });
    }
    return children;
  }
  list(): Response<TerminalListResult> {
    const children = this.#savedChildIdentities();
    return success({
      terminals: this.#store
        .listTerminals()
        .map((record) => this.#summary(record, children)),
      shells: this.#shells.map(({ id, label }) => ({ id, label })),
      defaultShell: this.#defaultShell,
      homeDirectory: getHomeDirectory(),
      ...(this.#windowsPty ? { windowsPty: this.#windowsPty } : {}),
    });
  }

  async createTerminal(
    context: StoreContext,
    cwd: string,
    shellId?: string,
    cliId?: string,
    teamOptions?: TeamTerminalOptions,
    setup?: WorktreeSetup,
    execution?: {
      candidate: import("@iori/protocol").Candidate;
      instructionFile: string;
    },
  ): Promise<Response<TerminalCreatedResult>> {
    return this.#withOperation(context, async () => {
      const previous =
        this.#store.terminalOperationResult<TerminalCreatedResult>(context);
      if (previous) return success(previous);
      const shell = resolveShell(this.#shells, shellId ?? this.#defaultShell);
      if (!shell) return failed("invalid_request");
      let directory: string;
      try {
        directory = await realpath(cwd);
        if (!(await stat(directory)).isDirectory())
          return failed("invalid_request");
      } catch {
        return failed("invalid_request");
      }
      const runningSizes = [...this.#runtimes.values()]
        .filter(
          (runtime) => runtime.pty && !runtime.ptyExited && !runtime.stopped,
        )
        .map((runtime) => runtime.record.lastDesktopSize);
      const sizes = runningSizes.length
        ? runningSizes
        : this.#store
            .listTerminals()
            .map((terminal) => terminal.lastDesktopSize);
      const initialSize = sizes.reduce(
        (widest, size) => (size.cols > widest.cols ? size : widest),
        sizes[0] ?? { cols: 80, rows: 24 },
      );
      const record: StoredTerminal = {
        id: randomUUID(),
        shell: shell.id,
        cwd: directory,
        worktreePath: directory,
        title: shell.label,
        state: "running",
        exitCode: null,
        cols: initialSize.cols,
        rows: initialSize.rows,
        lastDesktopSize: { ...initialSize },
        restartPending: false,
        imageSequence: 0,
        snapshot: null,
        createdAt: Date.now(),
      };
      try {
        let initial: string | undefined;
        let teamFilesDirectory: string | undefined;
        let commandDirectory: string | undefined;
        if (cliId && !teamOptions) {
          // Every CLI gets the team's session directory lifecycle; its route
          // reads the Forge, and only a team's routes use the team commands.
          const route = await this.#commandRoute(record.id, cliId);
          commandDirectory = route.IORI_COMMAND_DIRECTORY;
          if (execution) {
            teamFilesDirectory = route.IORI_TEAM_FILES_DIRECTORY!;
            const instruction = await copyDeliveryFile(
              execution.instructionFile,
              teamFilesDirectory,
            );
            initial = `Read ${instruction} and follow its instructions.`;
          }
        }
        if (teamOptions)
          teamOptions.team.trustWorkspace = await trustTeamWorkspace(
            directory,
            this.#store.sidebarOrder(),
          );
        const launch = cliId
          ? await this.#clis.launch(cliId, shell, teamOptions?.team, {
              cwd: directory,
              execution: execution
                ? {
                    candidate: execution.candidate,
                    initial,
                    teamFilesDirectory,
                  }
                : undefined,
              commandDirectory,
            })
          : undefined;
        if (cliId && !launch) {
          await this.#remote.channel.call("retireRoute", record.id);
          return failed("invalid_request");
        }
        const runtime = new TerminalSession(
          record,
          this.#store.terminalSetup(record.id),
          this.#remote,
        );
        if (teamOptions) runtime.configureTeam(teamOptions);
        this.#runtimes.set(record.id, runtime);
        runtime.initialInput = launch?.initialInput;
        await runtime.ready;
        record.snapshot = toWireSnapshot(
          await this.#remote.snapshot(record.id, 0),
        );
        this.#store.putTerminal(record);
        if (launch) {
          this.#store.setTerminalCli(record.id, {
            cli: launch.cli,
            command: launch.storedCommand ?? launch.command,
            observed: Boolean(launch.hooks),
            ...(execution ? { candidate: execution.candidate } : {}),
          });
          runtime.cli = launch.cli;
          runtime.hooks = launch.hooks;
          runtime.record.title = launch.cli.name;
          try {
            this.#store.putTerminalSummary(runtime.record);
          } catch {
            this.#markDirty(runtime);
          }
          this.#store.setLastUsedCli(launch.cli.id);
        }
        if (setup) {
          runtime.setup = {
            ...setup,
            cliCommand: launch?.command,
            state: "running",
          };
          this.#store.saveTerminalSetup(record.id, runtime.setup);
        }
        // A view opened before the shell exists waits for it here, instead of
        // starting another shell that drops the pending CLI command.
        await runtime.runSerial(() =>
          this.#spawn(
            runtime,
            shell,
            setup?.command ?? launch?.command,
            launch?.env,
          ),
        );
        this.#publish({
          type: "terminal.created",
          terminal: this.#summary(record),
        });
      } catch {
        const session = this.#runtimes.get(record.id);
        if (session) {
          await this.#killAndWait(session).catch(() => {});
          this.#disposeTerminal(session);
        }
        this.#store.removeTerminal(record.id);
        await this.#remote.remove(record.id).catch(() => {});
        await this.#remote.channel
          .call("retireRoute", record.id)
          .catch(() => {});
        return failed("internal_error");
      }
      const result = { terminal: this.#summary(record) };
      this.#store.saveTerminalOperationResult(context, result);
      return success(result);
    });
  }

  async resolveSetup(
    context: StoreContext,
    id: string,
    action: "retry" | "skip",
  ): Promise<Response<TerminalCreatedResult>> {
    return this.#withOperation(context, async () => {
      const previous =
        this.#store.terminalOperationResult<TerminalCreatedResult>(context);
      if (previous) return success(previous);
      const record = this.#store.terminal(id);
      const runtime = record && this.#runtimeForStored(record);
      if (!runtime) return failed("invalid_request");
      return runtime.runSerial(async () => {
        const setup = runtime.setup;
        const shell = resolveShell(this.#shells, runtime.record.shell);
        if (!setup || setup.state !== "failed" || !shell)
          return failed("invalid_request");
        // The failed process is gone; the terminal screen and its subscribers remain.
        const command = action === "retry" ? setup.command : setup.cliCommand;
        runtime.setup =
          action === "retry"
            ? { ...setup, state: "running", exitCode: undefined }
            : undefined;
        const saved = this.#store.terminalCli(id);
        try {
          this.#store.saveTerminalSetup(id, runtime.setup);
          if (saved) {
            runtime.cliExitNotified = false;
            runtime.cli = saved.cli;
            runtime.initialInput ??= saved.runtime?.initialInput;
            runtime.pendingLines =
              saved.runtime?.pendingLines ?? runtime.pendingLines;
            runtime.hooks = saved.observed
              ? cliDefinitions.find((d) => d.id === saved.cli.id)?.hooks
              : undefined;
            this.#store.setTerminalCli(id, { ...saved, resumePending: false });
          }
          runtime.record.cwd =
            this.#store.terminalWorktree(id) ?? runtime.record.cwd;
          await this.#spawn(
            runtime,
            shell,
            command,
            action === "skip"
              ? await this.#launchEnvironment(runtime, shell)
              : undefined,
          );
        } catch {
          // A post-spawn write can fail after the daemon allocated the PTY.
          try {
            await this.#killAndWait(runtime);
          } finally {
            runtime.setup = setup;
            this.#store.saveTerminalSetup(id, setup);
            if (saved) this.#store.setTerminalCli(id, saved);
            runtime.record.state = "error";
            runtime.record.exitCode = setup.exitCode ?? null;
            this.#store.putTerminalSummary(runtime.record);
            this.#publish({
              type: "terminal.updated",
              terminal: this.#summary(runtime.record),
            });
          }
          return failed("internal_error");
        }
        this.#store.putTerminalSummary(runtime.record);
        const result = { terminal: this.#summary(runtime.record) };
        this.#store.saveTerminalOperationResult(context, result);
        this.#publish({ type: "terminal.updated", ...result });
        return success(result);
      });
    });
  }

  async setDefaultShell(
    context: StoreContext,
    shellId: string,
  ): Promise<Response<TerminalDefaultShellResult>> {
    return this.#withOperation(context, async () => {
      const previous =
        this.#store.terminalOperationResult<TerminalDefaultShellResult>(
          context,
        );
      if (previous) return success(previous);
      if (!this.#shells.some((shell) => shell.id === shellId)) {
        return failed("invalid_request");
      }
      this.#store.setDefaultTerminalShell(shellId);
      this.#defaultShell = shellId;
      const result = { shell: shellId };
      this.#store.saveTerminalOperationResult(context, result);
      return success(result);
    });
  }

  async #restoreParentOptions(runtime: TerminalSession) {
    if (
      !runtime.teamOptions &&
      this.#store
        .teamConversations()
        .some((c) => c.terminalId === runtime.record.id)
    ) {
      await this.onRestoreTeamTerminal?.(runtime.record.id);
      return Boolean(runtime.teamOptions) && !runtime.teamUnrestored;
    }
    return !runtime.teamUnrestored;
  }

  async resumeCli(
    context: StoreContext,
    terminalId: string,
  ): Promise<Response<TerminalCreatedResult>> {
    return this.#withOperation(context, async () => {
      const previous =
        this.#store.terminalOperationResult<TerminalCreatedResult>(context);
      if (previous) return success(previous);
      const runtime = this.#storedSession(terminalId);
      if (!runtime) return failed("invalid_request");
      const saved = this.#store.terminalCli(terminalId);
      if (!saved?.resumePending || !(await this.#restoreParentOptions(runtime)))
        return failed("invalid_request");
      if (
        runtime.teamOptions &&
        !runtime.teamOptions.role &&
        (!runtime.pty ||
          !runtime.commandSession ||
          runtime.commandSession !==
            runtime.teamOptions.env.IORI_COMMAND_SESSION)
      ) {
        try {
          if (
            !(await this.restartTeamTerminal(terminalId, runtime.teamOptions))
          )
            return failed("invalid_request");
        } finally {
          if (!runtime.pty) runtime.clearCli(true);
        }
        const result = { terminal: this.#summary(runtime.record) };
        this.#store.saveTerminalOperationResult(context, result);
        return success(result);
      }
      return runtime.runSerial(async () => {
        const saved = this.#store.terminalCli(terminalId);
        if (!saved?.resumePending || !runtime.pty)
          return failed("invalid_request");
        const shell = resolveShell(this.#shells, runtime.record.shell)!;
        const definition = cliDefinitions.find(
          (definition) => definition.id === saved.cli.id,
        );
        const args = saved.session
          ? definition?.resumeArguments?.(saved.session)
          : undefined;
        // A CLI whose definition is gone resumes with the saved command.
        if (runtime.teamOptions)
          runtime.teamOptions.team.trustWorkspace = await trustTeamWorkspace(
            runtime.record.cwd,
            this.#store.sidebarOrder(),
          );
        const launch = await this.#clis.launch(
          saved.cli.id,
          shell,
          runtime.teamOptions
            ? {
                ...runtime.teamOptions.team,
                initial: undefined,
                resume: true,
              }
            : undefined,
          {
            cwd: runtime.record.cwd,
            waitForVersion: true,
            arguments: args,
            ...(saved.candidate
              ? { execution: { candidate: saved.candidate } }
              : {}),
            ...(runtime.teamOptions
              ? {}
              : {
                  commandDirectory: (
                    await this.#commandRoute(terminalId, saved.cli.id)
                  ).IORI_COMMAND_DIRECTORY,
                }),
          },
        );
        const command =
          launch?.command ??
          (await shellCommand(saved.command, args ?? [], shell, {
            commandLine: true,
          }));
        runtime.cliExitNotified = false;
        runtime.cli = saved.cli;
        runtime.hooks = saved.observed ? definition?.hooks : undefined;
        runtime.inputModeReady = false;
        this.#store.setTerminalCli(terminalId, {
          ...saved,
          ...(launch
            ? { command: launch.storedCommand ?? launch.command }
            : {}),
          resumePending: false,
        });
        await this.#registerCliHooks(runtime);
        runtime.cliMarker = randomUUID();
        const input = cliResumeCommand(
          runtime.commandPath ? withCommandPath(command, shell) : command,
          shell,
          runtime.cliMarker,
        );
        if (runtime.lineEditorReady && !runtime.shellReady)
          runtime.pendingCliCommand = input;
        else await runtime.pty.write(input + "\r");
        const result = { terminal: this.#summary(runtime.record) };
        this.#store.saveTerminalOperationResult(context, result);
        this.#publish({ type: "terminal.updated", terminal: result.terminal });
        return success(result);
      });
    });
  }

  async #removeImages(path: string): Promise<void> {
    // A locked temporary image must not prevent starting or closing a Terminal.
    // A new daemon attempts to remove old images; Host reconnect keeps them.
    await rm(path, { recursive: true, force: true }).catch(() => {});
  }

  async writeImage(params: {
    terminalId: string;
    imageId: string;
    extension: TerminalImageExtension;
    data: string;
    first: boolean;
    last: boolean;
  }): Promise<Response<{ path: string }>> {
    const runtime = this.#runtimes.get(params.terminalId);
    if (!runtime) return failed("invalid_request");
    return runtime.runSerial(async () => {
      if (runtime.stopped || !runtime.pty) return failed("invalid_request");
      const directory = join(this.#imagesRoot, runtime.record.id);
      const partial = join(directory, `${params.imageId}.part`);
      const bytes = Buffer.from(params.data, "base64");
      try {
        if (params.first)
          await mkdir(directory, { recursive: true, mode: 0o700 });
        // Later chunks open an existing file, never recreate one after closing.
        const file = await open(
          partial,
          params.first ? "wx" : constants.O_WRONLY | constants.O_APPEND,
          0o600,
        );
        try {
          await file.writeFile(bytes);
        } finally {
          await file.close();
        }
        if (!params.last) return success({ path: "" });
        // Transfer IDs keep interleaved chunks separate. Allocate the short
        // visible name only on completion, inside this Terminal's serial queue.
        const imageSequence = runtime.imageSequence + 1;
        this.#store.setTerminalImageSequence(runtime.record.id, imageSequence);
        runtime.imageSequence = imageSequence;
        const path = join(directory, `${imageSequence}.${params.extension}`);
        await commitAtomicFile(partial, path);
        return success({ path });
      } catch {
        await rm(partial, { force: true }).catch(() => {});
        return failed("internal_error");
      }
    });
  }

  async shellActivity(terminalId: string): Promise<ShellActivity> {
    const runtime = this.#runtimes.get(terminalId);
    return runtime?.pty ? shellActivity(runtime.pty.pid) : { busy: false };
  }

  async #removeTerminal(id: string, processExited = false) {
    await this.#remote.remove(id);
    this.#remote.send("retireRoute", id);
    await this.#removeImages(join(this.#imagesRoot, id));
    this.#store.removeTerminal(id);
    this.#publish({
      type: "terminal.closed",
      terminalId: id,
      ...(processExited ? { processExited } : {}),
    });
  }

  async closeTerminal(
    context: StoreContext,
    terminalId: string,
    confirm: boolean,
  ): Promise<Response<TerminalClosedResult>> {
    return this.#withOperation(context, async () => {
      const previous =
        this.#store.terminalOperationResult<TerminalClosedResult>(context);
      if (previous) return success(previous);
      const record = this.#store.terminalSummary(terminalId);
      if (!record) {
        const result = { terminalId };
        this.#store.saveTerminalOperationResult(context, result);
        return success(result);
      }
      const runtime = this.#runtimes.get(terminalId);
      let confirmationRequired = false;
      let busyPid: number | undefined;
      if (runtime) {
        await runtime.runSerial(async () => {
          await runtime.ready;
          if (!this.#store.terminalSummary(terminalId)) return;
          if (!confirm && runtime.pty) {
            const activity = await shellActivity(runtime.pty.pid, {
              name: false,
            });
            if (activity.busy) {
              confirmationRequired = true;
              busyPid = runtime.pty.pid;
              return;
            }
          }
          await this.#killAndWait(runtime);
          this.#notifyCliExit(runtime, "user");
          this.#disposeTerminal(runtime);
          await this.#removeTerminal(terminalId);
        });
      } else if (this.#store.terminalSummary(terminalId)) {
        await this.#removeTerminal(terminalId);
      }
      if (confirmationRequired) {
        const command =
          busyPid === undefined
            ? undefined
            : (await shellActivity(busyPid)).command;
        return success({
          terminalId,
          confirmationRequired: true,
          ...(command ? { command } : {}),
        });
      }
      const result = { terminalId };
      this.#store.saveTerminalOperationResult(context, result);
      return success(result);
    });
  }

  detachConnection(connection: NativeConnection): void {
    for (const runtime of this.#runtimes.values()) {
      for (const subscriber of runtime.subscribers) {
        if (subscriber.connection === connection) {
          detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
        }
      }
    }
  }

  async openStream(
    connection: NativeConnection,
    stream: NativeBiStream,
    open: TerminalOpenStream,
    readFrame: FrameReader,
  ): Promise<void> {
    const stored = this.#store.terminal(open.terminalId);
    if (!stored) {
      await sendTerminalError(stream, "Terminal not found");
      return;
    }
    let runtime = this.#runtimes.get(open.terminalId);
    if (!runtime) runtime = this.#runtimeForStored(stored);
    if (!runtime) {
      await sendTerminalError(stream, "Terminal is unavailable");
      return;
    }

    let subscriber: TerminalSubscriber | undefined;
    let terminalClosed = false;
    try {
      await runtime.ready;
      await this.#remote.frozen(runtime.record.id, () =>
        runtime.runSerial(async () => {
          await runtime.ready;
          if (
            this.#stopping ||
            runtime.stopped ||
            this.#runtimes.get(open.terminalId) !== runtime ||
            !this.#store.terminalSummary(open.terminalId)
          ) {
            terminalClosed = true;
            return;
          }
          if (runtime.record.restartPending && !runtime.setup) {
            await this.#startAfterHostRestart(runtime, open.cols, open.rows);
          } else if (
            !runtime.setup &&
            runtime.record.state === "running" &&
            !runtime.pty
          ) {
            const shell = resolveShell(this.#shells, runtime.record.shell);
            if (shell) await this.#spawn(runtime, shell);
          }
          subscriber = {
            connection,
            stream,
            terminalId: open.terminalId,
            viewId: open.viewId,
            viewAttributes: open.viewAttributes,
            deviceClass: open.deviceClass,
            cols: open.cols,
            rows: open.rows,
            frames: [],
            queuedBytes: 0,
            queuedOutputBytes: 0,
            writing: false,
            finishWhenDrained: false,
            detached: false,
            sizeSuperseded: false,
          };
          // A replacement stream keeps this view's identity while accepted
          // input can still be draining on its predecessor. Deliver that input,
          // but never let its old dimensions undo the replacement's resize.
          for (const previous of runtime.subscribers) {
            if (previous.viewId === open.viewId) previous.sizeSuperseded = true;
          }
          this.#setSize(
            runtime,
            open.cols,
            open.rows,
            subscriber,
            open.claimSize !== false,
          );
          runtime.subscribers.add(subscriber);
          const snapshot = await this.#snapshotForOpen(runtime, open);
          if (!snapshot) {
            queueFrame(runtime, subscriber, {
              kind: "terminal.error",
              message: "Terminal snapshot exceeds the receiving device's limit",
            });
            subscriber.finishWhenDrained = true;
            return;
          }
          queueFrame(runtime, subscriber, {
            kind: "terminal.snapshot",
            terminal: this.#summary(runtime.record),
            snapshot,
            sequence: runtime.sequence,
            sizeOwnerViewId: runtime.sizeOwnerViewId,
            submitResult: true,
          });
          if (
            !runtime.setup &&
            (runtime.record.state === "error" || !runtime.pty)
          ) {
            if (runtime.record.state === "error") {
              queueFrame(runtime, subscriber, {
                kind: "terminal.exit",
                code: runtime.record.exitCode ?? null,
                signal: null,
              });
            }
            subscriber.finishWhenDrained = true;
          }
        }),
      );
      if (terminalClosed) {
        await stream.finish().catch(() => undefined);
        await stream.stop(0).catch(() => undefined);
        return;
      }
      if (!subscriber) return;
      await this.#readClientFrames(runtime, subscriber, readFrame);
    } catch {
      if (subscriber)
        detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
      else await abortStream(stream, OVERFLOW_RESET_CODE);
    } finally {
      if (subscriber && !subscriber.detached) {
        detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
      }
    }
  }

  disconnected(): Promise<void> {
    this.#stopping = true;
    const closed = this.#approvals.close();
    void this.#stall.close();
    for (const runtime of this.#runtimes.values()) {
      this.#disposeTerminal(runtime);
    }
    this.#remote.dispose();
    return closed;
  }
  async close(): Promise<void> {
    this.#stopping = true;
    await this.#approvals.close();
    await this.#stall.close();
    try {
      for (const runtime of this.#runtimes.values()) {
        if (!runtime.hasScreen) continue;
        runtime.submissionStateChanged?.();
        await runtime.delivery;
        this.#saveCli(runtime);
        await runtime.runSerial(() => this.#persist(runtime));
      }
    } finally {
      for (const runtime of this.#runtimes.values())
        this.#disposeTerminal(runtime);
      this.#remote.dispose();
    }
  }

  #notifyCliExit(runtime: TerminalSession, reason: "user" | "exit") {
    if (runtime.cliExitNotified) return;
    runtime.cliExitNotified = true;
    runtime.notifications = runtime.notifications
      .then(() => this.onCliExit?.(runtime.record.id, reason))
      .catch(() => {
        console.error("Terminal CLI exit notification failed");
      });
  }

  #clearCli(runtime: TerminalSession, notifyExit = true): void {
    const team = runtime.teamOptions;
    const hadCli = Boolean(runtime.cli);
    this.#approvals.remove(runtime.record.id);
    runtime.clearCli(!this.#stopping);
    if (!notifyExit || this.#stopping) return;
    this.onCliStallCleared?.(runtime.record.id);
    if (hadCli && !team) this.#store.setTerminalCli(runtime.record.id);
    if (hadCli && team && !team.role) {
      const saved = this.#store.terminalCli(runtime.record.id);
      if (saved)
        this.#store.setTerminalCli(runtime.record.id, {
          ...saved,
          resumePending: true,
        });
    }
    if (hadCli) {
      this.#notifyCliExit(
        runtime,
        runtime.userInputSinceActivity ? "user" : "exit",
      );
      runtime.userInputSinceActivity = false;
      this.onCliProcessesChanged?.();
    }
  }

  #runtimeForStored(record: StoredTerminal): TerminalSession | undefined {
    const existing = this.#runtimes.get(record.id);
    if (existing) return existing;
    try {
      const runtime = new TerminalSession(
        record,
        this.#store.terminalSetup(record.id),
        this.#remote,
      );
      this.#runtimes.set(record.id, runtime);
      return runtime;
    } catch {
      return undefined;
    }
  }

  // The directory is the shell's own only after it reported one (OSC 7);
  // otherwise it is where the shell started and may be out of date.
  #summary(
    record: StoredTerminal,
    children?: ReadonlyMap<string, TeamChildIdentity>,
  ): TerminalSummary {
    const runtime = this.#runtimes.get(record.id);
    const recovery = this.#store.terminalCli(record.id);
    const presentedStatus = runtime?.waitPresentation
      ? runtime.waitPresentation.previous
      : runtime?.cliStatus;
    const setup = runtime?.setup ?? this.#store.terminalSetup(record.id);
    const teamOptions = runtime?.teamOptions;
    const childIdentity =
      runtime?.teamChild ??
      (!runtime?.cli && !teamOptions && recovery
        ? (children ?? this.#savedChildIdentities()).get(record.id)
        : undefined);
    const resumedConversation =
      !teamOptions && !childIdentity && recovery?.resumePending
        ? this.#store
            .teamConversations()
            .find((c) => c.terminalId === record.id)
        : undefined;
    const teamConversation =
      teamOptions?.conversation ??
      childIdentity?.conversation ??
      resumedConversation?.id;
    const isTeamParent =
      Boolean(teamConversation) && !childIdentity && !teamOptions?.role;
    const teamId = isTeamParent
      ? (teamOptions?.teamId ??
        resumedConversation?.teamId ??
        this.#store.teamConversations().find((c) => c.id === teamConversation)
          ?.teamId)
      : undefined;
    const teamName = teamId
      ? this.#store.readTeam(teamId)?.saved.name
      : undefined;
    return {
      ...toSummary(record, runtime?.cwdReported ?? false),
      ...(setup
        ? { setup: { state: setup.state, exitCode: setup.exitCode } }
        : {}),
      ...(teamConversation ? { teamConversation } : {}),
      ...(teamName ? { teamName } : {}),
      ...(childIdentity ? { teamChild: childIdentity.child } : {}),
      worktreePath: this.#store.terminalWorktree(record.id) ?? record.cwd,
      ...(setup && recovery ? { cli: withCurrentCliIcon(recovery.cli) } : {}),
      ...(!setup && recovery?.resumePending
        ? {
            cli: withCurrentCliIcon(recovery.cli),
            cliResumePending: true,
            ...(record.state === "error" && isTeamParent
              ? { cliResumeReason: "exit" as const }
              : {}),
          }
        : {}),
      ...(runtime?.cli ? { cli: withCurrentCliIcon(runtime.cli) } : {}),
      ...(runtime?.cli && presentedStatus
        ? { cliStatus: presentedStatus }
        : {}),
    };
  }

  #deferWaitingPresentation(
    runtime: TerminalSession,
    previous?: CliStatus,
  ): void {
    const elapsed = Date.now() - runtime.cliStatus!.since;
    if (elapsed >= CLI_WAIT_PRESENTATION_MS) return;
    runtime.waitPresentation = {
      previous,
      timer: setTimeout(() => {
        runtime.waitPresentation = undefined;
        if (runtime.stopped || this.#stopping || !runtime.cli) return;
        this.#notifyCliState(runtime, runtime.cliStatus!);
        this.#publish({
          type: "terminal.updated",
          terminal: this.#summary(runtime.record),
        });
      }, CLI_WAIT_PRESENTATION_MS - elapsed),
    };
  }

  #notifyCliState(runtime: TerminalSession, state: HookState): void {
    this.onCliNotification?.(this.#summary(runtime.record));
    runtime.notifications = runtime.notifications
      .then(() => this.onCliState?.(runtime.record.id, state))
      .catch(() => {
        console.error("Terminal CLI state notification failed");
      });
  }

  #endBackgroundWait(runtime: TerminalSession): void {
    if (!runtime.cliStatus?.backgroundTasks?.length) return;
    const { backgroundTasks: _backgroundTasks, ...status } = runtime.cliStatus;
    runtime.cliStatus = status;
    this.#saveCli(runtime);
    this.#publish({
      type: "terminal.updated",
      terminal: this.#summary(runtime.record),
    });
  }

  #noteCliInput(
    runtime: TerminalSession,
    preserveBackgroundTasks = false,
  ): void {
    if (!preserveBackgroundTasks) this.#endBackgroundWait(runtime);
    runtime.resetStallTracking();
    if (runtime.cliStatus?.stalledSince === undefined) return;
    if (runtime.initialCliStall) {
      runtime.initialCliStall = false;
      runtime.cliStatus = undefined;
    } else {
      const { stalledSince: _stalledSince, ...rest } = runtime.cliStatus;
      runtime.cliStatus = rest;
    }
    runtime.notifications = runtime.notifications
      .then(() => this.onCliStallCleared?.(runtime.record.id))
      .catch(() => this.#reportRuntimeError(runtime));
    this.#saveCli(runtime);
    this.#publish({
      type: "terminal.updated",
      terminal: this.#summary(runtime.record),
    });
    this.#stall.schedule();
  }

  #updateCliState(runtime: TerminalSession, next: HookState | undefined): void {
    if (!next || !runtime.cli || runtime.stopped || this.#stopping) return;
    const pending = runtime.cliStatus?.attention?.approval;
    if (pending && !next.attention?.approval) {
      if (next.state === "waiting" && next.attention?.kind === "approval") {
        next = { ...next, attention: runtime.cliStatus!.attention };
      } else this.#approvals.cancel(runtime.record.id);
    }
    runtime.resetStallTracking();
    const initialStall = runtime.initialCliStall;
    if (initialStall) {
      runtime.initialCliStall = false;
      runtime.cliStatus = undefined;
    }
    next = (runtime.toolActivity ??= new ToolActivity()).update(next);
    if (next.response)
      next = { ...next, response: notificationText(next.response) };
    const sameInternalState =
      runtime.cliStatus?.state === next.state &&
      runtime.cliStatus.outcome === next.outcome &&
      runtime.cliStatus.failure === next.failure &&
      JSON.stringify(runtime.cliStatus.attention) ===
        JSON.stringify(next.attention);
    const activityOnly =
      !next.backgroundTasks?.length &&
      sameInternalState &&
      runtime.cliStatus?.response === next.response &&
      JSON.stringify(runtime.cliStatus?.backgroundTasks) ===
        JSON.stringify(next.backgroundTasks);
    const hadStall =
      initialStall || runtime.cliStatus?.stalledSince !== undefined;
    if (
      activityOnly &&
      JSON.stringify(runtime.cliStatus?.activity) ===
        JSON.stringify(next.activity) &&
      !hadStall
    )
      return;
    const previous = runtime.cliStatus;
    if (
      (next.state === "active" || next.state === "waiting") &&
      (!previous ||
        (previous.state !== "active" && previous.state !== "waiting"))
    )
      runtime.cliWorkGeneration = randomUUID();
    // An unseen wait must not restart elapsed time when the CLI resumes the
    // same activity. Keep that continuity in the saved/internal state too.
    const continued =
      next.state !== "waiting"
        ? (runtime.waitPresentation?.previous ?? previous)
        : previous;
    const sameState =
      !next.backgroundTasks?.length &&
      continued?.state === next.state &&
      continued.outcome === next.outcome &&
      JSON.stringify(continued.attention) === JSON.stringify(next.attention);
    const resumedUnseen = Boolean(runtime.waitPresentation && sameState);
    runtime.cliStatus = {
      ...next,
      since: sameState ? continued!.since : Date.now(),
      ...(next.state === "waiting"
        ? {
            waitingSince:
              previous?.state === "waiting"
                ? (previous.waitingSince ?? previous.since)
                : Date.now(),
          }
        : {}),
    };
    if (next.state !== "waiting") runtime.clearWaitingPresentation();
    else if (previous?.state !== "waiting")
      this.#deferWaitingPresentation(runtime, previous);
    if (!activityOnly && !runtime.waitPresentation && !resumedUnseen)
      this.#notifyCliState(runtime, next);
    if (hadStall) {
      runtime.notifications = runtime.notifications
        .then(() => this.onCliStallCleared?.(runtime.record.id))
        .catch(() => this.#reportRuntimeError(runtime));
    }
    runtime.submissionStateChanged?.();
    this.#saveCli(runtime);
    this.#input.sendPendingLines(runtime);
    this.#publish({
      type: "terminal.updated",
      terminal: this.#summary(runtime.record),
    });
    if (runtime.cliStatus.state === "active") this.#stall.schedule();
  }

  /** A CLI outside a team has its own route; the Host lets it read the Forge only. */
  #commandRoute(id: string, cliId: string): Promise<Record<string, string>> {
    return this.#remote.channel.call(
      "commandRoute",
      id,
      { terminal: id } satisfies CliCaller,
      cliDefinitions
        .find((definition) => definition.id === cliId)
        ?.teamCommandDirectory?.(),
    );
  }

  async #launchEnvironment(
    runtime: TerminalSession,
    shell: ShellDefinition,
  ): Promise<Record<string, string> | undefined> {
    const saved = this.#store.terminalCli(runtime.record.id);
    const cliId = runtime.cli?.id ?? saved?.cli.id;
    if (!cliId) return undefined;
    if (runtime.teamOptions)
      runtime.teamOptions.team.trustWorkspace = await trustTeamWorkspace(
        runtime.record.cwd,
        this.#store.sidebarOrder(),
      );
    const launch = await this.#clis.launch(
      cliId,
      shell,
      runtime.teamOptions?.team,
      {
        cwd: runtime.record.cwd,
        ...(runtime.teamOptions || !saved?.candidate
          ? {}
          : {
              execution: {
                candidate: saved.candidate,
                teamFilesDirectory: (
                  await this.#commandRoute(runtime.record.id, cliId)
                ).IORI_TEAM_FILES_DIRECTORY,
              },
            }),
      },
    );
    return launch?.env;
  }

  respondApproval(
    terminalId: string,
    approvalId: string,
    decision: "allow" | "deny",
  ) {
    const runtime = this.#runtimes.get(terminalId);
    if (!runtime?.cli || runtime.stopped)
      return { status: "unavailable" as const };
    return this.#approvals.respond(terminalId, approvalId, decision);
  }

  async #registerCliHooks(runtime: TerminalSession): Promise<void> {
    if (runtime.hooks?.approval && !runtime.approvalFile) {
      runtime.approvalFile = await this.#approvals.register(
        runtime.record.id,
        (payload, id) =>
          runtime.runSerial(() => {
            if (
              this.#stopping ||
              runtime.stopped ||
              (payload.iori_cli && runtime.cli?.id !== payload.iori_cli)
            )
              return false;
            const session = cliDefinitions
              .find((d) => d.id === runtime.cli?.id)
              ?.session?.(payload);
            const currentSession = this.#store.terminalCli(
              runtime.record.id,
            )?.session;
            if (session && currentSession && session.id !== currentSession.id)
              return false;
            const approval = runtime.hooks?.approval?.(payload, id);
            if (!approval) return false;
            const next = runtime.hooks?.normalize(
              payload,
              runtime.cliStatus,
              runtime.record.cwd,
            );
            if (next?.attention?.kind !== "approval") return false;
            this.#updateCliState(runtime, {
              ...next,
              attention: { ...next.attention, approval },
            });
            return true;
          }),
        (id) => {
          if (runtime.cliStatus?.attention?.approval?.id !== id) return;
          const { approval: _approval, ...attention } =
            runtime.cliStatus.attention;
          // Removing the capability cannot end the CLI's own approval prompt.
          runtime.cliStatus = { ...runtime.cliStatus, attention };
          if (!runtime.waitPresentation && !this.#stopping)
            this.#notifyCliState(runtime, runtime.cliStatus);
          this.#saveCli(runtime);
          this.#publish({
            type: "terminal.updated",
            terminal: this.#summary(runtime.record),
          });
        },
      );
    }
    if (runtime.hooks?.observe && !runtime.hookObserver) {
      runtime.hookObserver = runtime.hooks.observe((state) => {
        void runtime
          .runSerial(() => {
            this.#updateCliState(runtime, state);
            if (state.state === "done")
              this.#clis.refreshUsage(runtime.cli?.id);
          })
          .catch(() => this.#reportRuntimeError(runtime));
      });
      await runtime.hookObserver.restore(
        this.#store.terminalCli(runtime.record.id)?.session?.file,
        runtime.cliStatus,
      );
    }

    if (runtime.hooks && !runtime.hookRoute)
      runtime.hookRoute = await this.#remote.hook(
        runtime.record.id,
        (payload) =>
          runtime.runSerial(async () => {
            if (this.#stopping) throw new Error("Terminal Host is stopping");
            if (!runtime.cli || runtime.stopped) return;
            // Not another CLI's hooks: a CLI can also run the hooks that iori
            // wrote for another CLI (Grok reads Claude Code's settings). A
            // hook without an id, written before hooks carried one, is this
            // Terminal's CLI's.
            if (payload.iori_cli && payload.iori_cli !== runtime.cli.id) return;
            const applyState = await runtime.hookObserver?.onHook(payload);
            // A CLI's own plugin sends the common shape; the values come from
            // outside iori and are read for their form.
            const common = readCommonHook(payload);
            const observedModel =
              common?.model ??
              cliDefinitions
                .find((d) => d.id === runtime.cli?.id)
                ?.observedModel?.(payload);
            if (observedModel && runtime.observedModel !== observedModel) {
              runtime.observedModel = observedModel;
              this.onCliProcessesChanged?.();
            }
            const identity =
              common?.session ??
              cliDefinitions
                .find((definition) => definition.id === runtime.cli?.id)
                ?.session?.(payload);
            if (identity) {
              const cli = this.#store.terminalCli(runtime.record.id);
              if (cli)
                this.#store.setTerminalCli(runtime.record.id, {
                  ...cli,
                  session: identity,
                });
              if (common?.tokens)
                runtime.hookTokens = {
                  sessionId: identity.id,
                  usage: common.tokens,
                };
            } else if (common?.tokens) {
              const session = this.#store.terminalCli(
                runtime.record.id,
              )?.session;
              if (session)
                runtime.hookTokens = {
                  sessionId: session.id,
                  usage: common.tokens,
                };
            }
            if (runtime.hooks?.isSessionStart?.(payload)) {
              if (!initialPromptReadyWhen(runtime)) runtime.cliReady = true;
              runtime.initialArgumentDelivered?.();
              if (runtime.initialReceipts) {
                for (const callback of new Set(
                  runtime.initialReceipts.values(),
                ))
                  callback();
                runtime.initialReceipts = undefined;
              }
              for (const id of runtime.initialDeliveryIds ?? [])
                this.onDelivered?.(id);
              runtime.initialArgumentDelivered = undefined;
              runtime.initialDeliveryIds = undefined;
            }
            const next =
              applyState === false
                ? undefined
                : (common?.state ??
                  runtime.hooks?.normalize(
                    payload,
                    runtime.cliStatus,
                    runtime.record.cwd,
                  ));
            if (applyState !== false) this.#endBackgroundWait(runtime);
            if (
              next &&
              ["active", "done"].includes(next.state) &&
              payload.hook_event_name !== "SessionEnd"
            )
              runtime.userInputSinceActivity = false;
            this.#updateCliState(runtime, next);
            if (next?.state === "done")
              this.#clis.refreshUsage(runtime.cli?.id);
            this.#input.sendInitialInput(runtime);
            this.#saveCli(runtime);
          }),
      );
  }

  async #spawn(
    runtime: TerminalSession,
    shell: ShellDefinition,
    command?: string,
    launchEnvironment?: Record<string, string>,
  ): Promise<void> {
    await runtime.ready;
    await this.#registerCliHooks(runtime);
    const marker = randomUUID();
    runtime.cliMarker = marker;
    const dialect = shellDialect(shell);
    const cliId =
      runtime.cli?.id ?? this.#store.terminalCli(runtime.record.id)?.cli.id;
    const commandEnvironment =
      cliId && !runtime.teamOptions
        ? await this.#commandRoute(runtime.record.id, cliId)
        : undefined;
    const setup = runtime.setup?.state === "running";
    const managed = setup || Boolean(command && runtime.teamOptions);
    const integration =
      !managed && (commandEnvironment || runtime.teamOptions)
        ? await this.#shellIntegration.prepare(shell, process.env)
        : undefined;
    // Supported interactive shells restore PATH after reading user profiles,
    // before the line editor starts. Managed commands and other shells keep
    // their existing prefix; none of these prefixes enter the stored command.
    runtime.commandPath = Boolean(
      !integration &&
      (runtime.teamOptions || (commandEnvironment && dialect === "posix")),
    );
    if (command && runtime.commandPath)
      command = withCommandPath(command, shell);
    runtime.inputModeReady = false;
    runtime.initialPromptWorking = false;
    runtime.initialPromptSignaled = false;
    if (setup && dialect === "powershell")
      command = `$global:LASTEXITCODE=0\n${command}\nif (-not $?) { if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }`;
    const args = managed
      ? managedCommandArguments(command!, shell)
      : command
        ? cliStartup(
            command,
            integration ? { ...shell, args: integration.args } : shell,
            marker,
          )
        : (integration?.args ?? shell.args);
    const hasLineEditor = !["sh", "dash"].includes(basename(shell.executable));
    runtime.shellReady = dialect !== "posix" || !hasLineEditor;
    if (!managed && dialect === "posix" && hasLineEditor) {
      runtime.pendingCliCommand = command;
      runtime.lineEditorReady = new LineEditorReady();
    }
    const child = await this.#remote.spawn({
      id: runtime.record.id,
      executable: shell.executable,
      args,
      seed: "",
      options: {
        name: "xterm-256color",
        cols: runtime.record.cols,
        rows: runtime.record.rows,
        cwd: runtime.record.cwd,
        env: ptyEnvironment(
          {
            ...process.env,
            ...(runtime.setup
              ? { IORI_ROOT_PATH: runtime.setup.rootPath }
              : {}),
            TERM: "xterm-256color",
            IORI_CLI_HOOK_URL: runtime.hookRoute?.url ?? "",
            IORI_CLI_APPROVAL_FILE: runtime.approvalFile ?? "",
            IORI_CLI_TRANSCRIPT_REVIEWER: "",
            ...(dialect === "cmd"
              ? { IORI_ESCAPE: "\u001b", IORI_BELL: "\u0007" }
              : {}),
            ...runtime.hooks?.env,
            IORI_COMMAND_DIRECTORY: "",
            IORI_COMMAND_AUTH: "",
            IORI_COMMAND_SESSION: "",
            IORI_TEAM_FILES_DIRECTORY: "",
            ...commandEnvironment,
            ...launchEnvironment,
            ...runtime.teamOptions?.env,
            ...integration?.env,
            ...(runtime.teamOptions
              ? cliDefinitions
                  .find(
                    (definition) =>
                      definition.id ===
                      (runtime.cli?.id ??
                        this.#store.terminalCli(runtime.record.id)?.cli.id),
                  )
                  ?.teamEnvironment?.(runtime.teamOptions.team)
              : {}),
          },
          (runtime.teamOptions?.env ?? commandEnvironment)?.IORI_COMMAND_BIN,
        ),
        encoding: "utf8",
        ...getWindowsPtySpawnOptions(),
      },
    });
    runtime.pty = child;
    runtime.commandSession = (runtime.teamOptions?.env ?? commandEnvironment)
      ?.IORI_COMMAND_SESSION;
    runtime.submissionStateChanged?.();
    runtime.ptyExited = false;
    runtime.userInputSinceActivity = false;
    runtime.cliReady = false;
    this.onCliProcessesChanged?.();
    runtime.backpressured = false;
    runtime.record.state = "running";
    runtime.record.exitCode = null;
    runtime.record.restartPending = false;
    this.#observe(runtime, shell, managed);
    if (runtime.teamOptions && !runtime.cliStatus) runtime.resetStallTracking();
    this.#stall.schedule();
    this.#saveCli(runtime, managed);
    if (!managed && command && dialect === "posix" && !hasLineEditor)
      await child.write(command + "\r");
  }
  #applyParserEvents(
    runtime: TerminalSession,
    shell: ShellDefinition,
    events: ParserEvent[],
    historical = false,
  ): void {
    for (const event of events) {
      if (event.kind === "csi") {
        const cursor = cliDefinitions.find(
          (d) => d.id === runtime.cli?.id,
        )?.waitForInputCursor;
        if (
          !runtime.pendingCliCommand &&
          (cursor
            ? event.params.includes(25) && event.modes.bracketedPaste
            : event.params.includes(2004))
        )
          runtime.inputModeReady = true;
      } else {
        if (
          !historical &&
          !runtime.pendingCliCommand &&
          event.number === 7501 &&
          initialPromptReadyWhen(runtime) === "osc7501-idle"
        ) {
          const state = osc7501Fields(event.data)?.get("state");
          if (state === "working") runtime.initialPromptWorking = true;
          if (state === "idle" && runtime.initialPromptWorking)
            runtime.initialPromptSignaled = true;
        }
        if (
          applyTerminalMetadata(
            runtime.record,
            [event],
            runtime.cli?.name ?? shell.label,
          )
        )
          runtime.cwdReported = true;
        if (
          runtime.pendingCliCommand &&
          (event.number === 0 || event.number === 2)
        )
          runtime.record.title = runtime.cli?.name ?? shell.label;
        if (
          !historical &&
          event.number === 133 &&
          shellDialect(shell) !== "posix" &&
          event.data === `D;${runtime.cliMarker}`
        ) {
          this.#clearCli(runtime);
          runtime.record.title = shell.label;
        }
        if (!historical)
          this.#updateCliState(
            runtime,
            runtime.hookObserver?.onOsc?.(
              event.number,
              event.data,
              runtime.cliStatus,
            ),
          );
      }
    }
  }

  #observe(runtime: TerminalSession, shell: ShellDefinition, managed: boolean) {
    const child = runtime.pty!,
      dialect = shellDialect(shell);
    const hasLineEditor = !["sh", "dash"].includes(basename(shell.executable));
    let initialInputTimer: NodeJS.Timeout | undefined;
    const clearInitialInputTimer = () => {
      if (initialInputTimer) clearTimeout(initialInputTimer);
      initialInputTimer = undefined;
    };
    const output = child.onData((batch) => {
      const { data } = batch;
      clearInitialInputTimer();
      if (runtime.stopped || this.#stopping) return;
      if (data.length > 0) runtime.lastOutputAt = Date.now();
      // Bound pending parser work at the PTY's read boundary, without delaying other terminals.
      child.pause();
      return runtime
        .runSerial(async () => {
          if (runtime.stopped || this.#stopping) return;
          const previousCli = runtime.cli;
          const reported = runtime.cwdReported;
          const previousCwd = runtime.record.cwd,
            previousTitle = runtime.record.title;
          if (batch.modes) {
            runtime.modes = batch.modes.modes;
            runtime.showCursor = batch.modes.showCursor;
          }
          this.#applyParserEvents(runtime, shell, batch.events);
          // A session-start hook remains authoritative. Otherwise paste mode
          // announces readiness immediately; plain-input CLIs can also settle.
          if (
            !runtime.setup &&
            (!runtime.hooks?.isSessionStart ||
              !!initialPromptReadyWhen(runtime)) &&
            !runtime.pendingCliCommand &&
            runtime.inputModeReady &&
            runtime.modes.bracketedPaste &&
            (!initialPromptReadyWhen(runtime) || runtime.initialPromptSignaled)
          )
            runtime.cliReady = true;
          this.#input.sendInitialInput(runtime);
          this.#input.sendPendingLines(runtime);
          runtime.sequence += 1;

          const editorReady = runtime.lineEditorReady?.scan(data) ?? false;
          if (editorReady) runtime.shellReady = true;
          if (runtime.pendingCliCommand && editorReady) {
            const input = runtime.pendingCliCommand;
            runtime.pendingCliCommand = undefined;
            runtime.inputModeReady = false;
            await child.write(input + "\r");
          } else if (
            !managed &&
            runtime.cli &&
            !runtime.setup &&
            dialect === "posix" &&
            !runtime.pendingCliCommand &&
            (editorReady || !hasLineEditor)
          ) {
            const ownsForeground = isWindowsHost()
              ? !(await shellActivity(child.pid, { name: false })).busy
              : await shellOwnsForeground(child.pid);
            // sh/dash have no editor notification; only those shells need to
            // observe the child once before their prompt can mean CLI exit.
            if (!hasLineEditor && ownsForeground === false)
              runtime.cliEnteredForeground = true;
            if (
              ownsForeground === true &&
              (runtime.cliEnteredForeground || editorReady)
            ) {
              this.#clearCli(runtime);
              runtime.record.title = shell.label;
            }
          }
          const changed =
            previousCli !== runtime.cli ||
            previousCwd !== runtime.record.cwd ||
            previousTitle !== runtime.record.title ||
            runtime.cwdReported !== reported;
          for (const subscriber of runtime.subscribers) {
            queueOutput(runtime, subscriber, data, runtime.sequence);
          }
          if (changed) {
            try {
              this.#store.putTerminalSummary(runtime.record);
            } catch {
              this.#markDirty(runtime);
            }
            this.#publish({
              type: "terminal.updated",
              terminal: this.#summary(runtime.record),
            });
          }
          this.#saveCli(runtime);
          this.#markDirty(runtime);
          if (
            !runtime.setup &&
            runtime.cli &&
            runtime.initialInput &&
            !runtime.cliReady &&
            !runtime.pendingCliCommand &&
            !runtime.hooks?.isSessionStart &&
            !cliDefinitions.find(
              (definition) => definition.id === runtime.cli?.id,
            )?.waitForBracketedPaste
          ) {
            const cli = runtime.cli;
            const timer = setTimeout(() => {
              void runtime
                .runSerial(() => {
                  // A later output chunk or disposal cancels even a callback
                  // already queued behind parsing. Never write into another CLI.
                  if (initialInputTimer !== timer) return;
                  initialInputTimer = undefined;
                  if (
                    runtime.stopped ||
                    this.#stopping ||
                    runtime.ptyExited ||
                    runtime.pty !== child ||
                    runtime.cli !== cli ||
                    !runtime.initialInput
                  )
                    return;
                  runtime.cliReady = true;
                  this.#input.sendInitialInput(runtime);
                  this.#saveCli(runtime);
                })
                .catch(() => this.#reportRuntimeError(runtime));
            }, INITIAL_INPUT_QUIET_MS);
            initialInputTimer = timer;
          }
        })
        .catch(() => this.#reportRuntimeError(runtime))
        .finally(() => {
          if (runtime.stopped || this.#stopping || runtime.pty !== child)
            return;
          if (allBehind(runtime, OUTPUT_HIGH_WATERMARK))
            runtime.backpressured = true;
          else child.resume();
        });
    });
    runtime.dataDisposer = {
      dispose: () => {
        clearInitialInputTimer();
        output.dispose();
      },
    };
    runtime.exitDisposer = child.onExit(({ exitCode, signal }) => {
      if (runtime.pty === child) runtime.ptyExited = true;
      return runtime
        .runSerial(async () => {
          if (this.#stopping) throw new Error("Terminal Host is stopping");
          if (runtime.stopped || runtime.pty !== child) return;
          const reportedExitCode =
            signal !== undefined && signal !== 0 ? 128 + signal : exitCode;
          runtime.clearPersistTimer();
          runtime.detachPtyObservers();
          runtime.pty = undefined;
          if (runtime.setup) {
            if (reportedExitCode === 0) {
              const command = runtime.setup.cliCommand;
              runtime.setup = undefined;
              this.#store.saveTerminalSetup(runtime.record.id, undefined);
              runtime.record.cwd =
                this.#store.terminalWorktree(runtime.record.id) ??
                runtime.record.cwd;
              await this.#spawn(
                runtime,
                shell,
                command,
                await this.#launchEnvironment(runtime, shell),
              );
            } else {
              runtime.setup = {
                ...runtime.setup,
                state: "failed",
                exitCode: reportedExitCode,
              };
              this.#store.saveTerminalSetup(runtime.record.id, runtime.setup);
              runtime.record.state = "error";
              runtime.record.exitCode = reportedExitCode;
              await this.#persist(runtime);
              this.#store.putTerminalSummary(runtime.record);
              runtime.notifications = runtime.notifications
                .then(() =>
                  this.onSetupFailed?.(runtime.record.id, reportedExitCode),
                )
                .catch(() => {
                  console.error("Terminal setup failure notification failed");
                });
              this.onCliProcessesChanged?.();
            }
            this.#publish({
              type: "terminal.updated",
              terminal: this.#summary(runtime.record),
            });
            return;
          }
          const wasTeam = Boolean(runtime.teamOptions);
          this.#clearCli(runtime);
          for (const subscriber of runtime.subscribers) {
            queueFrame(runtime, subscriber, {
              kind: "terminal.exit",
              code: reportedExitCode,
              signal: signal ?? null,
            });
            subscriber.finishWhenDrained = true;
          }
          if (reportedExitCode === 0 && !wasTeam) {
            await this.#removeTerminal(runtime.record.id, true);
            this.#disposeTerminal(runtime, true);
          } else {
            await this.#removeImages(join(this.#imagesRoot, runtime.record.id));
            await this.#persist(runtime);
            runtime.persistDirty = false;
            runtime.record.state = "error";
            runtime.record.exitCode = reportedExitCode;
            runtime.record.restartPending = false;
            try {
              this.#store.putTerminalSummary(runtime.record);
            } catch {
              this.#markDirty(runtime);
            }
            this.#publish({
              type: "terminal.updated",
              terminal: this.#summary(runtime.record),
            });
          }
        })
        .then(() => runtime.notifications)
        .catch((error: unknown) => {
          this.#reportRuntimeError(runtime);
          throw error;
        });
    });
  }

  async #writeScreen(runtime: TerminalSession, data: string) {
    const state = await this.#remote.channel.call(
      "screenWrite",
      runtime.record.id,
      data,
    );
    runtime.applyDaemonState(state);
  }
  async #startAfterHostRestart(
    runtime: TerminalSession,
    cols: number,
    rows: number,
  ): Promise<void> {
    await runtime.ready;
    if (runtime.record.snapshot) {
      await this.#writeScreen(runtime, ABORT_TRUNCATED_CONTROL_STRING);
      const recovery = this.#store.terminalCli(runtime.record.id);
      if (
        recovery?.resumePending &&
        runtime.record.snapshot.modes.alternateScreen
      ) {
        // A CLI's alternate buffer is its last visible screen. Keep it in the
        // normal history before resizing: shrinking the alternate buffer can
        // discard the reply above its cursor without putting it in history.
        const savedRows = runtime.record.rows;
        const viewport = (await this.#remote.snapshot(runtime.record.id, 0))
          .snapshotAnsi;
        await this.#writeScreen(
          runtime,
          buildProcessBoundaryGround({ keepFocusReporting: false }),
        );
        await this.#writeScreen(
          runtime,
          `\x1b[${savedRows};1H${"\r\n".repeat(savedRows)}\x1b[H${viewport}${buildProcessBoundaryGround({ keepFocusReporting: false, leaveAlternateScreen: false })}\x1b[${savedRows};1H`,
        );
      }
      await this.#writeScreen(
        runtime,
        buildTerminalRestartRecoverySequence(
          runtime.record.snapshot,
          RESTART_SEPARATOR_TEXT,
        ),
      );
    }
    await this.#remote.channel.call("resize", runtime.record.id, cols, rows);
    runtime.record.cols = cols;
    runtime.record.rows = rows;
    const shell = resolveShell(this.#shells, runtime.record.shell);
    if (!shell) {
      runtime.record.state = "error";
      runtime.record.exitCode = null;
      runtime.record.restartPending = false;
      await this.#persist(runtime);
      this.#publish({
        type: "terminal.updated",
        terminal: this.#summary(runtime.record),
      });
      return;
    }
    if (runtime.record.snapshot && isWindowsHost()) {
      await this.#writeScreen(
        runtime,
        buildFreshShellViewportBlankingSequence(
          runtime.record.rows,
          await this.#remote.channel.call("screenCursor", runtime.record.id),
        ),
      );
    }
    const recovery = this.#store.terminalCli(runtime.record.id);
    // The recovery shell must inherit the same team route as the resumed CLI.
    if (recovery?.resumePending) await this.#restoreParentOptions(runtime);
    if (recovery?.resumePending && recovery.observed)
      runtime.hooks = cliDefinitions.find(
        (definition) => definition.id === recovery.cli.id,
      )?.hooks;
    await this.#spawn(runtime, shell);
    runtime.record.restartPending = false;
    await this.#persist(runtime);
    this.#publish({
      type: "terminal.updated",
      terminal: this.#summary(runtime.record),
    });
  }

  async #snapshotForOpen(
    runtime: TerminalSession,
    open: TerminalOpenStream,
  ): Promise<WireSnapshot | undefined> {
    let lineLimit = Math.min(open.snapshotMaxLines, SCROLLBACK_LINES);
    while (true) {
      const full = await this.#remote.snapshot(runtime.record.id, lineLimit);
      const snapshot = toWireSnapshot(full);
      // The Client offers the rest only when this snapshot leaves some out.
      if ((full.scrollbackLines ?? 0) > lineLimit)
        snapshot.scrollbackTruncated = true;
      const message: TerminalServerMessage = {
        kind: "terminal.snapshot",
        terminal: this.#summary(runtime.record),
        snapshot,
        sequence: runtime.sequence,
        sizeOwnerViewId: runtime.sizeOwnerViewId,
        submitResult: true,
      };
      try {
        const encoded = encodeFrame(message);
        if (encoded.byteLength <= open.snapshotMaxBytes + 4) return snapshot;
      } catch {
        // A full frame can exceed the global transport cap before the receiver cap.
      }
      if (lineLimit === 0) return undefined;
      lineLimit = Math.floor(lineLimit / 2);
    }
  }

  #setSize(
    runtime: TerminalSession,
    cols: number,
    rows: number,
    subscriber: TerminalSubscriber,
    claimSize = true,
  ): void {
    if (subscriber.sizeSuperseded) return;
    const { deviceClass, viewId, viewAttributes } = subscriber;
    if (!claimSize) {
      if (
        runtime.sizeOwnerViewId !== viewId ||
        sameViewAttributes(runtime.viewAttributes, viewAttributes)
      ) {
        return;
      }
      runtime.viewAttributes = viewAttributes;
      this.#remote.send("attributes", runtime.record.id, viewAttributes);
      return;
    }
    const sizeChanged =
      runtime.record.cols !== cols || runtime.record.rows !== rows;
    const lastDesktopSizeChanged =
      deviceClass === "desktop" &&
      (runtime.record.lastDesktopSize.cols !== cols ||
        runtime.record.lastDesktopSize.rows !== rows);
    const ownerChanged = runtime.sizeOwnerViewId !== viewId;
    const ownerAttributesChanged =
      !ownerChanged &&
      runtime.sizeOwnerViewId === viewId &&
      !sameViewAttributes(runtime.viewAttributes, viewAttributes);
    if (
      !sizeChanged &&
      !lastDesktopSizeChanged &&
      !ownerChanged &&
      !ownerAttributesChanged
    ) {
      return;
    }
    if (sizeChanged) {
      runtime.record.cols = cols;
      runtime.record.rows = rows;
      runtime.pty?.resize(cols, rows);
    }
    if (lastDesktopSizeChanged) {
      runtime.record.lastDesktopSize = { cols, rows };
    }
    if (ownerChanged || ownerAttributesChanged) {
      if (ownerChanged) runtime.sizeOwnerViewId = viewId;
      runtime.viewAttributes = viewAttributes;
      this.#remote.send("attributes", runtime.record.id, viewAttributes);
    }
    if (sizeChanged || lastDesktopSizeChanged) {
      this.#store.putTerminalSummary(runtime.record);
    }
    if (sizeChanged) this.#markDirty(runtime);
    if (sizeChanged || lastDesktopSizeChanged || ownerChanged) {
      for (const subscriber of runtime.subscribers) {
        queueFrame(runtime, subscriber, {
          kind: "terminal.size",
          cols: runtime.record.cols,
          rows: runtime.record.rows,
          lastDesktopSize: runtime.record.lastDesktopSize,
          sizeOwnerViewId: runtime.sizeOwnerViewId,
        });
      }
    }
    if (sizeChanged || lastDesktopSizeChanged) {
      this.#publish({
        type: "terminal.updated",
        terminal: this.#summary(runtime.record),
      });
    }
  }

  async #readClientFrames(
    runtime: TerminalSession,
    subscriber: TerminalSubscriber,
    readFrame: FrameReader,
  ): Promise<void> {
    // Retiring slow output must not discard accepted input on the other half.
    // Keep reading until the Client sends FIN after draining its send queue.
    while (!runtime.stopped) {
      let frame: unknown | undefined;
      try {
        frame = await readFrame();
      } catch {
        detachSubscriber(runtime, subscriber, 0);
        return;
      }
      if (frame === undefined) {
        detachSubscriber(runtime, subscriber, 0);
        return;
      }
      let message: TerminalClientMessage | undefined;
      try {
        message = terminalClientMessageSchema.parse(frame);
        if (!message) continue;
      } catch {
        queueFrame(runtime, subscriber, {
          kind: "terminal.error",
          message: "Invalid terminal stream message",
        });
        subscriber.finishWhenDrained = true;
        return;
      }
      await runtime.runSerial(async () => {
        if (runtime.stopped) return;
        if (message.kind === "terminal.seen") {
          if (
            runtime.cliStatus?.state === "done" &&
            runtime.cliStatus.outcome !== "failure"
          ) {
            runtime.cliStatus = { state: "idle", since: Date.now() };
            this.#publish({
              type: "terminal.updated",
              terminal: this.#summary(runtime.record),
            });
          }
          return;
        }
        if (message.kind === "terminal.theme") {
          subscriber.viewAttributes = message.viewAttributes;
          if (runtime.sizeOwnerViewId === subscriber.viewId) {
            runtime.viewAttributes = message.viewAttributes;
            this.#remote.send(
              "attributes",
              runtime.record.id,
              message.viewAttributes,
            );
          }
          return;
        }
        if (
          message.kind === "terminal.resize" ||
          message.kind === "terminal.focus"
        ) {
          subscriber.cols = message.cols;
          subscriber.rows = message.rows;
          this.#setSize(runtime, message.cols, message.rows, subscriber);
          return;
        }
        this.#setSize(runtime, subscriber.cols, subscriber.rows, subscriber);
        const data =
          message.kind === "terminal.submit"
            ? message.data
            : filterKittyKeyReleases(
                message.data,
                runtime.modes.kittyKeyboardFlags,
              );
        if (!data) return;
        if (runtime.pendingCliCommand) {
          runtime.pendingCliCommand = undefined;
          this.#clearCli(runtime);
          const label = resolveShell(this.#shells, runtime.record.shell)!.label;
          runtime.record.title = label;
          try {
            this.#store.putTerminalSummary(runtime.record);
          } catch {
            this.#markDirty(runtime);
          }
          this.#publish({
            type: "terminal.updated",
            terminal: this.#summary(runtime.record),
          });
        }
        if (message.kind === "terminal.submit") {
          runtime.userInputSinceActivity = true;
          this.#noteCliInput(runtime);
          this.onCliInput?.(runtime.record.id);
          let accepted = false;
          void this.#input
            .submit(runtime, message.data, undefined, () => {
              accepted = true;
              if (message.id)
                queueFrame(runtime, subscriber, {
                  kind: "terminal.submitted",
                  id: message.id,
                  success: true,
                });
            })
            .then((success) => {
              if (message.id && !accepted)
                queueFrame(runtime, subscriber, {
                  kind: "terminal.submitted",
                  id: message.id,
                  success,
                });
            })
            .catch(() => {
              if (message.id && !accepted) {
                queueFrame(runtime, subscriber, {
                  kind: "terminal.submitted",
                  id: message.id,
                  success: false,
                });
                return;
              }
              queueFrame(runtime, subscriber, {
                kind: "terminal.error",
                message:
                  "Input could not be sent. Check the connection before continuing.",
              });
            });
          return;
        }
        try {
          if (!runtime.pty) throw new Error("CLI is stopped");
          await runtime.pty.write(data);
        } catch {
          queueFrame(runtime, subscriber, {
            kind: "terminal.error",
            message:
              "Input could not be sent. Check the connection before continuing.",
          });
          return;
        }
        if (message.origin !== "scroll" && !isNonKeyTerminalInput(data)) {
          runtime.userInputSinceActivity = true;
          this.#noteCliInput(runtime);
          this.onCliInput?.(runtime.record.id);
        }
        this.#updateCliState(
          runtime,
          runtime.hooks?.onInput?.(data, runtime.cliStatus),
        );
      });
    }
  }

  #markDirty(runtime: TerminalSession): void {
    runtime.persistDirty = true;
    this.#schedulePersist(runtime);
  }

  #schedulePersist(runtime: TerminalSession): void {
    if (
      runtime.persistScheduled ||
      runtime.persistInFlight ||
      runtime.stopped ||
      this.#stopping
    ) {
      return;
    }
    // eslint-disable-next-line iori/no-fixed-timeout-failure -- This is the bounded checkpoint cadence, not a timeout that decides whether a user operation failed.
    runtime.persistScheduled = setTimeout(() => {
      runtime.persistScheduled = undefined;
      const checkpoint = runtime.runSerial(async () => {
        if (runtime.stopped || !runtime.persistDirty) return;
        runtime.persistDirty = false;
        try {
          await this.#persist(runtime);
        } catch (error) {
          runtime.persistDirty = true;
          throw error;
        }
      });
      runtime.persistInFlight = checkpoint;
      void checkpoint
        .catch(() => this.#reportRuntimeError(runtime))
        .finally(() => {
          if (runtime.persistInFlight === checkpoint) {
            runtime.persistInFlight = undefined;
          }
          if (runtime.persistDirty) this.#schedulePersist(runtime);
        });
    }, CHECKPOINT_INTERVAL_MS);
  }

  async #persist(runtime: TerminalSession): Promise<void> {
    if (runtime.stopped) return;
    await runtime.ready;
    const snapshot = await this.#remote.snapshot(
      runtime.record.id,
      SCROLLBACK_LINES,
    );
    runtime.record.snapshot = toWireSnapshot(snapshot);
    try {
      this.#store.putTerminal(runtime.record);
    } catch {
      runtime.persistDirty = true;
      this.#schedulePersist(runtime);
    }
  }

  async #killAndWait(runtime: TerminalSession): Promise<void> {
    if (!runtime.pty) return;
    runtime.detachPtyObservers();
    await this.#remote.kill(runtime.record.id);
    runtime.ptyExited = true;
    runtime.pty = undefined;
    runtime.submissionStateChanged?.();
    this.onCliProcessesChanged?.();
  }

  #disposeTerminal(runtime: TerminalSession, drainOutput = false): void {
    runtime.stopped = true;
    runtime.clearPersistTimer();
    runtime.persistDirty = false;
    runtime.detachPtyObservers();
    runtime.pty = undefined;
    this.#clearCli(runtime, false);
    if (!drainOutput) {
      for (const subscriber of runtime.subscribers)
        detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
    }
    this.#runtimes.delete(runtime.record.id);
  }

  #reportRuntimeError(runtime: TerminalSession): void {
    // The PTY and its live subscribers can continue despite an internal failure.
    // A failed checkpoint is retried by the existing checkpoint cadence.
    if (runtime.stopped || this.#stopping) return;
    this.#markDirty(runtime);
    resumeIfCaughtUp(runtime);
  }

  async #withOperation<T>(
    context: StoreContext,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = `${context.clientPublicKey}:${context.operationId}`;
    const previous = this.#operationChains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#operationChains.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#operationChains.get(key) === current) {
        this.#operationChains.delete(key);
      }
    }
  }
}
