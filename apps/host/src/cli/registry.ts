import { attachedFiles, attached } from "./definition-file.ts";
import {
  startupArgumentsSet,
  teamStartupArguments,
} from "./team-startup-arguments.ts";
import { ModelCommandError } from "./models.ts";
import { hookInstallContext } from "./hook-install.ts";
import type { CliHooks } from "./hooks.ts";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DefinitionUploads,
  definitionFilePath,
  imageMime,
  imageHash,
  DefinitionAttachmentError,
} from "./definition-images.ts";
import { homedir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import type {
  CliDefinitionResults,
  CliDefinitionAttachment,
  CliDefinitionReason,
  CliListResult,
  CliSimpleDefinition,
  CliSummary,
  Response,
  Event,
} from "@iori/protocol";
import type { HostStore, StoreContext } from "../store.ts";
import type { ShellDefinition } from "../terminal/platform.ts";
import {
  cliDefinitions,
  bundledDefinition,
  cliDefinitionImage,
  cliSupport,
  definitionInfo,
  failedDefinitions,
  isBundledDefinition,
  listsModels,
  loadCliDefinitions,
  readDefinitionText,
  removeUserDefinition,
  saveUserDefinition,
  userDefinitionFolders,
  writesDefinitionHooks,
  type CliDefinition,
} from "./definitions.ts";
import {
  definitionEffects,
  idFromName,
  simpleDefinition,
  simpleFields,
} from "./user-definitions.ts";
import {
  invocation,
  shellCommand,
  formatShellCommand,
  resolveShellCommands,
  runInShell,
  canResolveLaunchCommand,
} from "./shell-command.ts";

/** A user's definition in `cli-definitions/` that this Host reads. */
const isUserDefinition = (id: string) => {
  const definition = cliDefinitions.find((entry) => entry.id === id);
  const source = definition && definitionInfo(definition)?.source;
  return source === "user" || source === "override";
};

export class CliRegistry {
  readonly #store: HostStore;
  readonly #publish: (event: Event) => void;
  readonly #versions = new Map<
    string,
    { file?: string; version?: string; pending?: Promise<void> }
  >();
  readonly #commandFiles = new Map<string, string | undefined>();
  readonly #resolved = new Map<string, Map<string, string>>();
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
  /** The Host storage whose `cli-definitions/` is read again for each list,
   * with the record of the hooks that its definitions add. */
  readonly #definitionsRoot?: string;
  readonly #uploads?: DefinitionUploads;
  /** Definitions are checked and written one change at a time. */
  #definitionChanges: Promise<unknown> = Promise.resolve();
  constructor(
    store: HostStore,
    publish: (event: Event) => void,
    definitionsRoot?: string,
  ) {
    this.#store = store;
    this.#publish = publish;
    this.#definitionsRoot = definitionsRoot;
    if (definitionsRoot) this.#uploads = new DefinitionUploads(definitionsRoot);
  }
  /** The first of the CLI's command names that this shell finds. A command
   * line is found as the shell would run it. */
  async #resolve(
    definition: CliDefinition,
    shell: ShellDefinition,
  ): Promise<string | undefined> {
    if (definition.commandLine)
      return (await canResolveLaunchCommand(shell, definition.command))
        ? definition.command
        : undefined;
    const names = [definition.command, ...(definition.aliases ?? [])];
    const found = await resolveShellCommands(
      shell,
      names,
      true,
      (command, file) =>
        this.#commandFiles.set(`${shell.executable}\u0000${command}`, file),
    );
    return found.find(Boolean);
  }

  readonly usage = new Map<string, import("@iori/protocol").CliUsage>();
  readonly #usageMonitors = new Map<string, AbortController>();
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
    await this.#uploads?.close();
    for (const controller of this.#usageMonitors.values()) controller.abort();
  }

  async list(
    shell: ShellDefinition,
    refreshUsage = false,
  ): Promise<Response<CliListResult>> {
    if (this.#definitionsRoot) await loadCliDefinitions(this.#definitionsRoot);
    const definitions = [...cliDefinitions];
    const names = definitions.map((definition) =>
      definition.commandLine
        ? []
        : [definition.command, ...(definition.aliases ?? [])],
    );
    const found = await resolveShellCommands(
      shell,
      names.flat(),
      true,
      (command, file) =>
        this.#commandFiles.set(`${shell.executable}\u0000${command}`, file),
    );
    let offset = 0;
    const named = names.map((list) => {
      const command = found.slice(offset, offset + list.length).find(Boolean);
      offset += list.length;
      return command;
    });
    const commands = await Promise.all(
      definitions.map((definition, index) =>
        definition.commandLine
          ? this.#resolve(definition, shell)
          : named[index],
      ),
    );
    this.#resolved.set(
      shell.executable,
      new Map(
        definitions.flatMap((definition, index) =>
          commands[index] ? [[definition.id, commands[index]!]] : [],
        ),
      ),
    );
    const detected = await Promise.all(
      definitions.map(async (definition, index) => {
        const command = commands[index];
        const info = definitionInfo(definition);
        // The AI agents screen edits the definition in use. Only a user's
        // definition is made from the name and command fields; a bundled
        // one with a command line (Kiro CLI) is edited as JSON.
        const simple = info?.source === "user" && simpleFields(info.file);
        const edit = info && {
          ...(definition.icon ? { icon: definition.icon } : {}),
          ...(definition.customIcon ? { customIcon: true } : {}),
          source: info.source,
          definition: info.text,
          ...(simple ? { simple } : {}),
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
                hidden: this.#store.cliHidden(definition.id),
                support: cliSupport(definition, undefined),
              }
            : undefined;
        const cached = await this.#probeVersion(definition.id, shell, command);
        if (refreshUsage || !this.usage.has(definition.id))
          this.#usageRefresh.get(definition.id)?.();
        if (
          definition.usageMonitor &&
          !this.#usageMonitors.has(definition.id)
        ) {
          const controller = new AbortController();
          this.#usageMonitors.set(definition.id, controller);
          definition
            .usageMonitor(
              shell,
              command,
              AbortSignal.any([controller.signal, this.#controller.signal]),
              (usage) => {
                if (usage) usage = { ...usage, observedAt: Date.now() };
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
            )
            .catch(() => {})
            .finally(() => {
              this.#usageMonitors.delete(definition.id);
            });
        }
        if (this.#store.openedClis().includes(definition.id))
          this.#prepareHooks(definition.id, shell, command);
        const {
          usageMonitor: _usageMonitor,
          modelCatalog: _modelCatalog,
          session: _session,
          resumeWithInputArguments: _resumeWithInputArguments,
          resumeWithTeamPrompt: _resumeWithTeamPrompt,
          resumeArguments: _resumeArguments,
          command: _command,
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
          hidden: this.#store.cliHidden(definition.id),
          support: cliSupport(definition, cached.version),
          supportsUsage: !!definition.supportsUsage,
          // A command line made from the name and command is edited itself.
          ...(commandLine
            ? {}
            : {
                startupArguments: this.#store.cliStartupArguments(
                  definition.id,
                ),
              }),
          ...(this.usage.has(definition.id)
            ? { usage: this.usage.get(definition.id) }
            : {}),
          ...(cached.version ? { version: cached.version } : {}),
        };
      }),
    );
    const order = this.#store.cliOrder();
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
        ...(this.#store.lastUsedCli()
          ? { lastUsedId: this.#store.lastUsedCli() }
          : {}),
        ...(failed.length ? { failed } : {}),
      },
    };
  }

  /** Check a definition received as JSON and say what saving it does
   * (cli-definitions.md「確認」). `id` is the definition being edited. */
  async checkDefinition(
    text: string,
    shell: ShellDefinition,
    id?: string,
    files?: CliDefinitionAttachment[],
    owner = "",
  ): Promise<Response<CliDefinitionResults["cli.definition.check"]>> {
    if (this.#definitionsRoot) await loadCliDefinitions(this.#definitionsRoot);
    const read = readDefinitionText(text, id ?? this.#ownId(text));
    if ("reason" in read) return { ok: true, result: { reason: read.reason } };
    const { definition } = read;
    const prepared = await this.#prepareFiles(definition, files, owner);
    if ("reason" in prepared || "missing" in prepared)
      return { ok: true, result: prepared };
    const folder = join(
      this.#definitionsRoot!,
      "cli-definitions",
      definition.id,
    );
    const added = new Set(prepared.files.map((entry) => entry.name));
    const builtin = bundledDefinition(definition.id);
    const info = builtin && definitionInfo(builtin);
    for (const name of attachedFiles(definition)) {
      if (added.has(name)) continue;
      for (const source of [folder, ...(info ? [info.folder] : [])]) {
        try {
          if ((await stat(await definitionFilePath(source, name))).isFile()) {
            added.add(name);
            break;
          }
        } catch (error) {
          if (error instanceof DefinitionAttachmentError) break;
          if (
            !["ENOENT", "ENOTDIR"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
        }
      }
    }
    const effects = definitionEffects(
      definition,
      shell,
      homedir(),
      writesDefinitionHooks(definition),
      [...added],
    );
    const previous = cliDefinitions.find((entry) => entry.id === definition.id);
    const previousInfo = previous && definitionInfo(previous);
    const withoutIcon = (value: Record<string, unknown>) => {
      const { icon: _icon, ...rest } = value;
      return rest;
    };
    const iconOnly =
      previousInfo &&
      prepared.files.every(
        (entry) =>
          entry.name === definition.icon?.light ||
          entry.name === definition.icon?.dark,
      ) &&
      isDeepStrictEqual(
        withoutIcon(JSON.parse(previousInfo.text)),
        withoutIcon(JSON.parse(text)),
      );
    return {
      ok: true,
      result: {
        summary: {
          id: definition.id,
          name: definition.name,
          replaces:
            userDefinitionFolders().includes(definition.id) ||
            isBundledDefinition(definition.id),
          overrides: isBundledDefinition(definition.id),
          ...effects,
          requiresConfirmation:
            ((!id || !userDefinitionFolders().includes(id)) &&
              (userDefinitionFolders().includes(definition.id) ||
                isBundledDefinition(definition.id))) ||
            (!iconOnly &&
              !!(
                effects.commands.length ||
                effects.settings.length ||
                effects.files.length
              )),
        },
      },
    };
  }
  /** The `id` that a definition added as JSON gives its folder. */
  #ownId(text: string): string {
    try {
      const value: unknown = JSON.parse(text);
      const id =
        value && typeof value === "object"
          ? (value as Record<string, unknown>).id
          : undefined;
      return typeof id === "string" ? id : "";
    } catch {
      return "";
    }
  }
  /** `change` returns undefined for a request that names no definition. */
  #definitionChange<T>(
    context: StoreContext,
    change: () => Promise<T | undefined>,
  ): Promise<Response<T>> {
    const next = this.#definitionChanges.then(
      async (): Promise<Response<T>> => {
        const previous = this.#store.terminalOperationResult<T>(context);
        if (previous) return { ok: true, result: previous };
        if (!this.#definitionsRoot)
          return { ok: false, error: { code: "internal_error" } };
        await loadCliDefinitions(this.#definitionsRoot);
        const result = await change();
        if (result === undefined)
          return { ok: false, error: { code: "invalid_request" } };
        this.#store.saveTerminalOperationResult(context, result);
        return { ok: true, result };
      },
    );
    this.#definitionChanges = next.catch(() => {});
    return next.catch(() => ({
      ok: false,
      error: { code: "internal_error" },
    }));
  }
  /** Save a definition received as JSON in `cli-definitions/<id>/`. */
  saveDefinition(
    context: StoreContext,
    text: string,
    id?: string,
    files?: CliDefinitionAttachment[],
  ): Promise<Response<CliDefinitionResults["cli.definition.save"]>> {
    return this.#definitionChange(context, async () => {
      const read = readDefinitionText(text, id ?? this.#ownId(text));
      if ("reason" in read) return { reason: read.reason };
      const prepared = await this.#prepareFiles(
        read.definition,
        files ?? [],
        context.clientPublicKey,
      );
      if ("reason" in prepared || "missing" in prepared) return prepared;
      await saveUserDefinition(
        this.#definitionsRoot!,
        read.definition.id,
        text,
        prepared.files,
        !id &&
          (userDefinitionFolders().includes(read.definition.id) ||
            isBundledDefinition(read.definition.id))
          ? attachedFiles(read.definition)
          : undefined,
      );
      await this.#uploads?.discard(
        context.clientPublicKey,
        files?.map((file) => file.uploadId) ?? [],
      );
      return { cliId: read.definition.id };
    });
  }
  /** Validate files at the external input boundary, before publishing JSON. */
  async #prepareFiles(
    file: import("./definition-file.ts").DefinitionFile,
    uploads: CliDefinitionAttachment[] | undefined,
    owner: string,
  ): Promise<
    | { files: { name: string; bytes: Buffer }[] }
    | { reason: CliDefinitionReason }
    | { missing: string[] }
  > {
    // Without uploads this is a preview for the editor's missing-file notice.
    // Every save supplies an attachment list, including an empty one.
    if (!uploads) return { files: [] };
    const files: { name: string; bytes: Buffer }[] = [];
    const missing: string[] = [];
    const builtin = bundledDefinition(file.id);
    const bundledInfo = builtin && definitionInfo(builtin);
    for (const name of new Set([
      ...attachedFiles(file),
      ...uploads.map((entry) => entry.name),
    ])) {
      try {
        attached(name, "file");
      } catch {
        return { reason: { kind: "inside", field: "file" } };
      }
      const field =
        file.icon?.light === name
          ? "icon.light"
          : file.icon?.dark === name
            ? "icon.dark"
            : "file";
      let bytes: Buffer | undefined;
      const upload = uploads.find((entry) => entry.name === name);
      try {
        if (upload && this.#uploads)
          bytes = await readFile(this.#uploads.path(owner, upload.uploadId));
        else {
          const folders = [
            join(this.#definitionsRoot!, "cli-definitions", file.id),
            ...(bundledInfo ? [bundledInfo.folder] : []),
          ];
          for (const folder of folders) {
            try {
              bytes = await readFile(await definitionFilePath(folder, name));
              break;
            } catch (error) {
              if (
                (error as NodeJS.ErrnoException).code !== "ENOENT" &&
                (error as NodeJS.ErrnoException).code !== "ENOTDIR"
              )
                throw error;
            }
          }
        }
      } catch (error) {
        if (error instanceof DefinitionAttachmentError)
          return { reason: { kind: "inside", field } };
        if (field.startsWith("icon."))
          return { reason: { kind: "values", field, values: ["SVG", "PNG"] } };
        throw error;
      }
      if (!bytes) {
        missing.push(name);
        continue;
      }
      if (field.startsWith("icon.") && !imageMime(name, bytes))
        return { reason: { kind: "values", field, values: ["SVG", "PNG"] } };
      if (upload) files.push({ name, bytes });
    }
    return missing.length ? { missing } : { files };
  }
  async writeDefinitionFile(
    owner: string,
    params: import("@iori/protocol").CliDefinitionParams["cli.definition.file.write"],
  ) {
    return this.#uploads!.write(
      owner,
      params.uploadId,
      params.data,
      params.first,
    );
  }
  discardDefinitionFiles(owner: string, ids: string[]) {
    return this.#uploads!.discard(owner, ids);
  }
  readIcon(hash: string, offset: number) {
    const image = cliDefinitionImage(hash);
    if (!image) throw new Error("Image not found");
    const bytes = image.bytes.subarray(offset, offset + 1_048_576);
    return {
      bytesBase64: bytes.toString("base64"),
      nextOffset: offset + bytes.length,
      eof: offset + bytes.length >= image.bytes.length,
      mimeType: image.mimeType,
    };
  }
  setIcon(
    context: StoreContext,
    params: import("@iori/protocol").CliDefinitionParams["cli.icon.set"],
  ): Promise<Response<CliDefinitionResults["cli.icon.set"]>> {
    return this.#definitionChange(context, async () => {
      const current = cliDefinitions.find((entry) => entry.id === params.cliId);
      const info = current && definitionInfo(current);
      if (!info) return undefined;
      const value = JSON.parse(info.text);
      const files: { name: string; bytes: Buffer }[] = [];
      if (params.image) {
        let bytes: Buffer;
        try {
          bytes = await readFile(
            this.#uploads!.path(context.clientPublicKey, params.image.uploadId),
          );
        } catch {
          return { invalidImage: true as const };
        }
        const mime = imageMime(params.image.name, bytes);
        if (!mime) return { invalidImage: true as const };
        const name = `icon-${imageHash(bytes)}.${mime === "image/png" ? "png" : "svg"}`;
        value.icon = { light: name };
        files.push({ name, bytes });
      } else {
        const builtin = bundledDefinition(params.cliId);
        if (builtin?.icon) value.icon = builtin.icon;
        else delete value.icon;
      }
      await saveUserDefinition(
        this.#definitionsRoot!,
        params.cliId,
        JSON.stringify(value, null, 2) + "\n",
        files,
      );
      const retained = new Set(
        attachedFiles({ ...info.file, icon: value.icon }),
      );
      for (const old of [info.file.icon?.light, info.file.icon?.dark]) {
        if (
          old &&
          /^icon-[a-f0-9]{64}\.(?:svg|png)$/u.test(old) &&
          !retained.has(old)
        )
          await rm(
            join(this.#definitionsRoot!, "cli-definitions", params.cliId, old),
            { force: true },
          );
      }
      if (params.image)
        await this.#uploads!.discard(context.clientPublicKey, [
          params.image.uploadId,
        ]);
      return { cliId: params.cliId };
    });
  }
  /** Save the minimal definition of the name and command fields. */
  saveSimple(
    context: StoreContext,
    simple: CliSimpleDefinition,
    id?: string,
  ): Promise<Response<CliDefinitionResults["cli.definition.simple"]>> {
    return this.#definitionChange(context, async () => {
      // An edit names a user's definition; its folder stays in place.
      if (id && !isUserDefinition(id)) return undefined;
      const cliId = id ?? idFromName(simple.name);
      if (
        !id &&
        (userDefinitionFolders().includes(cliId) || isBundledDefinition(cliId))
      ) {
        return {
          replacement:
            JSON.stringify(simpleDefinition(simple, cliId), null, 2) + "\n",
        };
      }
      const current = id
        ? cliDefinitions.find((definition) => definition.id === id)
        : undefined;
      // Items written by hand in the user's file are kept.
      const text = current && definitionInfo(current)?.text;
      const previous = text
        ? (JSON.parse(text) as Record<string, unknown>)
        : undefined;
      await saveUserDefinition(
        this.#definitionsRoot!,
        cliId,
        JSON.stringify(simpleDefinition(simple, cliId, previous), null, 2) +
          "\n",
      );
      return { cliId };
    });
  }
  /** Delete a user's definition: a bundled one with the same `id` is used
   * again. Open Terminals of the CLI keep running. */
  removeDefinition(
    context: StoreContext,
    id: string,
  ): Promise<Response<CliDefinitionResults["cli.definition.remove"]>> {
    return this.#definitionChange(context, async () => {
      // Only a folder of `cli-definitions/` is deleted; one already gone
      // stays deleted.
      if (userDefinitionFolders().includes(id))
        await removeUserDefinition(this.#definitionsRoot!, id);
      if (this.#store.lastUsedCli() === id && !isBundledDefinition(id))
        this.#store.forgetLastUsedCli();
      return { cliId: id };
    });
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
      const resolved = await this.#resolve(definition, shell);
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
  /** Draft the model argument of a launch command from its `--help`. */
  async help(
    command: string,
    shell: ShellDefinition,
  ): Promise<Response<{ helpCommand?: string; modelArgument?: string }>> {
    const executable =
      /^(?:&\s+)?(?:'[^']+'|"[^"$`\\]+"|[A-Za-z0-9_.:/\\-]+)/u.exec(
        command.trim(),
      )?.[0];
    if (!executable) return { ok: true, result: {} };
    const helpCommand = executable + " --help";
    const { output, code } = await runInShell(
      shell,
      helpCommand,
      this.#controller.signal,
      undefined,
      true,
    );
    const model =
      code === 0
        ? output.split(/\r?\n/u).flatMap((line) => {
            const long =
              /(?:^|[\s,])(--model)(?:\s+|=)(?:<[^>]+>|\[[^\]]+\]|[A-Z][A-Z_-]*)/u.exec(
                line,
              );
            if (long) return [long[1]!];
            // -m is also commonly a message flag. Only draft it when the help
            // explicitly identifies its argument or description as a model.
            const short =
              /(?:^|[\s,])(-m)\s+(?:<([^>]+)>|\[([^\]]+)\]|([A-Z][A-Z_-]*))(.*)$/u.exec(
                line,
              );
            return short && /model/iu.test(short.slice(2).join(" "))
              ? [short[1]!]
              : [];
          })[0]
        : undefined;
    return {
      ok: true,
      result: model
        ? {
            helpCommand: helpCommand.replace(/^&\s+/u, ""),
            modelArgument: model + " {model}",
          }
        : {},
    };
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
    const resolved =
      this.#resolved.get(shell.executable)?.get(id) ??
      (await this.#resolve(definition, shell));
    if (!resolved) return false;
    const probe = await this.#probeVersion(id, shell, resolved);
    await probe.pending;
    return definition.resumeWithTeamPrompt(probe.version);
  }

  async launch(
    id: string,
    shell: ShellDefinition,
    team?: import("./definitions.ts").TeamLaunch,
    options?: {
      cwd?: string;
      waitForVersion?: boolean;
      arguments?: readonly string[];
      execution?: {
        candidate: import("@iori/protocol").Candidate;
        initial?: string;
        teamFilesDirectory?: string;
      };
      /** The command directory of this CLI's session outside a team. */
      commandDirectory?: string;
    },
  ): Promise<
    | {
        cli: CliSummary;
        command: string;
        hooks?: CliHooks;
        initialInput?: string;
        storedCommand?: string;
        env?: Record<string, string>;
      }
    | undefined
  > {
    const execution =
      team ??
      (options?.execution
        ? {
            ...options.execution,
            instructionFile: "",
            commandDirectory: "",
            commandMailboxDirectory: options.commandDirectory,
            teamFilesDirectory: options.execution.teamFilesDirectory ?? "",
            instructions: "",
          }
        : undefined);
    const definition = cliDefinitions.find((cli) => cli.id === id);
    if (!definition) return undefined;
    const resolved =
      this.#resolved.get(shell.executable)?.get(definition.id) ??
      (await this.#resolve(definition, shell));
    if (!resolved) return undefined;
    const {
      modelCatalog: _modelCatalog,
      session: _session,
      resumeArguments: _resumeArguments,
      resumeWithTeamPrompt: _resumeWithTeamPrompt,
      command: _command,
      hooks,
      launchArguments,
      supportsHooks,
      observedModel: _observedModel,
      teamArguments,
      managedTeamArguments,
      teamEnvironment,
      launchEnvironment,
      teamInput,
      waitForBracketedPaste: _waitForBracketedPaste,
      waitForInputCursor: _waitForInputCursor,
      teamCommandDirectory: _teamCommandDirectory,
      commandPathArguments,
      commandDirectoryArguments,
      aliases: _aliases,
      versionArguments: _versionArguments,
      commandLine,
      ...cli
    } = definition;
    // A command line from the name and command has no startup arguments.
    const savedArguments = commandLine
      ? ""
      : this.#store.cliStartupArguments(id);
    // The user's own setting of the option is kept (linked-agents.md).
    const commandPath =
      !team &&
      commandPathArguments &&
      !startupArgumentsSet(savedArguments, shell, commandPathArguments.option)
        ? commandPathArguments.arguments
        : [];
    const installation = this.#prepareHooks(id, shell, resolved, true);
    const probe = await this.#probeVersion(id, shell, resolved);
    if (execution || options?.waitForVersion || launchEnvironment)
      await probe.pending;
    await installation?.pending;
    const version = probe.version;
    // The session's directory belongs to this launch only, never to the
    // stored command that a resume starts from.
    const session =
      !execution && options?.commandDirectory
        ? (commandDirectoryArguments?.(
            options.commandDirectory,
            savedArguments,
            shell,
            options.cwd,
          ) ?? [])
        : [];
    const args = [
      ...(launchArguments?.(version, Boolean(team)) ?? []),
      ...commandPath,
      ...session,
      ...(execution
        ? (teamArguments?.({
            ...execution,
            cwd: options?.cwd,
            version,
            startupArguments: savedArguments,
            startupShell: shell,
          }) ?? [])
        : []),
    ];
    const resumeArgs = [
      ...(launchArguments?.(version, Boolean(team)) ?? []),
      ...commandPath,
      ...(execution
        ? (teamArguments?.({
            ...execution,
            cwd: options?.cwd,
            version,
            initial: undefined,
            commandMailboxDirectory: undefined,
            teamFilesDirectory: "",
          }) ?? [])
        : []),
    ];
    const userArguments = (args: readonly string[]) =>
      execution
        ? teamStartupArguments(
            savedArguments,
            shell,
            // Without a role, a repeatable option has no team value to protect.
            team
              ? (managedTeamArguments ?? [])
              : (managedTeamArguments ?? []).filter(
                  (option) => option.arity !== "many",
                ),
            args,
          )
        : savedArguments;
    const launchArgs = [...args, ...(options?.arguments ?? [])];
    return {
      cli,
      ...(execution || launchEnvironment
        ? {
            env: {
              ...(execution ? teamEnvironment?.(execution) : {}),
              ...launchEnvironment?.(
                version,
                execution?.candidate.model,
                execution?.candidate.effort,
              ),
            },
          }
        : {}),
      command: await shellCommand(resolved, launchArgs, shell, {
        commandLine: definition.commandLine,
        rawArguments: userArguments(args),
      }),
      // Persist the same CLI expression as before, never resolved Node paths.
      storedCommand: formatShellCommand(
        resolved,
        !team ? resumeArgs : [],
        shell,
        {
          commandLine: definition.commandLine,
          rawArguments: userArguments(resumeArgs),
          stored: true,
        },
      ),
      ...(execution && teamInput?.(execution) !== undefined
        ? { initialInput: teamInput(execution) }
        : {}),
      hooks:
        installation?.ready && (supportsHooks?.(version) ?? true)
          ? hooks
          : undefined,
    };
  }

  async #probeVersion(id: string, shell: ShellDefinition, command: string) {
    const commandKey = `${shell.executable}\u0000${command}`;
    // Definitions may share a command but not their version arguments.
    const key = `${id}\u0000${commandKey}`;
    const info = await stat(
      this.#commandFiles.get(commandKey) ?? command,
    ).catch(() => undefined);
    const file = info
      ? `${info.mtimeMs}:${info.ctimeMs}:${info.size}:${info.ino}`
      : undefined;
    let cached = this.#versions.get(key);
    if (!cached || cached.file !== file) {
      cached = { file };
      this.#versions.set(key, cached);
    }
    const probe = cached;
    const definition = cliDefinitions.find((cli) => cli.id === id);
    const args = definition?.versionArguments;
    if (
      args &&
      !probe.version &&
      !probe.pending &&
      !this.#controller.signal.aborted
    ) {
      probe.pending = shellCommand(command, args, shell, {
        commandLine: definition?.commandLine,
      })
        .then((script) => runInShell(shell, script, this.#controller.signal))
        .then(({ output, code }) => {
          const version =
            code === 0
              ? output.match(/\bv?(\d+\.\d+[^\s\u001b]*)/u)?.[1]
              : undefined;
          if (
            !version ||
            this.#controller.signal.aborted ||
            this.#versions.get(key) !== probe
          )
            return;
          probe.version = version;
          this.#publish({
            type: "cli.version",
            shell: shell.id,
            cliId: id,
            version,
            ...(definition?.launchEffortForVersion
              ? { launchEffort: definition.launchEffortForVersion(version) }
              : {}),
          });
        })
        .catch(() => {
          /* A missing version does not hide an installed CLI. */
        })
        .finally(() => {
          probe.pending = undefined;
        });
    }
    return probe;
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
      this.#definitionsRoot,
    )
      .then((ctx) => hooks.install(ctx))
      .then(() => {
        installation.ready = !this.#controller.signal.aborted;
      })
      .catch(() => {
        installation.failed = true;
        /* A failed or pending installation leaves this CLI unobserved. */
      });
    return installation;
  }
}
