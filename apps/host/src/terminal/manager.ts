import { randomUUID } from "node:crypto";
import { parseTerminalSnapshot } from "@iori/protocol";
import type {
  Event,
  Response,
  TeamStallReason,
  TerminalListResult,
  TerminalSummary,
} from "@iori/protocol";
import type { HostStore, StoreContext } from "../store.ts";
import type { NativeBiStream, NativeConnection } from "../native.ts";
import { CliRegistry } from "../cli/registry.ts";
import { applyTerminalMetadata } from "./terminal-metadata.ts";
import { cliDefinitions } from "../cli/definitions.ts";
import type { HookState } from "../cli/hooks.ts";
import { type ShellDefinition } from "./platform.ts";
import { discoverShells } from "./shells.ts";
import { TerminalRuntime, type TeamTerminalOptions } from "./runtime.ts";
import { RemotePtys } from "./remote-pty.ts";
import { attachTerminalDaemon, stopTerminalDaemon } from "./daemon/launch.ts";
import { TERMINAL_PARSER_SUBSCRIPTIONS } from "./runtime.ts";
import type { DaemonChannel } from "./daemon/channel.ts";
import type { HostRpc } from "./daemon/protocol.ts";
import type { Handlers } from "./daemon/channel.ts";
import type { OscEvent } from "./daemon/parser-events.ts";
import {
  executeRawCommand,
  type Caller,
  type CommandCaller,
  type CommandResult,
} from "../teams/local-command.ts";
import type { TeamCommand, TeamInputKey } from "../teams/commands.ts";
import type { ForgeCommand } from "../forge-commands.ts";

/** Reads the Forge for an `iori` command of the CLI whose worktree is `path`. */
export type ForgeCommandRunner = (
  path: string,
  command: ForgeCommand,
) => Promise<CommandResult>;
export type { TeamTerminalOptions } from "./runtime.ts";

