import { terminalSubmitPaste } from "./terminal-submit.ts";
import { commitAtomicFile } from "../fs/atomic-write.ts";
import { copyDeliveryFile } from "../fs/delivery-file.ts";
import { filterKittyKeyReleases } from "./kitty-key-release.ts";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { realpath, stat, mkdir, open, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type * as pty from "node-pty";
import { RemotePtys, type RemotePty } from "./remote-pty.ts";
import type { PtyScreen } from "./daemon/protocol.ts";
import type { CliCaller } from "../teams/local-command.ts";
import {
  encodeFrame,
  buildTerminalSnapshotRestoreSequence,
  notificationText,
  MAX_FRAME_BYTES,
  MAX_TERMINAL_SNAPSHOT_LINES,
  terminalClientMessageSchema,
  type Event,
  type CliSummary,
  type CliStatus,
  type Response,
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

type NativeConnection = object;
interface NativeBiStream {
  write(bytes: Buffer): Promise<void>;
  finish(): Promise<void>;
  reset(code: number): Promise<void>;
  stop(code: number): Promise<void>;
}
import type {
  HostStore,
  StoredTerminal,
  StoreContext,
  WorktreeSetup,
  StoredWorktreeSetup,
} from "../store.ts";

import {
  HeadlessEmulator,
  type HeadlessEmulatorOptions,
} from "./daemon/headless-emulator.ts";
import { replayTerminalSnapshot } from "./daemon/terminal-snapshot-replay.ts";
import type { TerminalSnapshot } from "./daemon/types.ts";
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

import { ToolActivity, type CliHooks, type HookState } from "../cli/hooks.ts";
import { cliDefinitions, withCurrentCliIcon } from "../cli/definitions.ts";
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
import { cliTitle } from "../cli/title.ts";
import { LineEditorReady } from "./line-editor-ready.ts";
import { shellOwnsForeground } from "./linux-foreground.ts";
import { ShellIntegration } from "./shell-integration.ts";

const SCROLLBACK_LINES = MAX_TERMINAL_SNAPSHOT_LINES;
const OVERFLOW_RESET_CODE = 1;
const CHECKPOINT_INTERVAL_MS = 5_000;
// Automatic permission replies were observed at ~100ms. Only presentation waits;
// input delivery and submission must see the waiting state immediately.
const CLI_WAIT_PRESENTATION_MS = 1_000;
// Pi enabled paste in its first output (184–249ms after spawn); a plain-input
// CLI drew its screen in one chunk (23–25ms). No startup output gaps preceded
// readiness in those samples. Allow 300ms of quiet for CLIs without a signal.
const INITIAL_INPUT_QUIET_MS = 300;
// Idle text-only Claude/Codex samples redraw in <=49ms; allow margin for output gaps.
const SUBMIT_QUIET_MS = 100;
const SUBMIT_NO_OUTPUT_MS = 300;
// Working Claude pauses <=442ms (p90 114ms); cap continuous redraw at 500ms.
const SUBMIT_MAX_WAIT_MS = 500;
// The PTY is paced by what the Host has not yet handed to the connections:
// stop reading while every attached view is above the high mark, continue as
// soon as any one is below the low mark (the marks VS Code's terminal flow
// control uses). A view that cannot keep up is reset when its queue overflows,
// so it never holds back the others.
const OUTPUT_HIGH_WATERMARK = 100_000;
const OUTPUT_LOW_WATERMARK = 5_000;
// Output is sent in frames at most this often and this large: one frame per
// small PTY read costs the receiver a round trip each, which is far slower
// than the PTY can produce (VS Code batches PTY data at 5 ms too).
const OUTPUT_FRAME_INTERVAL_MS = 5;
const OUTPUT_MERGE_LIMIT = 256 * 1024;
// One merged output item is enough backlog. A slower view resumes from the
// current saved screen rather than draining several MiB of obsolete output.
// Snapshot bytes are separate: a large restore must not reset itself.
const MAX_QUEUED_OUTPUT_BYTES = OUTPUT_MERGE_LIMIT;
const RESTART_SEPARATOR_TEXT = "Host の再起動で前の shell は終了しました";

/** Output waiting for the connection; later output is merged into it. */
interface PendingOutput {
  data: string;
  bytes: number;
  sequence: number;
}

interface TerminalSubscriber {
  connection: NativeConnection;
  stream: NativeBiStream;
  terminalId: string;
  viewId: string;
  viewAttributes: TerminalViewAttributes;
  deviceClass: TerminalOpenStream["deviceClass"];
  cols: number;
  rows: number;
  frames: (Buffer | PendingOutput)[];
  queuedBytes: number;
  queuedOutputBytes: number;
  writing: boolean;
  finishWhenDrained: boolean;
  detached: boolean;
  sizeSuperseded: boolean;
}

export interface TeamTerminalOptions {
  initialDelivered?: () => void;
  initialDeliveryIds?: string[];
  team: import("../cli/definitions.ts").TeamLaunch;
  env: Record<string, string>;
  conversation: string;
  role?: string;
}

interface RuntimeTerminal {
  setup?: StoredWorktreeSetup;
  imageSequence: number;
  observedModel?: string;
  /** The conversation tokens that a CLI's plugin sent in the common shape;
   * used when its definition has no tokens script. */
  hookTokens?: {
    sessionId?: string;
    usage: import("@iori/protocol").TokenUsage;
  };
  teamOptions?: TeamTerminalOptions;
  initialInput?: string;
  initialArgumentDelivered?: () => void;
  initialDeliveryIds?: string[];
  delivery?: Promise<void>;
  submission?: Promise<boolean>;
  submissionStateChanged?: () => void;
  cli?: CliSummary;
  cliStatus?: CliStatus;
  toolActivity?: ToolActivity;
  waitPresentation?: {
    timer: NodeJS.Timeout;
    previous?: CliStatus;
  };
  pendingLines: { line: string; delivered?: () => void; deliveryId?: string }[];
  cliReady: boolean;
  inputModeReady: boolean;
  ptyExited: boolean;
  hooks?: CliHooks;
  hookRoute?: { url: string; dispose: () => void };
  /** A CLI typed in this shell puts the `iori` command's location on PATH. */
  commandPath?: boolean;
  /** The non-secret command route inherited by this PTY. */
  commandSession?: string;
  hookObserver?: ReturnType<NonNullable<CliHooks["observe"]>>;
  pendingCliCommand?: string;
  lineEditorReady?: LineEditorReady;
  cliEnteredForeground?: boolean;
  userInputSinceActivity?: boolean;
  cliMarker?: string;
  shellReady?: boolean;
  record: StoredTerminal;
  emulator: HeadlessEmulator;
  pty?: RemotePty;
  subscribers: Set<TerminalSubscriber>;
  sequence: number;
  sizeOwnerViewId: string;
  viewAttributes: TerminalViewAttributes | null;
  serial: Promise<void>;
  notifications: Promise<void>;
  ready: Promise<void>;
  persistScheduled?: NodeJS.Timeout;
  persistInFlight?: Promise<void>;
  persistDirty: boolean;
  stopped: boolean;
  dataDisposer?: pty.IDisposable;
  exitDisposer?: pty.IDisposable;
  /** The PTY is not being read because the shown view is behind. */
  backpressured: boolean;
}

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

function emulatorOptions(cols: number, rows: number): HeadlessEmulatorOptions {
  return {
    cols,
    rows,
    scrollback: SCROLLBACK_LINES,
    pathFlavor: isWindowsHost() ? "win32" : "posix",
    // Match the Client: VS Code reflows the cursor line only for ConPTY.
    ...(getWindowsPtyCompatibility()?.backend === "conpty"
      ? { reflowCursorLine: true }
      : {}),
  };
}

function serializedFrame(message: TerminalServerMessage): Buffer {
  return Buffer.from(encodeFrame(message));
}

function* splitOutput(data: string, sequence: number): Generator<Buffer> {
  try {
    yield serializedFrame({ kind: "terminal.output", data, sequence });
  } catch {
    const points = [...data];
    if (points.length <= 1)
      throw new Error("Terminal output exceeds frame limit");
    const middle = Math.floor(points.length / 2);
    yield* splitOutput(points.slice(0, middle).join(""), sequence);
    yield* splitOutput(points.slice(middle).join(""), sequence);
  }
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
  readonly #runtimes = new Map<string, RuntimeTerminal>();
  readonly #teamChildIdentities = new Map<
    string,
    { child: string; conversation: string }
  >();
  readonly #operationChains = new Map<string, Promise<void>>();
  #stopping = false;
  readonly #remote: RemotePtys;
  onDelivered?: (id: string) => void;
  readonly #retiringClis = new Map<
    string,
    import("../teams/assignment.ts").RunningCli
  >();
  readonly #teamOptions = new Map<string, TeamTerminalOptions>();
  readonly #unrestoredTeamTerminals = new Set<string>();
  onCliExit?: (
    terminalId: string,
    reason: "exit" | "user",
  ) => void | Promise<void>;
  onCliState?: (terminalId: string, state: HookState) => void | Promise<void>;
  onSetupFailed?: (
    terminalId: string,
    exitCode: number,
  ) => void | Promise<void>;
  onCliInput?: (terminalId: string) => void;
  onCliProcessesChanged?: () => void;

  isCliRunning(id: string): boolean {
    const runtime = this.#runtimes.get(id);
    return Boolean(runtime?.pty && runtime.cli && !runtime.stopped);
  }

  runningClis(): import("../teams/assignment.ts").RunningCli[] {
    return [
      ...this.#retiringClis.values(),
      ...[...this.#runtimes.values()]
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
        })),
    ];
  }
  markTeamTerminalUnrestored(id: string): void {
    this.#unrestoredTeamTerminals.add(id);
  }
  configureTeamTerminal(id: string, options: TeamTerminalOptions): void {
    this.#teamOptions.set(id, options);
    const runtime = this.#runtimes.get(id);
    if (runtime) runtime.teamOptions = options;
  }
  async sendLine(
    id: string,
    line: string,
    delivered?: () => void,
    deliveryId?: string,
  ): Promise<"queued" | "delivered"> {
    const runtime = this.#runtimes.get(id);
    if (!runtime?.pty || !runtime.cli)
      throw new Error("CLI is stopped. Resume the parent conversation first.");
    let wasDelivered = false;
    const message = {
      line,
      delivered: () => {
        wasDelivered = true;
        delivered?.();
      },
      deliveryId,
    };
    await this.#runSerial(runtime, async () => {
      await runtime.ready;
      if (!runtime.pty || !runtime.cli || runtime.stopped)
        throw new Error(
          "CLI is stopped. Resume the parent conversation first.",
        );
      runtime.pendingLines.push(message);
      this.#saveCli(runtime);
      this.#sendPendingLines(runtime);
    });
    // Output parsing shares the serial queue, so delivery must wait outside it.
    await runtime.delivery;
    if (wasDelivered) return "delivered";
    if (runtime.pendingLines.includes(message)) return "queued";
    throw new Error(
      "Input delivery was interrupted. Check the CLI screen before continuing.",
    );
  }

  async stopTeamTerminal(id: string): Promise<void> {
    const runtime = this.#runtimes.get(id);
    if (!runtime) return;
    await this.#runSerial(runtime, async () => {
      await this.#persist(runtime);
      runtime.dataDisposer?.dispose();
      runtime.exitDisposer?.dispose();
      await this.#killAndWait(runtime);
      runtime.hookObserver?.dispose();
      runtime.hookObserver = undefined;
      runtime.hookRoute?.dispose();
      runtime.hookRoute = undefined;
      runtime.cli = undefined;
      this.#clearWaitingPresentation(runtime);
      runtime.cliStatus = undefined;
      runtime.pendingLines = [];
      runtime.initialInput = undefined;
      runtime.initialArgumentDelivered = undefined;
      runtime.cliReady = false;
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
    this.configureTeamTerminal(id, options);
    let runtime = this.#runtimes.get(id);
    if (!runtime) runtime = this.#runtimeForStored(record);
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
        initial: teamPrompt
          ? // One line: cmd /c stops reading its command at a line break.
            `Read ${options.team.instructionFile} and follow its instructions. ${options.team.initial}`
          : undefined,
      },
      { cwd: record.cwd, waitForVersion: true, arguments: args },
    );
    await this.#runSerial(runtime, async () => {
      // A surviving shell can still carry an earlier command route. Pass the
      // current parent environment only through a newly spawned PTY.
      if (!options.role) {
        await this.#killAndWait(runtime);
      }
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
      await this.#spawn(
        runtime,
        shell,
        launch?.command ??
          (await shellCommand(saved.command, args, shell, {
            commandLine: true,
          })),
        launch?.env,
      );
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
  ) {
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

  #saveCli(runtime: RuntimeTerminal, managed?: boolean) {
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
      record.cwd = screen.cwd ?? record.cwd;
      record.restartPending = false;
      const runtime = this.#runtimeForStored(record)!;
      await runtime.ready;
      runtime.emulator.setCwd(screen.cwd);
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
      runtime.emulator.setLastTitle(
        cliTitle(
          screen.title ?? record.title,
          saved?.cli.name ?? shell.label,
          isWindowsHost(),
        ),
      );
      runtime.pty = this.#remote.attach(screen);
      runtime.cliMarker = state?.marker;
      runtime.observedModel = state?.observedModel;
      runtime.userInputSinceActivity = state?.userInputSinceActivity;
      runtime.cli = saved && !saved.resumePending ? saved.cli : undefined;
      runtime.hooks = saved?.observed
        ? cliDefinitions.find((d) => d.id === saved.cli.id)?.hooks
        : undefined;
      runtime.cliReady = state?.ready ?? false;
      runtime.inputModeReady = screen.snapshot.modes.bracketedPaste;
      runtime.cliStatus = state?.status;
      if (runtime.cliStatus?.state === "waiting")
        this.#deferWaitingPresentation(runtime);
      runtime.pendingCliCommand = state?.pendingCommand;
      runtime.commandPath = state?.commandPath;
      runtime.commandSession = state?.commandSession;
      runtime.initialInput = state?.initialInput;
      runtime.pendingLines = state?.pendingLines ?? [];
      runtime.initialDeliveryIds = state?.initialDeliveryIds;
      if (runtime.initialDeliveryIds)
        runtime.initialArgumentDelivered = () => {
          for (const id of runtime.initialDeliveryIds ?? [])
            this.onDelivered?.(id);
        };
      runtime.shellReady =
        state?.shellReady || runtime.emulator.getModes().bracketedPaste;
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
        runtime.pty.write(runtime.pendingCliCommand + "\r");
        runtime.pendingCliCommand = undefined;
      }
      this.#store.putTerminal(record);
    }
  }

  flushPending() {
    for (const runtime of this.#runtimes.values()) {
      this.#sendInitialInput(runtime);
      this.#sendPendingLines(runtime);
    }
  }

  identifyTeamChild(
    terminalId: string,
    child: string,
    conversation: string,
  ): void {
    this.#teamChildIdentities.set(terminalId, { child, conversation });
  }

  summary(id: string): TerminalSummary | undefined {
    const record = this.#store.terminalSummary(id);
    return record ? this.#summary(record) : undefined;
  }

  list(): Response<TerminalListResult> {
    return success({
      terminals: this.#store
        .listTerminals()
        .map((record) => this.#summary(record)),
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
        const runtime = this.#newRuntime(record);
        if (teamOptions) this.configureTeamTerminal(record.id, teamOptions);
        runtime.teamOptions = teamOptions;
        runtime.initialInput = launch?.initialInput;
        await runtime.ready;
        record.snapshot = toWireSnapshot(
          await this.#remote.snapshot(record.id, 0),
        );
        this.#store.putTerminal(record);
        this.#runtimes.set(record.id, runtime);
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
          runtime.emulator.setLastTitle(launch.cli.name);
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
        await this.#runSerial(runtime, () =>
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
        const existing = this.#runtimes.get(record.id);
        existing?.emulator.dispose();
        this.#runtimes.delete(record.id);
        this.#store.removeTerminal(record.id);
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
      return this.#runSerial(runtime, async () => {
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
        this.#store.saveTerminalSetup(id, runtime.setup);
        const saved = this.#store.terminalCli(id);
        if (saved) {
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

  async resumeCli(
    context: StoreContext,
    terminalId: string,
  ): Promise<Response<TerminalCreatedResult>> {
    return this.#withOperation(context, async () => {
      const previous =
        this.#store.terminalOperationResult<TerminalCreatedResult>(context);
      if (previous) return success(previous);
      const runtime = this.#runtimes.get(terminalId);
      if (!runtime) return failed("invalid_request");
      if (this.#unrestoredTeamTerminals.has(terminalId))
        return failed("invalid_request");
      if (
        runtime.teamOptions &&
        !runtime.teamOptions.role &&
        this.#store.terminalCli(terminalId)?.resumePending &&
        (!runtime.pty ||
          !runtime.commandSession ||
          runtime.commandSession !==
            runtime.teamOptions.env.IORI_COMMAND_SESSION)
      ) {
        const resumed = await this.restartTeamTerminal(
          terminalId,
          runtime.teamOptions,
        );
        if (!resumed) return failed("invalid_request");
        const result = { terminal: this.#summary(runtime.record) };
        this.#store.saveTerminalOperationResult(context, result);
        return success(result);
      }
      return this.#runSerial(runtime, async () => {
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
        const launch = await this.#clis.launch(
          saved.cli.id,
          shell,
          runtime.teamOptions
            ? { ...runtime.teamOptions.team, initial: undefined }
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
        else runtime.pty.write(input + "\r");
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
    return this.#runSerial(runtime, async () => {
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
        await this.#runSerial(runtime, async () => {
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
          this.#clearPersistTimer(runtime);
          void Promise.resolve()
            .then(() => this.onCliExit?.(terminalId, "user"))
            .catch(() => {
              console.error("Terminal CLI exit notification failed");
            });
          if (runtime.teamOptions) await this.#killAndWait(runtime);
          this.#retireRuntime(runtime);
          await this.#removeImages(join(this.#imagesRoot, terminalId));
          this.#store.removeTerminal(terminalId);
          this.#remote.send("remove", terminalId);
          this.#remote.send("retireRoute", terminalId);
          this.#publish({ type: "terminal.closed", terminalId });
        });
      } else if (this.#store.terminalSummary(terminalId)) {
        await this.#removeImages(join(this.#imagesRoot, terminalId));
        this.#store.removeTerminal(terminalId);
        this.#remote.send("remove", terminalId);
        this.#remote.send("retireRoute", terminalId);
        this.#publish({ type: "terminal.closed", terminalId });
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
          this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
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
      await this.#sendTerminalError(stream, "Terminal not found");
      return;
    }
    let runtime = this.#runtimes.get(open.terminalId);
    if (!runtime) runtime = this.#runtimeForStored(stored);
    if (!runtime) {
      await this.#sendTerminalError(stream, "Terminal is unavailable");
      return;
    }

    let subscriber: TerminalSubscriber | undefined;
    let terminalClosed = false;
    try {
      await runtime.ready;
      await this.#remote.frozen(runtime.record.id, () =>
        this.#runSerial(runtime, async () => {
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
            this.#queueFrame(runtime, subscriber, {
              kind: "terminal.error",
              message: "Terminal snapshot exceeds the receiving device's limit",
            });
            subscriber.finishWhenDrained = true;
            return;
          }
          this.#queueFrame(runtime, subscriber, {
            kind: "terminal.snapshot",
            terminal: this.#summary(runtime.record),
            snapshot,
            sequence: runtime.sequence,
            sizeOwnerViewId: runtime.sizeOwnerViewId,
          });
          if (
            !runtime.setup &&
            (runtime.record.state === "error" || !runtime.pty)
          ) {
            if (runtime.record.state === "error") {
              this.#queueFrame(runtime, subscriber, {
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
        this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
      else await this.#abortStream(stream, OVERFLOW_RESET_CODE);
    } finally {
      if (subscriber && !subscriber.detached) {
        this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
      }
    }
  }

  disconnected() {
    this.#stopping = true;
    for (const runtime of this.#runtimes.values()) {
      runtime.hookObserver?.dispose();
      this.#clearWaitingPresentation(runtime);
      runtime.submissionStateChanged?.();
      this.#clearPersistTimer(runtime);
      runtime.dataDisposer?.dispose();
      runtime.exitDisposer?.dispose();
      for (const subscriber of runtime.subscribers)
        this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
      runtime.emulator.dispose();
    }
    this.#runtimes.clear();
  }
  async close(): Promise<void> {
    this.#stopping = true;
    for (const runtime of this.#runtimes.values()) {
      runtime.hookObserver?.dispose();
      this.#clearWaitingPresentation(runtime);
      runtime.submissionStateChanged?.();
      for (const subscriber of runtime.subscribers) {
        this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
      }
      this.#clearPersistTimer(runtime);
      await runtime.delivery;
      this.#saveCli(runtime);
      await this.#runSerial(runtime, () => this.#persist(runtime));
      runtime.persistDirty = false;
      runtime.dataDisposer?.dispose();
      runtime.exitDisposer?.dispose();
      runtime.stopped = true;
      runtime.emulator.dispose();
    }
    this.#runtimes.clear();
  }

  #clearCli(runtime: RuntimeTerminal): void {
    const hadCli = Boolean(runtime.cli);
    runtime.hookObserver?.dispose();
    runtime.hookObserver = undefined;
    runtime.hookRoute?.dispose();
    runtime.hookRoute = undefined;
    runtime.hooks = undefined;
    runtime.toolActivity = undefined;
    this.#clearWaitingPresentation(runtime);
    runtime.cliStatus = undefined;
    runtime.submissionStateChanged?.();
    runtime.pendingLines = [];
    runtime.initialInput = undefined;
    runtime.cliReady = false;
    runtime.cli = undefined;
    runtime.observedModel = undefined;
    if (!this.#stopping && !runtime.teamOptions)
      this.#store.setTerminalCli(runtime.record.id);
    if (
      hadCli &&
      !this.#stopping &&
      runtime.teamOptions &&
      !runtime.teamOptions.role
    ) {
      const saved = this.#store.terminalCli(runtime.record.id);
      if (saved)
        this.#store.setTerminalCli(runtime.record.id, {
          ...saved,
          resumePending: true,
        });
    }
    if (hadCli && !this.#stopping) {
      const reason = runtime.userInputSinceActivity ? "user" : "exit";
      runtime.notifications = runtime.notifications
        .then(() => this.onCliExit?.(runtime.record.id, reason))
        .catch(() => {
          console.error("Terminal CLI exit notification failed");
        });
      runtime.userInputSinceActivity = false;
      this.onCliProcessesChanged?.();
    }
  }

  #newRuntime(record: StoredTerminal): RuntimeTerminal {
    let runtime!: RuntimeTerminal;
    const emulator = new HeadlessEmulator({
      ...emulatorOptions(record.cols, record.rows),
    });
    if (isWindowsHost())
      emulator.installConptyPrimaryDeviceAttributesOverride();
    let ready = Promise.resolve();
    if (record.snapshot) {
      ready = replayTerminalSnapshot(emulator, record.snapshot);
    }
    emulator.installViewAttributeResponder(() => runtime.viewAttributes);
    runtime = {
      record,
      setup: this.#store.terminalSetup(record.id),
      imageSequence: record.imageSequence,
      pendingLines: [],
      cliReady: false,
      inputModeReady: false,
      ptyExited: false,
      teamOptions: this.#teamOptions.get(record.id),
      emulator,
      subscribers: new Set(),
      sequence: 0,
      sizeOwnerViewId: "",
      viewAttributes: null,
      serial: Promise.resolve(),
      notifications: Promise.resolve(),
      ready: ready.then(() =>
        this.#remote.channel.call<void>(
          "screen",
          record.id,
          record.cols,
          record.rows,
          record.snapshot
            ? buildTerminalSnapshotRestoreSequence(record.snapshot)
            : "",
          record.snapshot?.oscLinks,
        ),
      ),
      persistDirty: false,
      stopped: false,
      backpressured: false,
    };
    // Launch preparation or a queued operation can delay awaiting this screen.
    // Observe early failures now; callers still receive the original rejection.
    void runtime.ready.catch(() => {});
    // Observe this process's readiness sequence, not the previous screen's
    // modes. Some TUIs enable paste before mounting the prompt; their input
    // cursor is shown when the focused input has rendered.
    emulator.responderParser.registerCsiHandler(
      { prefix: "?", final: "h" },
      (params) => {
        const cursor = cliDefinitions.find(
          (definition) => definition.id === runtime.cli?.id,
        )?.waitForInputCursor;
        if (
          cursor
            ? params.includes(25) && emulator.getModes().bracketedPaste
            : params.includes(2004)
        )
          runtime.inputModeReady = true;
        return false;
      },
    );
    return runtime;
  }

  #runtimeForStored(record: StoredTerminal): RuntimeTerminal | undefined {
    const existing = this.#runtimes.get(record.id);
    if (existing) return existing;
    try {
      const runtime = this.#newRuntime(record);
      this.#runtimes.set(record.id, runtime);
      return runtime;
    } catch {
      return undefined;
    }
  }

  // The directory is the shell's own only after it reported one (OSC 7);
  // otherwise it is where the shell started and may be out of date.
  #summary(record: StoredTerminal): TerminalSummary {
    const runtime = this.#runtimes.get(record.id);
    const recovery = this.#store.terminalCli(record.id);
    const presentedStatus = runtime?.waitPresentation
      ? runtime.waitPresentation.previous
      : runtime?.cliStatus;
    const setup = runtime?.setup ?? this.#store.terminalSetup(record.id);
    const childIdentity = this.#teamChildIdentities.get(record.id);
    const teamConversation =
      this.#teamOptions.get(record.id)?.conversation ??
      childIdentity?.conversation ??
      (recovery?.resumePending
        ? this.#store
            .teamConversations()
            .find((c) => c.terminalId === record.id)?.id
        : undefined);
    return {
      ...toSummary(record, runtime?.emulator.getCwd() != null),
      ...(setup
        ? { setup: { state: setup.state, exitCode: setup.exitCode } }
        : {}),
      ...(teamConversation ? { teamConversation } : {}),
      ...(childIdentity ? { teamChild: childIdentity.child } : {}),
      worktreePath: this.#store.terminalWorktree(record.id) ?? record.cwd,
      ...(setup && recovery ? { cli: withCurrentCliIcon(recovery.cli) } : {}),
      ...(!setup && recovery?.resumePending
        ? {
            cli: withCurrentCliIcon(recovery.cli),
            cliResumePending: true,
            ...(record.state === "error" &&
            runtime?.teamOptions &&
            !runtime.teamOptions.role
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

  #clearWaitingPresentation(runtime: RuntimeTerminal): void {
    if (runtime.waitPresentation) clearTimeout(runtime.waitPresentation.timer);
    runtime.waitPresentation = undefined;
  }

  #deferWaitingPresentation(
    runtime: RuntimeTerminal,
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

  #notifyCliState(runtime: RuntimeTerminal, state: HookState): void {
    runtime.notifications = runtime.notifications
      .then(() => this.onCliState?.(runtime.record.id, state))
      .catch(() => {
        console.error("Terminal CLI state notification failed");
      });
  }

  #updateCliState(runtime: RuntimeTerminal, next: HookState | undefined): void {
    if (!next || !runtime.cli || runtime.stopped || this.#stopping) return;
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
      sameInternalState &&
      runtime.cliStatus?.response === next.response &&
      JSON.stringify(runtime.cliStatus?.backgroundTasks) ===
        JSON.stringify(next.backgroundTasks);
    if (
      activityOnly &&
      JSON.stringify(runtime.cliStatus?.activity) ===
        JSON.stringify(next.activity)
    )
      return;
    const previous = runtime.cliStatus;
    // An unseen wait must not restart elapsed time when the CLI resumes the
    // same activity. Keep that continuity in the saved/internal state too.
    const continued =
      next.state !== "waiting"
        ? (runtime.waitPresentation?.previous ?? previous)
        : previous;
    const sameState =
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
    if (next.state !== "waiting") this.#clearWaitingPresentation(runtime);
    else if (previous?.state !== "waiting")
      this.#deferWaitingPresentation(runtime, previous);
    if (!activityOnly && !runtime.waitPresentation && !resumedUnseen)
      this.#notifyCliState(runtime, next);
    runtime.submissionStateChanged?.();
    this.#saveCli(runtime);
    this.#sendPendingLines(runtime);
    this.#publish({
      type: "terminal.updated",
      terminal: this.#summary(runtime.record),
    });
  }

  #submit(
    runtime: RuntimeTerminal,
    text: string,
    beforeWrite?: () => void,
  ): Promise<boolean> {
    const child = runtime.pty;
    const submission = (runtime.submission ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        let timer: NodeJS.Timeout | undefined;
        let deadline: NodeJS.Timeout | undefined;
        let output: pty.IDisposable | undefined;
        let exit: pty.IDisposable | undefined;
        if (!child) return false;
        let exited = false;
        // Text sent to an open question or approval is the user's answer; hold
        // the Enter only for a prompt that appears after the text was written.
        let writtenWhileWaiting = false;
        let writtenCli: CliSummary | undefined;
        let settle!: () => void;
        const redrawn = new Promise<void>((resolve) => {
          settle = resolve;
        });
        try {
          await this.#runSerial(runtime, async () => {
            if (
              runtime.stopped ||
              this.#stopping ||
              runtime.ptyExited ||
              runtime.pty !== child
            )
              return;

            output = child.onData(() => {
              if (runtime.stopped || this.#stopping || runtime.ptyExited) {
                settle();
                return;
              }
              if (timer) clearTimeout(timer);
              timer = setTimeout(settle, SUBMIT_QUIET_MS);
            });
            exit = child.onExit(() => {
              exited = true;
              settle();
              runtime.submissionStateChanged?.();
            });
            beforeWrite?.();
            writtenWhileWaiting = runtime.cliStatus?.state === "waiting";
            writtenCli = runtime.cli;
            deadline = setTimeout(settle, SUBMIT_MAX_WAIT_MS);
            await this.#remote.channel.call(
              "write",
              runtime.record.id,
              terminalSubmitPaste(
                text,
                runtime.emulator.getModes().bracketedPaste,
              ),
            );
            if (!timer) timer = setTimeout(settle, SUBMIT_NO_OUTPUT_MS);
          });
          if (!output) return false;
          await redrawn;
          if (timer) clearTimeout(timer);
          if (deadline) clearTimeout(deadline);
          output.dispose();
          for (;;) {
            let changed!: Promise<void>;
            const sent = await this.#runSerial(runtime, async () => {
              if (
                exited ||
                runtime.stopped ||
                this.#stopping ||
                runtime.ptyExited ||
                runtime.pty !== child ||
                // The CLI ended while the Enter was held; do not reach the shell.
                (writtenCli && !runtime.cli)
              )
                return false;
              if (
                !writtenWhileWaiting &&
                runtime.cliStatus?.state === "waiting"
              ) {
                // Hooks and lifecycle changes wake this wait outside the serial queue.
                changed = new Promise<void>((resolve) => {
                  runtime.submissionStateChanged = resolve;
                });
                return undefined;
              }
              await this.#remote.channel.call("write", runtime.record.id, "\r");
              this.#updateCliState(
                runtime,
                runtime.hooks?.onInput?.("\r", runtime.cliStatus),
              );
              return true;
            });
            if (sent !== undefined) return sent;
            await changed;
          }
        } finally {
          if (timer) clearTimeout(timer);
          if (deadline) clearTimeout(deadline);
          output?.dispose();
          exit?.dispose();
          runtime.submissionStateChanged = undefined;
        }
      });
    runtime.submission = submission;
    void submission
      .finally(() => {
        if (runtime.submission === submission) runtime.submission = undefined;
      })
      .catch(() => {});
    return submission;
  }

  #sendInitialInput(runtime: RuntimeTerminal): void {
    if (runtime.setup || !runtime.cliReady || !runtime.initialInput) return;
    runtime.pendingLines.unshift({ line: runtime.initialInput });
    runtime.initialInput = undefined;
    this.#sendPendingLines(runtime);
  }

  #sendPendingLines(runtime: RuntimeTerminal): void {
    const waitForBracketedPaste = cliDefinitions.find(
      (definition) => definition.id === runtime.cli?.id,
    )?.waitForBracketedPaste;
    if (
      runtime.setup ||
      runtime.cliStatus?.state === "waiting" ||
      (runtime.teamOptions &&
        ((waitForBracketedPaste &&
          (!runtime.inputModeReady ||
            // Startup probes can disable paste again before the input UI mounts.
            !runtime.emulator.getModes().bracketedPaste)) ||
          (runtime.hooks?.isSessionStart && !runtime.cliReady))) ||
      !runtime.pty ||
      !runtime.cli ||
      runtime.stopped ||
      this.#stopping
    )
      return;
    if (runtime.delivery) return;
    runtime.delivery = (async () => {
      while (runtime.pendingLines.length) {
        const message = runtime.pendingLines[0]!;
        if (
          !(await this.#submit(runtime, message.line, () => {
            // Once writing starts, an interrupted delivery must never be replayed.
            runtime.pendingLines.shift();
            this.#saveCli(runtime);
          }))
        )
          return;
        message.delivered?.();
        if (message.deliveryId) this.onDelivered?.(message.deliveryId);
        this.#saveCli(runtime);
      }
    })()
      .catch(() => this.#reportRuntimeError(runtime))
      .finally(() => {
        runtime.delivery = undefined;
      });
  }

  /** A CLI outside a team has its own route; the Host lets it read the Forge only. */
  #commandRoute(id: string, cliId: string): Promise<Record<string, string>> {
    return this.#remote.channel.call<Record<string, string>>(
      "commandRoute",
      id,
      { terminal: id } satisfies CliCaller,
      cliDefinitions
        .find((definition) => definition.id === cliId)
        ?.teamCommandDirectory?.(),
    );
  }

  async #launchEnvironment(
    runtime: RuntimeTerminal,
    shell: ShellDefinition,
  ): Promise<Record<string, string> | undefined> {
    const saved = this.#store.terminalCli(runtime.record.id);
    const cliId = runtime.cli?.id ?? saved?.cli.id;
    if (!cliId) return undefined;
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

  async #registerCliHooks(runtime: RuntimeTerminal): Promise<void> {
    if (runtime.hooks?.observe && !runtime.hookObserver) {
      runtime.hookObserver = runtime.hooks.observe((state) => {
        void this.#runSerial(runtime, () => {
          this.#updateCliState(runtime, state);
          if (state.state === "done") this.#clis.refreshUsage(runtime.cli?.id);
        }).catch(() => this.#reportRuntimeError(runtime));
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
          this.#runSerial(runtime, async () => {
            if (!runtime.cli || runtime.stopped || this.#stopping) return;
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
              runtime.cliReady = true;
              runtime.initialArgumentDelivered?.();
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
            if (
              next &&
              ["active", "done"].includes(next.state) &&
              payload.hook_event_name !== "SessionEnd"
            )
              runtime.userInputSinceActivity = false;
            this.#updateCliState(runtime, next);
            if (next?.state === "done")
              this.#clis.refreshUsage(runtime.cli?.id);
            this.#sendInitialInput(runtime);
            this.#saveCli(runtime);
          }),
      );
  }

  async #spawn(
    runtime: RuntimeTerminal,
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
    this.#saveCli(runtime, managed);
    if (!managed && command && dialect === "posix" && !hasLineEditor)
      child.write(command + "\r");
  }
  #observe(runtime: RuntimeTerminal, shell: ShellDefinition, managed: boolean) {
    const child = runtime.pty!,
      dialect = shellDialect(shell);
    const hasLineEditor = !["sh", "dash"].includes(basename(shell.executable));
    if (dialect !== "posix")
      runtime.emulator.responderParser.registerOscHandler(133, (data) => {
        if (data !== `D;${runtime.cliMarker}`) return false;
        this.#clearCli(runtime);
        runtime.emulator.setLastTitle(shell.label);
        return true;
      });
    for (const id of [0, 2])
      runtime.emulator.responderParser.registerOscHandler(id, (data) => {
        if (runtime.pendingCliCommand) {
          runtime.emulator.setLastTitle(runtime.cli?.name ?? shell.label);
          return true;
        }
        runtime.emulator.setLastTitle(
          cliTitle(data, runtime.cli?.name ?? shell.label, isWindowsHost()),
        );
        return true;
      });
    let initialInputTimer: NodeJS.Timeout | undefined;
    const clearInitialInputTimer = () => {
      if (initialInputTimer) clearTimeout(initialInputTimer);
      initialInputTimer = undefined;
    };
    const output = child.onData((data) => {
      clearInitialInputTimer();
      if (runtime.stopped || this.#stopping) return;
      // Bound pending parser work at the PTY's read boundary, without delaying other terminals.
      child.pause();
      return this.#runSerial(runtime, async () => {
        if (runtime.stopped || this.#stopping) return;
        const previousCli = runtime.cli;
        const reported = runtime.emulator.getCwd() !== null;
        await runtime.emulator.write(data, { forwardQueryReplies: false });
        // A session-start hook remains authoritative. Otherwise paste mode
        // announces readiness immediately; plain-input CLIs can also settle.
        if (
          !runtime.setup &&
          !runtime.hooks?.isSessionStart &&
          runtime.emulator.getModes().bracketedPaste
        )
          runtime.cliReady = true;
        this.#sendInitialInput(runtime);
        this.#sendPendingLines(runtime);
        runtime.sequence += 1;
        const cwd = runtime.emulator.getCwd() ?? runtime.record.cwd;
        const editorReady = runtime.lineEditorReady?.scan(data) ?? false;
        if (editorReady) runtime.shellReady = true;
        if (runtime.pendingCliCommand && editorReady) {
          const input = runtime.pendingCliCommand;
          runtime.pendingCliCommand = undefined;
          child.write(input + "\r");
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
            runtime.emulator.setLastTitle(shell.label);
          }
        }
        const title = runtime.emulator.getLastTitle() ?? runtime.record.title;
        const changed =
          previousCli !== runtime.cli ||
          cwd !== runtime.record.cwd ||
          title !== runtime.record.title ||
          (runtime.emulator.getCwd() !== null) !== reported;
        runtime.record.cwd = cwd;
        runtime.record.title = title;
        for (const subscriber of runtime.subscribers) {
          this.#queueOutput(runtime, subscriber, data, runtime.sequence);
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
            void this.#runSerial(runtime, () => {
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
              this.#sendInitialInput(runtime);
              this.#saveCli(runtime);
            }).catch(() => this.#reportRuntimeError(runtime));
          }, INITIAL_INPUT_QUIET_MS);
          initialInputTimer = timer;
        }
      })
        .catch(() => this.#reportRuntimeError(runtime))
        .finally(() => {
          if (runtime.stopped || this.#stopping || runtime.pty !== child)
            return;
          if (this.#allBehind(runtime, OUTPUT_HIGH_WATERMARK))
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
      return this.#runSerial(runtime, async () => {
        if (runtime.stopped || this.#stopping) return;
        const reportedExitCode =
          signal !== undefined && signal !== 0 ? 128 + signal : exitCode;
        this.#clearPersistTimer(runtime);
        runtime.dataDisposer?.dispose();
        runtime.exitDisposer?.dispose();
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
        this.#clearCli(runtime);
        for (const subscriber of runtime.subscribers) {
          this.#queueFrame(runtime, subscriber, {
            kind: "terminal.exit",
            code: reportedExitCode,
            signal: signal ?? null,
          });
          subscriber.finishWhenDrained = true;
        }
        await this.#removeImages(join(this.#imagesRoot, runtime.record.id));
        if (reportedExitCode === 0 && !runtime.teamOptions) {
          this.#store.removeTerminal(runtime.record.id);
          this.#remote.send("remove", runtime.record.id);
          this.#remote.send("retireRoute", runtime.record.id);
          this.#publish({
            type: "terminal.closed",
            terminalId: runtime.record.id,
            processExited: true,
          });
          runtime.stopped = true;
          runtime.persistDirty = false;
          runtime.emulator.disableQueryReplyForwarding();
          runtime.emulator.dispose();
          this.#runtimes.delete(runtime.record.id);
        } else {
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
        .catch(() => this.#reportRuntimeError(runtime));
    });
  }

  async #writeScreen(runtime: RuntimeTerminal, data: string) {
    await this.#remote.channel.call("screenWrite", runtime.record.id, data);
    await runtime.emulator.write(data);
  }
  async #startAfterHostRestart(
    runtime: RuntimeTerminal,
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
    runtime.emulator.resize(cols, rows);
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
          await this.#remote.channel.call<number>(
            "screenCursor",
            runtime.record.id,
          ),
        ),
      );
    }
    const recovery = this.#store.terminalCli(runtime.record.id);
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
    runtime: RuntimeTerminal,
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
    runtime: RuntimeTerminal,
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
      runtime.emulator.applyPushedViewAttributes(viewAttributes);
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
      runtime.emulator.resize(cols, rows);
      runtime.pty?.resize(cols, rows);
    }
    if (lastDesktopSizeChanged) {
      runtime.record.lastDesktopSize = { cols, rows };
    }
    if (ownerChanged || ownerAttributesChanged) {
      if (ownerChanged) runtime.sizeOwnerViewId = viewId;
      runtime.viewAttributes = viewAttributes;
      runtime.emulator.applyPushedViewAttributes(viewAttributes);
      this.#remote.send("attributes", runtime.record.id, viewAttributes);
    }
    if (sizeChanged || lastDesktopSizeChanged) {
      this.#store.putTerminalSummary(runtime.record);
    }
    if (sizeChanged) this.#markDirty(runtime);
    if (sizeChanged || lastDesktopSizeChanged || ownerChanged) {
      for (const subscriber of runtime.subscribers) {
        this.#queueFrame(runtime, subscriber, {
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
    runtime: RuntimeTerminal,
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
        this.#finishSubscriber(runtime, subscriber);
        return;
      }
      if (frame === undefined) {
        this.#finishSubscriber(runtime, subscriber);
        return;
      }
      let message: TerminalClientMessage | undefined;
      try {
        message = terminalClientMessageSchema.parse(frame);
        if (!message) continue;
      } catch {
        this.#queueFrame(runtime, subscriber, {
          kind: "terminal.error",
          message: "Invalid terminal stream message",
        });
        subscriber.finishWhenDrained = true;
        return;
      }
      await this.#runSerial(runtime, () => {
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
            runtime.emulator.applyPushedViewAttributes(message.viewAttributes);
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
                runtime.emulator.getModes().kittyKeyboardFlags,
              );
        if (!data) return;
        if (runtime.pendingCliCommand) {
          runtime.pendingCliCommand = undefined;
          this.#clearCli(runtime);
          const label = resolveShell(this.#shells, runtime.record.shell)!.label;
          runtime.emulator.setLastTitle(label);
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
          this.onCliInput?.(runtime.record.id);
          void this.#submit(runtime, message.data).catch(() => {
            this.#queueFrame(runtime, subscriber, {
              kind: "terminal.error",
              message:
                "Input could not be sent. Check the connection before continuing.",
            });
          });
          return;
        }
        if (message.origin !== "scroll") {
          runtime.userInputSinceActivity = true;
          this.onCliInput?.(runtime.record.id);
        }
        runtime.pty?.write(data);
        this.#updateCliState(
          runtime,
          runtime.hooks?.onInput?.(data, runtime.cliStatus),
        );
      });
    }
  }

  #queueFrame(
    runtime: RuntimeTerminal,
    subscriber: TerminalSubscriber,
    message: TerminalServerMessage,
  ): void {
    try {
      this.#queueBytes(runtime, subscriber, serializedFrame(message));
    } catch {
      this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
    }
  }

  #queueBytes(
    runtime: RuntimeTerminal,
    subscriber: TerminalSubscriber,
    frame: Buffer,
  ): void {
    if (subscriber.detached) return;
    if (subscriber.queuedBytes + frame.byteLength > MAX_FRAME_BYTES) {
      this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
      return;
    }
    subscriber.frames.push(frame);
    subscriber.queuedBytes += frame.byteLength;
    void this.#flush(runtime, subscriber);
  }

  #queueOutput(
    runtime: RuntimeTerminal,
    subscriber: TerminalSubscriber,
    data: string,
    sequence: number,
  ): void {
    if (subscriber.detached) return;
    const bytes = Buffer.byteLength(data);
    if (
      subscriber.queuedBytes + bytes > MAX_FRAME_BYTES ||
      subscriber.queuedOutputBytes + bytes > MAX_QUEUED_OUTPUT_BYTES
    ) {
      this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE, true);
      return;
    }
    // The item being written has left the queue; the ones behind it can grow.
    const last = subscriber.frames.at(-1);
    if (
      last &&
      !Buffer.isBuffer(last) &&
      last.bytes + bytes <= OUTPUT_MERGE_LIMIT
    ) {
      last.data += data;
      last.bytes += bytes;
      last.sequence = sequence;
    } else {
      subscriber.frames.push({ data, bytes, sequence });
    }
    subscriber.queuedBytes += bytes;
    subscriber.queuedOutputBytes += bytes;
    void this.#flush(runtime, subscriber);
  }

  /** Whether every attached view has more than `mark` waiting. */
  #allBehind(runtime: RuntimeTerminal, mark: number): boolean {
    if (runtime.subscribers.size === 0) return false;
    for (const subscriber of runtime.subscribers) {
      if (subscriber.queuedBytes <= mark) return false;
    }
    return true;
  }

  #resumeIfCaughtUp(runtime: RuntimeTerminal): void {
    if (
      !runtime.backpressured ||
      this.#allBehind(runtime, OUTPUT_LOW_WATERMARK)
    )
      return;
    runtime.backpressured = false;
    if (!runtime.stopped && !this.#stopping) runtime.pty?.resume();
  }

  async #flush(
    runtime: RuntimeTerminal,
    subscriber: TerminalSubscriber,
  ): Promise<void> {
    if (subscriber.writing || subscriber.detached) return;
    subscriber.writing = true;
    try {
      while (subscriber.frames.length > 0 && !subscriber.detached) {
        const item = subscriber.frames.shift()!;
        const size = Buffer.isBuffer(item) ? item.byteLength : item.bytes;
        try {
          if (Buffer.isBuffer(item)) await subscriber.stream.write(item);
          else {
            for (const frame of splitOutput(item.data, item.sequence))
              await subscriber.stream.write(frame);
            // Output arriving meanwhile joins the next frame.
            await new Promise((resolve) =>
              setTimeout(resolve, OUTPUT_FRAME_INTERVAL_MS),
            );
          }
        } catch {
          this.#detachSubscriber(
            runtime,
            subscriber,
            OVERFLOW_RESET_CODE,
            true,
          );
          return;
        } finally {
          subscriber.queuedBytes = Math.max(0, subscriber.queuedBytes - size);
          if (!Buffer.isBuffer(item))
            subscriber.queuedOutputBytes = Math.max(
              0,
              subscriber.queuedOutputBytes - size,
            );
          this.#resumeIfCaughtUp(runtime);
        }
      }
      if (subscriber.finishWhenDrained && !subscriber.detached) {
        subscriber.detached = true;
        runtime.subscribers.delete(subscriber);
        await subscriber.stream.finish().catch(() => undefined);
        await subscriber.stream.stop(0).catch(() => undefined);
      }
    } finally {
      subscriber.writing = false;
    }
  }

  #detachSubscriber(
    runtime: RuntimeTerminal,
    subscriber: TerminalSubscriber,
    errorCode: number,
    preserveInput = false,
  ): void {
    if (subscriber.detached) return;
    subscriber.detached = true;
    subscriber.frames = [];
    subscriber.queuedBytes = 0;
    subscriber.queuedOutputBytes = 0;
    runtime.subscribers.delete(subscriber);
    this.#resumeIfCaughtUp(runtime);
    if (preserveInput) {
      subscriber.sizeSuperseded = true;
      void subscriber.stream.reset(errorCode).catch(() => undefined);
    } else void this.#abortStream(subscriber.stream, errorCode);
  }

  #finishSubscriber(
    runtime: RuntimeTerminal,
    subscriber: TerminalSubscriber,
  ): void {
    if (subscriber.detached) return;
    subscriber.detached = true;
    subscriber.frames = [];
    subscriber.queuedBytes = 0;
    subscriber.queuedOutputBytes = 0;
    runtime.subscribers.delete(subscriber);
    this.#resumeIfCaughtUp(runtime);
    void this.#abortStream(subscriber.stream, 0);
  }

  async #abortStream(stream: NativeBiStream, errorCode: number): Promise<void> {
    await stream.reset(errorCode).catch(() => undefined);
    await stream.stop(errorCode).catch(() => undefined);
  }

  #markDirty(runtime: RuntimeTerminal): void {
    runtime.persistDirty = true;
    this.#schedulePersist(runtime);
  }

  #schedulePersist(runtime: RuntimeTerminal): void {
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
      const checkpoint = this.#runSerial(runtime, async () => {
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

  #clearPersistTimer(runtime: RuntimeTerminal): void {
    if (!runtime.persistScheduled) return;
    clearTimeout(runtime.persistScheduled);
    runtime.persistScheduled = undefined;
  }

  async #persist(runtime: RuntimeTerminal): Promise<void> {
    if (runtime.stopped) return;
    await runtime.ready;
    runtime.record.cwd = runtime.emulator.getCwd() ?? runtime.record.cwd;
    runtime.record.title =
      runtime.emulator.getLastTitle() ?? runtime.record.title;
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

  async #killAndWait(runtime: RuntimeTerminal): Promise<void> {
    if (!runtime.pty) return;
    runtime.exitDisposer?.dispose();
    await this.#remote.kill(runtime.record.id);
    runtime.ptyExited = true;
    runtime.pty = undefined;
    runtime.submissionStateChanged?.();
    this.onCliProcessesChanged?.();
  }

  #retireRuntime(runtime: RuntimeTerminal, kill = true): void {
    // Removal from the UI does not imply the underlying process has exited.
    // Keep its slot until the actual PTY exit notification arrives.
    if (kill && runtime.pty && runtime.cli) {
      this.#retiringClis.set(runtime.record.id, {
        cli: runtime.cli.id,
        ...(runtime.observedModel ? { model: runtime.observedModel } : {}),
        ...(runtime.teamOptions
          ? {
              model:
                runtime.observedModel ??
                runtime.teamOptions.team.candidate.model,
              conversation: runtime.teamOptions.conversation,
              role: runtime.teamOptions.role,
            }
          : {}),
      });
      const listener = runtime.pty.onExit(() => {
        listener.dispose();
        this.#retiringClis.delete(runtime.record.id);
        this.onCliProcessesChanged?.();
      });
    }
    this.#clearCli(runtime);
    if (runtime.stopped) return;
    this.#clearPersistTimer(runtime);
    runtime.stopped = true;
    runtime.submissionStateChanged?.();
    runtime.dataDisposer?.dispose();
    runtime.exitDisposer?.dispose();
    if (kill && runtime.pty) runtime.pty.kill();
    runtime.pty = undefined;
    for (const subscriber of runtime.subscribers) {
      this.#detachSubscriber(runtime, subscriber, OVERFLOW_RESET_CODE);
    }
    runtime.emulator.dispose();
    this.#runtimes.delete(runtime.record.id);
  }

  #reportRuntimeError(runtime: RuntimeTerminal): void {
    // The PTY and its live subscribers can continue despite an internal failure.
    // A failed checkpoint is retried by the existing checkpoint cadence.
    if (runtime.stopped || this.#stopping) return;
    this.#markDirty(runtime);
    this.#resumeIfCaughtUp(runtime);
  }

  async #sendTerminalError(
    stream: NativeBiStream,
    message: string,
  ): Promise<void> {
    try {
      await stream.write(serializedFrame({ kind: "terminal.error", message }));
      await stream.finish();
      await stream.stop(0);
    } catch {
      await stream.reset(OVERFLOW_RESET_CODE).catch(() => undefined);
    }
  }

  async #runSerial<T>(
    runtime: RuntimeTerminal,
    action: () => Promise<T> | T,
  ): Promise<T> {
    const run = runtime.serial.then(action, action);
    runtime.serial = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
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
