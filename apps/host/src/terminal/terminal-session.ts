import {
  buildTerminalSnapshotRestoreSequence,
  type CliStatus,
  type CliSummary,
  type TerminalViewAttributes,
} from "@iori/protocol";
import type { IDisposable } from "node-pty";
import type { StoredTerminal, StoredWorktreeSetup } from "../store.ts";
import type { CliHooks, ToolActivity } from "../cli/hooks.ts";
import type { PtyState } from "./daemon/protocol.ts";
import type { TerminalModes } from "./daemon/types.ts";
import type { LineEditorReady } from "./line-editor-ready.ts";
import type { TerminalSubscriber } from "./output-pump.ts";
import type { RemotePty, RemotePtys } from "./remote-pty.ts";
export interface TeamTerminalOptions {
  initialDelivered?: () => void;
  initialDeliveryIds?: string[];
  team: import("../cli/definitions.ts").TeamLaunch;
  env: Record<string, string>;
  conversation: string;
  teamId?: string;
  role?: string;
}

export type TeamChildIdentity = { child: string; conversation: string };

export class TerminalSession {
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
  teamChild?: TeamChildIdentity;
  teamUnrestored?: boolean;
  cliExitNotified?: boolean;
  initialInput?: string;
  initialArgumentDelivered?: () => void;
  initialReceipts?: Map<string, () => void>;
  initialDeliveryIds?: string[];
  delivery?: Promise<void>;
  submission?: Promise<boolean>;
  submissionStateChanged?: () => void;
  cli?: CliSummary;
  cliStatus?: CliStatus;
  cliWorkGeneration?: string;
  toolActivity?: ToolActivity;
  lastOutputAt?: number;
  stallResetAt?: number;
  stallGeneration = 0;
  initialCliStall?: boolean;
  stoppedDescendantSince?: Map<number, number>;
  waitPresentation?: {
    timer: NodeJS.Timeout;
    previous?: CliStatus;
  };
  pendingLines: {
    line: string;
    delivered?: () => void;
    deliveryId?: string;
  }[] = [];
  cliReady = false;
  inputModeReady = false;
  initialPromptWorking?: boolean;
  initialPromptSignaled?: boolean;
  ptyExited = false;
  hooks?: CliHooks;
  approvalFile?: string;
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
  modes: TerminalModes = {
    bracketedPaste: false,
    mouseTracking: false,
    mouseTrackingMode: "none",
    sgrMouseMode: false,
    sgrMousePixelsMode: false,
    applicationCursor: false,
    alternateScreen: false,
    kittyKeyboardFlags: 0,
  };
  showCursor = true;
  cwdReported = false;
  pty?: RemotePty;
  subscribers = new Set<TerminalSubscriber>();
  sequence = 0;
  sizeOwnerViewId = "";
  viewAttributes: TerminalViewAttributes | null = null;
  serial = Promise.resolve();
  notifications = Promise.resolve();
  #screen?: Promise<void>;
  readonly #remote: RemotePtys;
  get hasScreen() {
    return this.#screen !== undefined;
  }
  persistScheduled?: NodeJS.Timeout;
  persistInFlight?: Promise<void>;
  persistDirty = false;
  stopped = false;
  dataDisposer?: IDisposable;
  exitDisposer?: IDisposable;
  /** The PTY is not being read because the shown view is behind. */
  backpressured = false;
  constructor(
    record: StoredTerminal,
    setup: StoredWorktreeSetup | undefined,
    remote: RemotePtys,
  ) {
    this.record = record;
    this.setup = setup;
    this.imageSequence = record.imageSequence;
    this.#remote = remote;
  }
  get ready() {
    const record = this.record;
    return (this.#screen ??= this.#remote.channel
      .call(
        "screen",
        record.id,
        record.cols,
        record.rows,
        record.snapshot
          ? buildTerminalSnapshotRestoreSequence(record.snapshot)
          : "",
        record.snapshot?.oscLinks,
      )
      .then((state) => this.applyDaemonState(state)));
  }
  async runSerial<T>(action: () => Promise<T> | T): Promise<T> {
    const run = this.serial.then(action, action);
    this.serial = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  clearWaitingPresentation(): void {
    if (this.waitPresentation) clearTimeout(this.waitPresentation.timer);
    this.waitPresentation = undefined;
  }

  clearPersistTimer(): void {
    if (!this.persistScheduled) return;
    clearTimeout(this.persistScheduled);
    this.persistScheduled = undefined;
  }

  resetStallTracking(now = Date.now()): void {
    this.stallResetAt = now;
    this.stallGeneration += 1;
    this.stoppedDescendantSince?.clear();
  }

  applyDaemonState(state: PtyState): void {
    this.modes = state.modes;
    this.showCursor = state.showCursor;
  }

  configureTeam(options: TeamTerminalOptions) {
    const { team, env, conversation, role, teamId } = options;
    this.teamOptions = { team, env, conversation, role, teamId };
    this.teamUnrestored = false;
  }

  detachPtyObservers() {
    this.dataDisposer?.dispose();
    this.exitDisposer?.dispose();
    this.dataDisposer = undefined;
    this.exitDisposer = undefined;
  }

  clearCli(retireHook: boolean) {
    this.teamOptions = undefined;
    this.teamChild = undefined;
    this.teamUnrestored = false;
    this.initialReceipts = undefined;
    this.initialArgumentDelivered = undefined;
    this.initialDeliveryIds = undefined;
    this.approvalFile = undefined;
    this.hookObserver?.dispose();
    this.hookObserver = undefined;
    if (retireHook) this.hookRoute?.dispose();
    this.hookRoute = undefined;
    this.hooks = undefined;
    this.toolActivity = undefined;
    this.clearWaitingPresentation();
    this.cliStatus = undefined;
    this.resetStallTracking();
    this.lastOutputAt = undefined;
    this.submissionStateChanged?.();
    this.pendingLines = [];
    this.initialInput = undefined;
    this.cliReady = false;
    this.initialPromptWorking = false;
    this.initialPromptSignaled = false;
    this.cli = undefined;
    this.observedModel = undefined;
  }
}
