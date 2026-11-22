import { stat } from "node:fs/promises";
import type { Event } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";
import { cliDefinitions, type CliDefinition } from "./definitions.ts";
import {
  shellCommand,
  resolveShellCommands,
  runInShell,
  canResolveLaunchCommand,
} from "./shell-command.ts";

export class CliDiscovery {
  readonly #signal: AbortSignal;
  readonly #publish: (event: Event) => void;
  readonly #versions = new Map<
    string,
    { file?: string; version?: string; pending?: Promise<void> }
  >();
  readonly #commandFiles = new Map<string, string | undefined>();
  readonly #resolved = new Map<string, Map<string, string>>();
  constructor(signal: AbortSignal, publish: (event: Event) => void) {
    this.#signal = signal;
    this.#publish = publish;
  }
  #find(shell: ShellDefinition, names: string[]) {
    return resolveShellCommands(shell, names, true, (command, file) =>
      this.#commandFiles.set(`${shell.executable}\u0000${command}`, file),
    );
  }
  /** The first of the CLI's command names that this shell finds. A command
   * line is found as the shell would run it. */
  async resolve(
    definition: CliDefinition,
    shell: ShellDefinition,
    useCached = false,
  ): Promise<string | undefined> {
    const cached =
      useCached && this.#resolved.get(shell.executable)?.get(definition.id);
    if (cached) return cached;
    if (definition.commandLine)
      return (await canResolveLaunchCommand(shell, definition.command))
        ? definition.command
        : undefined;
    const names = [definition.command, ...(definition.aliases ?? [])];
    return (await this.#find(shell, names)).find(Boolean);
  }
  async list(definitions: CliDefinition[], shell: ShellDefinition) {
    const names = definitions.map((definition) =>
      definition.commandLine
        ? []
        : [definition.command, ...(definition.aliases ?? [])],
    );
    const found = await this.#find(shell, names.flat());
    let offset = 0;
    const named = names.map((list) => {
      const command = found.slice(offset, offset + list.length).find(Boolean);
      offset += list.length;
      return command;
    });
    const commands = await Promise.all(
      definitions.map((definition, index) =>
        definition.commandLine ? this.resolve(definition, shell) : named[index],
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
    return commands;
  }
  async probeVersion(id: string, shell: ShellDefinition, command: string) {
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
    if (args && !probe.version && !probe.pending && !this.#signal.aborted) {
      probe.pending = shellCommand(command, args, shell, {
        commandLine: definition?.commandLine,
      })
        .then((script) => runInShell(shell, script, this.#signal))
        .then(({ output, code }) => {
          const version =
            code === 0
              ? output.match(/\bv?(\d+\.\d+[^\s\u001b]*)/u)?.[1]
              : undefined;
          if (
            !version ||
            this.#signal.aborted ||
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
}