export class TerminalManager {
  readonly #store: HostStore;
  readonly #publish: (event: Event) => void;
  readonly #root: string;
  readonly #shells: ShellDefinition[];
  readonly #clis: CliRegistry;
  readonly #forgeCommand?: ForgeCommandRunner;
  #channel!: DaemonChannel;
  #runtime!: TerminalRuntime;
  #ready = Promise.resolve();
  #closing = false;
  #eventsReady = false;
  readonly #operationChains = new Map<string, Promise<void>>();
  continuedTerminals = false;
  onTerminalsLost?: () => void;
  onRestoreTeamTerminals?: (terminalId?: string) => Promise<void>;
  onCliExit?: (id: string, reason: "exit" | "user") => void | Promise<void>;
  onSetupFailed?: (id: string, exitCode: number) => void | Promise<void>;
  onCliNotification?: (terminal: TerminalSummary) => void;
  onCliState?: (id: string, state: HookState) => void | Promise<void>;
  onCliInput?: (id: string) => void;
  onCliStalled?: (
    stalled: { id: string; since: number; reason: TeamStallReason }[],
  ) => void | Promise<void>;
  onCliStallCleared?: (id: string) => void;
  onCliProcessesChanged?: () => void;
  onDelivered?: (id: string) => void;
  onUsageChanged?: () => void;
  onTeamCommand?: (
    caller: Caller,
    command: TeamCommand,
  ) => Promise<CommandResult>;
  /** The Terminal of a team's parent or child, for its Forge commands. */
  onTeamTerminal?: (caller: Caller) => string | undefined;
  private constructor(
    store: HostStore,
    publish: (event: Event) => void,
    root: string,
    shells: ShellDefinition[],
    forgeCommand?: ForgeCommandRunner,
  ) {
    this.#store = store;
    this.#publish = publish;
    this.#root = root;
    this.#shells = shells;
    this.#forgeCommand = forgeCommand;
    this.#clis = new CliRegistry(store, publish, root);
    this.#clis.onUsageChanged = () => this.onUsageChanged?.();
  }
  static async create(
    store: HostStore,
    publish: (event: Event) => void,
    root: string,
    forgeCommand?: ForgeCommandRunner,
  ) {
    const { shells } = await discoverShells();
    const manager = new TerminalManager(
      store,
      publish,
      root,
      shells,
      forgeCommand,
    );
    await manager.#connect();
    return manager;
  }
  async #connect(
    deliveries: Iterable<{
      terminalId: string;
      id: string;
      delivered: () => void;
    }> = [],
  ) {
    const attached = await attachTerminalDaemon(this.#root);
    this.#channel = attached.channel;
    this.continuedTerminals = attached.continued;
    this.#saveShutdownScreens(attached.previous);
    if (!attached.continued) this.#store.markTerminalsForRestart();
    const remote = new RemotePtys(this.#channel);
    this.#channel.handle = {
      data: (pid, output) => remote.data(pid, output),
      event: async (event) => {
        if (this.#closing) throw new Error("Terminal Host is stopping");
        try {
          await remote.event(event);
        } catch (error) {
          if (this.#closing || this.#channel !== attached.channel) throw error;
          console.error("Terminal event processing failed");
        }
      },
      command: (caller, argv) =>
        executeRawCommand(
          {
            team: (caller, command) => {
              if (!this.onTeamCommand)
                throw new Error("Team command handler unavailable");
              return this.onTeamCommand(caller, command);
            },
            forge: (caller, command) => this.#readForge(caller, command),
          },
          caller,
          argv,
        ),
    } satisfies Handlers<HostRpc>;
    const screens = await this.#channel.call(
      "attach",
      TERMINAL_PARSER_SUBSCRIPTIONS,
    );
    this.#runtime = await TerminalRuntime.create(
      this.#store,
      this.#publish,
      this.#root,
      this.#clis,
      remote,
      attached.continued,
    );
    this.#runtime.onRestoreTeamTerminal = async (id) =>
      this.onRestoreTeamTerminals?.(id);
    this.#runtime.onCliExit = (id, reason) => {
      return this.onCliExit?.(id, reason);
    };
    this.#runtime.onCliNotification = (terminal) =>
      this.onCliNotification?.(terminal);
    this.#runtime.onCliState = (id, state) => {
      return this.onCliState?.(id, state);
    };
    this.#runtime.onSetupFailed = (id, code) => this.onSetupFailed?.(id, code);
    this.#runtime.onCliInput = (id) => this.onCliInput?.(id);
    this.#runtime.onCliStalled = (stalled) => this.onCliStalled?.(stalled);
    this.#runtime.onCliStallCleared = (id) => this.onCliStallCleared?.(id);
    this.#runtime.onCliProcessesChanged = () => this.onCliProcessesChanged?.();
    this.#runtime.onDelivered = (id) => this.onDelivered?.(id);
    await this.#runtime.restore(screens);
    if (attached.continued) {
      for (const { id, terminalId, delivered } of deliveries)
        this.bindDelivery(id, delivered, terminalId);
    }
    await this.onRestoreTeamTerminals?.();
    await this.#channel.call("activate");
    this.#channel.disconnected = () => {
      if (!this.#closing) {
        const pending = [...this.#runtime.pendingDeliveries()];
        this.#ready = this.#runtime
          .disconnected()
          .then(() => this.#connect(pending))
          .then(async () => {
            for (const terminal of this.#store.listTerminals())
              this.#publish({
                type: "terminal.updated",
                terminal: this.summary(terminal.id)!,
              });
            if (!this.continuedTerminals) this.onTerminalsLost?.();
            this.onCliProcessesChanged?.();
            if (this.#eventsReady) await this.#channel.call("commandsReady");
          });
        void this.#ready.catch(() => {});
      }
    };
  }
  /** The worktree a CLI started in decides the repository and branch it reads. */
  #readForge(caller: CommandCaller, command: ForgeCommand) {
    const terminal =
      "terminal" in caller ? caller.terminal : this.onTeamTerminal?.(caller);
    const path = terminal && this.#store.terminalWorktree(terminal);
    if (!path || !this.#forgeCommand)
      throw new Error("The CLI that called iori has ended.");
    return this.#forgeCommand(path, command);
  }
  async activateTeamEvents() {
    this.#eventsReady = true;
    await this.#channel.call("commandsReady");
    this.#runtime.flushPending();
  }
  async pauseTeamEvents() {
    this.#eventsReady = false;
    await this.#channel.call("pauseCommands").catch(() => {});
  }
  bindDelivery(id: string, delivered: () => void, terminalId?: string) {
    this.#runtime.bindDelivery(id, delivered, terminalId);
  }
  retireCommand(key: string) {
    void this.#channel.call("retireRoute", key).catch(() => {});
  }
  get preservesTerminals() {
    return !this.#channel.socket.destroyed;
  }
  async #call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.#ready;
    const action = Reflect.get(this.#runtime, method) as (
      ...args: unknown[]
    ) => T;
    return action.apply(this.#runtime, args);
  }
  isCliRunning(id: string) {
    return this.#runtime.isCliRunning(id);
  }
  runningClis() {
    return this.#runtime.runningClis();
  }
  list(): Response<TerminalListResult> {
    return this.#runtime.list();
  }
  shellActivity(id: string) {
    return this.#runtime.shellActivity(id);
  }
  workGeneration(id: string) {
    return this.#runtime.workGeneration(id);
  }
  summary(id: string): TerminalSummary | undefined {
    return this.#runtime.summary(id);
  }
  visibleScreenLines(id: string): Promise<string[] | undefined> {
    return this.#call("visibleScreenLines", id);
  }
  sendCliInput(
    id: string,
    input:
      | { text: string; enter?: boolean }
      | { key: TeamInputKey }
      | { sequence: string },
  ): Promise<boolean> {
    return this.#call("sendCliInput", id, input);
  }
  canResumeWithInput(id: string) {
    return this.#runtime.canResumeWithInput(id);
  }
  #shell() {
    const result = this.#runtime.list();
    return this.#shells.find(
      (s) => result.ok && s.id === result.result.defaultShell,
    )!;
  }
  cliModels(id: string) {
    return this.#clis.models(id, this.#shell());
  }
  requestCliUsageRefresh(cliId?: string) {
    return this.#clis.requestUsageRefresh(cliId);
  }
  listClis(refreshUsage = false) {
    return this.#clis.list(this.#shell(), refreshUsage);
  }
  cliDefinitionIds() {
    return this.#clis.definitionIds();
  }
  checkCliDefinition(
    definition: string,
    id?: string,
    files?: import("@iori/protocol").CliDefinitionAttachment[],
    owner?: string,
  ) {
    return this.#clis.checkDefinition(
      definition,
      this.#shell(),
      id,
      files,
      owner,
    );
  }
  saveCliDefinition(
    context: StoreContext,
    definition: string,
    id?: string,
    files?: import("@iori/protocol").CliDefinitionAttachment[],
  ) {
    return this.#withOperation(context, () =>
      this.#clis.saveDefinition(context, definition, id, files),
    );
  }
  saveSimpleCliDefinition(
    context: StoreContext,
    simple: import("@iori/protocol").CliSimpleDefinition,
    id?: string,
  ) {
    return this.#withOperation(context, () =>
      this.#clis.saveSimple(context, simple, id),
    );
  }
  removeCliDefinition(context: StoreContext, id: string) {
    return this.#withOperation(context, () =>
      this.#clis.removeDefinition(context, id),
    );
  }
  writeDefinitionFile(
    owner: string,
    params: import("@iori/protocol").CliDefinitionParams["cli.definition.file.write"],
  ) {
    return this.#clis.writeDefinitionFile(owner, params);
  }
  readCliDefinitionFile(id: string, name: string) {
    return this.#clis.readDefinitionFile(id, name);
  }
  discardDefinitionFiles(owner: string, ids: string[]) {
    return this.#clis.discardDefinitionFiles(owner, ids);
  }
  readCliIcon(hash: string, offset: number) {
    return this.#clis.readIcon(hash, offset);
  }
  setCliIcon(
    context: StoreContext,
    params: import("@iori/protocol").CliDefinitionParams["cli.icon.set"],
  ) {
    return this.#withOperation(context, () =>
      this.#clis.setIcon(context, params),
    );
  }
  initialUsagePending() {
    return this.#clis.initialUsagePending;
  }
  cliUsage() {
    return this.#clis.usage;
  }
  teamCommandDirectory(id: string) {
    return cliDefinitions.find((d) => d.id === id)?.teamCommandDirectory?.();
  }
  async registerCommand(caller: Caller, base?: string) {
    const key = caller.child ?? caller.conversation;
    const env = await this.#channel.call("commandRoute", key, caller, base);
    return { env, dispose: () => this.retireCommand(key) };
  }
  markTeamTerminalUnrestored(id: string) {
    this.#runtime.markTeamTerminalUnrestored(id);
  }
  configureTeamTerminal(id: string, options: TeamTerminalOptions) {
    this.#runtime.configureTeamTerminal(id, options);
  }
  identifyTeamChild(id: string, child: string, conversation: string) {
    void this.#call("identifyTeamChild", id, child, conversation).catch(
      () => {},
    );
  }
  async sendLine(
    id: string,
    line: string,
    delivered?: () => void,
    deliveryId?: string,
  ): Promise<"queued" | "delivered"> {
    const delivery = delivered ? (deliveryId ?? randomUUID()) : undefined;
    return this.#runtime.sendLine(id, line, delivered, delivery);
  }
  async sessionTokens(
    id: string,
  ): Promise<import("@iori/protocol").TokenUsage | undefined> {
    const cli = this.#store.terminalCli(id);
    if (!cli?.session) return undefined;
    const reader = cliDefinitions.find(
      (definition) => definition.id === cli.cli.id,
    )?.sessionTokens;
    if (!reader) {
      // A definition without a tokens script uses what its plugin sent.
      await this.#ready;
      return this.#runtime.commonTokens(id, cli.session.id);
    }
    const record = this.#store.terminal(id);
    const shell =
      this.#shells.find((candidate) => candidate.id === record?.shell) ??
      this.#shell();
    try {
      return await reader.read(cli.session, shell, record?.cwd);
    } catch {
      return undefined;
    } finally {
      if (!this.isCliRunning(id)) await reader.release(cli.session);
    }
  }
  /** Whether this CLI's tokens come from a definition's script. */
  usesScriptTokens(id: string): boolean {
    const saved = this.#store.terminalCli(id);
    if (!saved) return false;
    return (
      cliDefinitions.find((definition) => definition.id === saved.cli.id)
        ?.sessionTokens?.script === true
    );
  }
  releaseSessionTokens(id: string): Promise<void> | undefined {
    const cli = this.#store.terminalCli(id);
    if (cli?.session)
      return cliDefinitions
        .find((definition) => definition.id === cli.cli.id)
        ?.sessionTokens?.release(cli.session);
    return undefined;
  }
  async createTerminal(
    ...args: Parameters<TerminalRuntime["createTerminal"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["createTerminal"]>>> {
    const previous = this.#store.terminalOperationResult<
      Extract<
        Awaited<ReturnType<TerminalRuntime["createTerminal"]>>,
        { ok: true }
      >["result"]
    >(args[0]);
    if (previous) return { ok: true, result: previous };
    return this.#call("createTerminal", ...args);
  }
  async resolveSetup(
    ...args: Parameters<TerminalRuntime["resolveSetup"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["resolveSetup"]>>> {
    return this.#call("resolveSetup", ...args);
  }
  async closeTerminal(
    ...args: Parameters<TerminalRuntime["closeTerminal"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["closeTerminal"]>>> {
    const previous = this.#store.terminalOperationResult<
      Extract<
        Awaited<ReturnType<TerminalRuntime["closeTerminal"]>>,
        { ok: true }
      >["result"]
    >(args[0]);
    if (previous) return { ok: true, result: previous };
    return this.#call("closeTerminal", ...args);
  }
  async resumeCli(
    ...args: Parameters<TerminalRuntime["resumeCli"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["resumeCli"]>>> {
    const previous = this.#store.terminalOperationResult<
      Extract<
        Awaited<ReturnType<TerminalRuntime["resumeCli"]>>,
        { ok: true }
      >["result"]
    >(args[0]);
    if (previous) return { ok: true, result: previous };
    return this.#call("resumeCli", ...args);
  }
  async setDefaultShell(
    ...args: Parameters<TerminalRuntime["setDefaultShell"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["setDefaultShell"]>>> {
    const previous = this.#store.terminalOperationResult<
      Extract<
        Awaited<ReturnType<TerminalRuntime["setDefaultShell"]>>,
        { ok: true }
      >["result"]
    >(args[0]);
    if (previous) return { ok: true, result: previous };
    return this.#call("setDefaultShell", ...args);
  }
  async restartTeamTerminal(
    ...args: Parameters<TerminalRuntime["restartTeamTerminal"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["restartTeamTerminal"]>>> {
    return this.#call("restartTeamTerminal", ...args);
  }
  async stopTeamTerminal(
    ...args: Parameters<TerminalRuntime["stopTeamTerminal"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["stopTeamTerminal"]>>> {
    return this.#call("stopTeamTerminal", ...args);
  }
  async respondApproval(
    ...args: Parameters<TerminalRuntime["respondApproval"]>
  ) {
    await this.#ready;
    return this.#runtime.respondApproval(...args);
  }
  async writeImage(
    ...args: Parameters<TerminalRuntime["writeImage"]>
  ): Promise<Awaited<ReturnType<TerminalRuntime["writeImage"]>>> {
    return this.#call("writeImage", ...args);
  }
  detachConnection(connection: NativeConnection) {
    this.#runtime.detachConnection(connection);
  }
  async openStream(
    connection: NativeConnection,
    stream: NativeBiStream,
    open: import("@iori/protocol").TerminalOpenStream,
    readFrame: () => Promise<unknown | undefined>,
  ) {
    await this.#ready;
    return this.#runtime.openStream(connection, stream, open, readFrame);
  }
  #saveShutdownScreens(screens: unknown) {
    if (!Array.isArray(screens)) return;
    for (const screen of screens) {
      if (typeof screen?.id !== "string") continue;
      const record = this.#store.terminal(screen.id);
      if (!record) continue;
      const restored = { ...record };
      try {
        restored.snapshot = parseTerminalSnapshot(screen.snapshot);
      } catch {
        // A different daemon version may only supply usable OSC metadata.
      }
      if (Array.isArray(screen.state?.osc)) {
        const osc = screen.state.osc.filter(
          (event: unknown): event is OscEvent =>
            typeof event === "object" &&
            event !== null &&
            "kind" in event &&
            event.kind === "osc" &&
            "number" in event &&
            typeof event.number === "number" &&
            "data" in event &&
            typeof event.data === "string",
        );
        applyTerminalMetadata(
          restored,
          osc,
          this.#store.terminalCli(screen.id)?.cli.name ??
            this.#shells.find((shell) => shell.id === record.shell)?.label ??
            record.title,
        );
      }
      this.#store.putTerminal(restored);
    }
  }
  async stopForUninstall() {
    await this.#ready;
    this.#closing = true;
    await this.#clis.close();
    await this.#runtime.close();
    this.#saveShutdownScreens(await stopTerminalDaemon(this.#root));
    this.#store.markTerminalsForRestart();
    this.#channel.close();
  }
  async close() {
    this.#closing = true;
    await this.#clis.close();
    try {
      await this.#runtime.close();
    } finally {
      this.#channel.close();
    }
  }
  async #withOperation<T>(context: StoreContext, action: () => Promise<T>) {
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
      if (this.#operationChains.get(key) === current)
        this.#operationChains.delete(key);
    }
  }
}
