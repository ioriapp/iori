import { ModelCommandError } from "./models.ts";
import { hookInstallContext } from "./hook-install.ts";
import type { CliHooks } from "./hooks.ts";
import {
  orderUsageWindows,
  type CliListResult,
  type Response,
  type Event,
} from "@iori/protocol";
import type { HostStore } from "../store.ts";
import { isWindowsHost, type ShellDefinition } from "../terminal/platform.ts";
import { refreshWindowsPath } from "./windows-login-environment.ts";
import {
  cliDefinitions,
  cliSupport,
  definitionInfo,
  failedDefinitions,
  listsModels,
  loadCliDefinitions,
  type CliDefinition,
} from "./definitions.ts";
import { simpleFields } from "./user-definitions.ts";
import { invocation } from "./shell-command.ts";
import { CliDiscovery } from "./cli-discovery.ts";
import {
  buildCliLaunch,
  type LaunchOptions,
  type CliLaunch,
} from "./cli-launch.ts";
import {
  CliDefinitionEditor,
  definitionFiles,
} from "./registry-definitions.ts";

export class CliRegistry extends CliDefinitionEditor {
  readonly #discovery: CliDiscovery;
  readonly #publish: (event: Event) => void;
  readonly #controller = new AbortController();
  readonly #modelRequests = new Map<
    string,
    Promise<Response<import("@iori/protocol").CliModels>>
  >();
  readonly #hookInstalls = new Map<
    string,
    {
      hooks: CliHooks;
      ready: boolean;
      failed: boolean;
      pending?: Promise<void>;
    }
  >();
  constructor(
    store: HostStore,
    publish: (event: Event) => void,
    definitionsRoot?: string,
  ) {
    super(store, definitionsRoot);
    this.#discovery = new CliDiscovery(this.#controller.signal, publish);
    this.#publish = publish;
  }

  readonly usage = new Map<string, import("@iori/protocol").CliUsage>();
  readonly initialUsagePending = new Set<string>();
  readonly #usageMonitors = new Set<string>();
  readonly #usageRefresh = new Map<string, () => void | Promise<void>>();
  readonly #requestedRefresh = new Map<
    string,
    { started: number; pending?: Promise<void> }
  >();

  async requestUsageRefresh(cliId?: string): Promise<void> {
    const ids = cliId ? [cliId] : [...this.#usageRefresh.keys()];
    await Promise.all(
      ids.map(async (id) => {
        const previous = this.#requestedRefresh.get(id);
        if (previous?.pending) return previous.pending;
        if (previous && Date.now() - previous.started < 60_000) return;
        const refresh = this.#usageRefresh.get(id);
        if (!refresh) return;
        const entry: { started: number; pending?: Promise<void> } = {
          started: Date.now(),
        };
        this.#requestedRefresh.set(id, entry);
        entry.pending = Promise.resolve()
          .then(refresh)
          .finally(() => {
            entry.pending = undefined;
          });
        await entry.pending;
      }),
    );
  }
  onUsageChanged?: () => void;
  refreshUsage(cliId?: string): void {
    if (cliId) this.#usageRefresh.get(cliId)?.();
  }
  async close(): Promise<void> {
    this.#controller.abort();
    await super.close();
  }

  async definitionIds(): Promise<Set<string>> {
    if (this.definitionsRoot) await loadCliDefinitions(this.definitionsRoot);
    return new Set(cliDefinitions.map((definition) => definition.id));
  }

  #watchUsage(
    definition: CliDefinition,
    shell: ShellDefinition,
    command: string,
    refreshUsage: boolean,
  ) {
    if (refreshUsage || !this.usage.has(definition.id))
      this.#usageRefresh.get(definition.id)?.();
    if (!definition.usageMonitor || this.#usageMonitors.has(definition.id))
      return;
    this.#usageMonitors.add(definition.id);
    this.initialUsagePending.add(definition.id);
    definition
      .usageMonitor(
        shell,
        command,
        this.#controller.signal,
        (usage) => {
          this.initialUsagePending.delete(definition.id);
          if (usage)
            usage = {
              ...usage,
              windows: orderUsageWindows(usage.windows),
              observedAt: usage.observedAt ?? Date.now(),
            };
          if (usage) this.usage.set(definition.id, usage);
          else this.usage.delete(definition.id);
          this.#publish({
            type: "cli.usage",
            cliId: definition.id,
            usage,
          });
          this.onUsageChanged?.();
        },
        (refresh) => {
          if (refresh) this.#usageRefresh.set(definition.id, refresh);
          else this.#usageRefresh.delete(definition.id);
        },
        this.definitionsRoot,
      )
      .catch(() => {})
      .finally(() => {
        if (this.initialUsagePending.delete(definition.id))
          this.onUsageChanged?.();
        this.#usageMonitors.delete(definition.id);
      });
  }

  async list(
    shell: ShellDefinition,
    refreshUsage = false,
  ): Promise<Response<CliListResult>> {
    if (isWindowsHost()) await refreshWindowsPath();
    if (this.definitionsRoot) await loadCliDefinitions(this.definitionsRoot);
    const definitions = [...cliDefinitions];
    const commands = await this.#discovery.list(definitions, shell);
    const detected = await Promise.all(
      definitions.map(async (definition, index) => {
        const command = commands[index];
        const info = definitionInfo(definition);
        // The AI agents screen edits the definition in use. Only a user's
        // definition is made from the name and command fields; a bundled
        // one with a command line (Kiro CLI) is edited as JSON.
        const simple =
          info?.source === "user" && simpleFields(info.file, info.text);
        const edit = info && {
          ...(definition.icon ? { icon: definition.icon } : {}),
          ...(definition.customIcon ? { customIcon: true } : {}),
          source: info.source,
          definition: info.text,
          ...(simple ? { simple } : {}),
          ...(!simple ? { files: definitionFiles(info.file) } : {}),
        };
        if (!command)
          // Only a user's definition is listed before its CLI is installed.
          return info?.source === "user" || info?.source === "override"
            ? {
                id: definition.id,
                name: definition.name,
                launchEffort: definition.launchEffort,
                ...edit,
                missing: true,
                hidden: this.store.cliHidden(definition.id),
                support: cliSupport(definition, undefined),
              }
            : undefined;
        const cached = await this.#discovery.probeVersion(
          definition.id,
          shell,
          command,
        );
        this.#watchUsage(definition, shell, command, refreshUsage);
        if (this.store.openedClis().includes(definition.id))
          this.#prepareHooks(definition.id, shell, command);
        const {
          usageMonitor: _usageMonitor,
          modelCatalog: _modelCatalog,
          session: _session,
          resumeWithInputArguments: _resumeWithInputArguments,
          resumeWithTeamPrompt: _resumeWithTeamPrompt,
          resumeArguments: _resumeArguments,
          command: _command,
          interrupt: _interrupt,
          hooks: _hooks,
          launchArguments: _args,
          supportsHooks: _supportsHooks,
          observedModel: _observedModel,
          teamArguments: _teamArguments,
          managedTeamArguments: _managedTeamArguments,
          teamEnvironment: _teamEnvironment,
          launchEnvironment: _launchEnvironment,
          launchEffortForVersion: _launchEffortForVersion,
          teamInput: _teamInput,
          waitForBracketedPaste: _waitForBracketedPaste,
          waitForInputCursor: _waitForInputCursor,
          teamCommandDirectory: _teamCommandDirectory,
          commandPathArguments: _commandPathArguments,
          commandDirectoryArguments: _commandDirectoryArguments,
          aliases: _aliases,
          versionArguments: _versionArguments,
          commandLine,
          ...summary
        } = definition;
        return {
          ...summary,
          ...(definition.launchEffortForVersion
            ? {
                launchEffort: definition.launchEffortForVersion(cached.version),
              }
            : {}),
          ...edit,
          hidden: this.store.cliHidden(definition.id),
          support: cliSupport(definition, cached.version),
          supportsUsage: !!definition.supportsUsage,
          // A command line made from the name and command is edited itself.
          ...(commandLine
            ? {}
            : {
                startupArguments: this.store.cliStartupArguments(definition.id),
              }),
          ...(this.usage.has(definition.id)
            ? { usage: this.usage.get(definition.id) }
            : {}),
          ...(cached.version ? { version: cached.version } : {}),
        };
      }),
    );
    const order = this.store.cliOrder();
    const clis = detected.filter((cli) => cli !== undefined);
    clis.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
    });
    const failed = failedDefinitions();
    return {
      ok: true,
      result: {
        shell: shell.id,
        clis,
        orderable: true,
        ...(this.store.lastUsedCli()
          ? { lastUsedId: this.store.lastUsedCli() }
          : {}),
        ...(failed.length ? { failed } : {}),
      },
    };
  }

  models(
    id: string,
    shell: ShellDefinition,
  ): Promise<Response<import("@iori/protocol").CliModels>> {
    const key = JSON.stringify([shell.id, shell.executable, id]);
    const pending = this.#modelRequests.get(key);
    if (pending) return pending;
    const request = this.#readModels(id, shell).finally(() => {
      this.#modelRequests.delete(key);
    });
    this.#modelRequests.set(key, request);
    return request;
  }
  async #readModels(
    id: string,
    shell: ShellDefinition,
  ): Promise<Response<import("@iori/protocol").CliModels>> {
    const definition = cliDefinitions.find((c) => c.id === id);
    try {
      if (!definition)
        return {
          ok: true,
          result: { models: [], permissions: [], error: "not_found" },
        };
      if (!definition.modelCatalog)
        return {
          ok: true,
          result: { models: [], permissions: [], error: "unsupported" },
        };
      const resolved = await this.#discovery.resolve(definition, shell);
      if (!resolved)
        return {
          ok: true,
          result: { models: [], permissions: [], error: "not_found" },
        };
      const result = await definition.modelCatalog(
        shell,
        this.#invocation(definition, resolved, shell),
        this.#controller.signal,
      );
      return {
        ok: true,
        result: {
          ...result,
          ...(result.models.length || result.error || !listsModels(definition)
            ? {}
            : { error: "invalid_output" as const }),
        },
      };
    } catch (error) {
      return {
        ok: true,
        result: {
          models: [],
          permissions: [],
          error: "command_failed",
          ...(error instanceof ModelCommandError
            ? { errorDetail: error.detail }
            : {}),
        },
      };
    }
  }
  /** How the shell runs the resolved command; a command line runs as it is. */
  #invocation(
    definition: CliDefinition | undefined,
    resolved: string,
    shell: ShellDefinition,
  ): string {
    return definition?.commandLine ? resolved : invocation(resolved, shell);
  }

  async resumeWithTeamPrompt(
    id: string,
    shell: ShellDefinition,
  ): Promise<boolean> {
    const definition = cliDefinitions.find((cli) => cli.id === id);
    if (!definition?.resumeWithTeamPrompt) return false;
    const resolved = await this.#discovery.resolve(definition, shell, true);
    if (!resolved) return false;
    const probe = await this.#discovery.probeVersion(id, shell, resolved);
    await probe.pending;
    return definition.resumeWithTeamPrompt(probe.version);
  }

  async launch(
    id: string,
    shell: ShellDefinition,
    team?: import("./definitions.ts").TeamLaunch,
    options?: LaunchOptions,
  ): Promise<CliLaunch | undefined> {
    const definition = cliDefinitions.find((cli) => cli.id === id);
    if (!definition) return undefined;
    const resolved = await this.#discovery.resolve(definition, shell, true);
    if (!resolved) return undefined;
    // A command line from the name and command has no startup arguments.
    const savedArguments = definition.commandLine
      ? ""
      : this.store.cliStartupArguments(id);
    const installation = this.#prepareHooks(id, shell, resolved, true);
    const probe = await this.#discovery.probeVersion(id, shell, resolved);
    if (
      team ||
      options?.execution ||
      options?.waitForVersion ||
      definition.launchEnvironment ||
      definition.launchArguments ||
      definition.supportsHooks
    )
      await probe.pending;
    await installation?.pending;
    return buildCliLaunch(
      definition,
      resolved,
      shell,
      savedArguments,
      probe.version,
      !!installation?.ready,
      team,
      options,
    );
  }

  #prepareHooks(
    id: string,
    shell: ShellDefinition,
    resolved: string,
    retry = false,
  ) {
    const definition = cliDefinitions.find((cli) => cli.id === id);
    const hooks = definition?.hooks;
    if (!hooks || this.#controller.signal.aborted) return undefined;
    // Settings belong to the CLI, not the shell that resolved its command.
    // A definition read again with other hooks installs those.
    const key = id;
    const existing = this.#hookInstalls.get(key);
    if (existing?.hooks === hooks && (!existing.failed || !retry))
      return existing;
    const installation: {
      hooks: CliHooks;
      ready: boolean;
      failed: boolean;
      pending?: Promise<void>;
    } = { hooks, ready: false, failed: false };
    this.#hookInstalls.set(key, installation);
    // Every launch waits for its hooks, including bridges loaded by arguments.
    // Failed installs remain unobserved and never prevent the CLI from starting.
    installation.pending = hookInstallContext(
      shell,
      id,
      this.#invocation(definition, resolved, shell),
      true,
      this.#controller.signal,
      this.definitionsRoot,
    )
      .then((ctx) => hooks.install(ctx))
      .then(() => {
        installation.ready = !this.#controller.signal.aborted;
      })
      .catch((error) => {
        installation.failed = true;
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `iori-host cli-hooks-install-failed: ${id}: ${reason.replace(/\s+/gu, " ").trim()}`,
        );
        /* A failed or pending installation leaves this CLI unobserved. */
      });
    return installation;
  }
}
