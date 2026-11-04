import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CliSession, CliUsage, TokenUsage } from "@iori/protocol";
import { parseCliUsage } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";
import type { DefinitionScript } from "./definition-file.ts";
import { object } from "./hooks.ts";
import {
  shellCommand,
  quoteShell,
  runInLoginShell,
  shellDialect,
} from "./shell-command.ts";
import { tokenNumber, type SessionTokenReader } from "./session-tokens.ts";
import { monitorUsageCommand, type UsageMonitor } from "./usage.ts";

/** The runs of one definition's scripts wait for each other, so the same
 * conversation or CLI never runs two at once
 * (docs/design/cli-definitions.md「重ならない」). */
const queues = new Map<string, Promise<unknown>>();
function serially<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(key, next);
  void next
    .catch(() => {})
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    });
  return next;
}
/** A script stays inside its definition folder. The command form runs as the
 * words it names, in the user's login shell. */
async function command(
  folder: string,
  script: DefinitionScript,
  shell: ShellDefinition,
): Promise<string> {
  const words =
    "script" in script
      ? [process.execPath, join(folder, script.script)]
      : script.args;
  return shellCommand(quoteShell(words[0]!, shell), words.slice(1), shell, {
    commandLine: true,
  });
}
/** A login shell can print something before the script (a profile's greeting
 * or a warning). As the command lookup does, the shell prints a marker first
 * and only what follows it is read (shell-command.ts「resolveShellCommands」). */
function marked(
  script: string,
  shell: ShellDefinition,
  marker: string,
): string {
  const dialect = shellDialect(shell);
  const mark =
    dialect === "powershell"
      ? `[Console]::WriteLine('${marker}')`
      : dialect === "cmd"
        ? `echo ${marker}`
        : `printf '%s\\n' '${marker}'`;
  return mark + (dialect === "cmd" ? " & " : "; ") + script;
}
/** The JSON that a definition's script wrote to stdout, or nothing when it
 * could not be read. A failed run gives no value; nothing is guessed. */
async function run(
  id: string,
  folder: string,
  script: DefinitionScript,
  input: Record<string, unknown>,
  shell: ShellDefinition,
  signal?: AbortSignal,
): Promise<unknown> {
  const marker = `IORI_CLI_SCRIPT_${randomUUID()}`;
  const { output, code } = await serially(id, async () =>
    runInLoginShell(
      shell,
      marked(await command(folder, script, shell), shell, marker),
      JSON.stringify(input),
      signal,
    ),
  );
  if (code !== 0) {
    console.error(`iori-host cli-definition-script-failed: ${id}`);
    return undefined;
  }
  const at = output.indexOf(marker);
  if (at < 0) {
    console.error(`iori-host cli-definition-script-unreadable: ${id}`);
    return undefined;
  }
  const value = output.slice(at + marker.length).replace(/^\r?\n/u, "");
  // A script that has no value writes nothing.
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value.trim()) as unknown;
  } catch {
    console.error(`iori-host cli-definition-script-unreadable: ${id}`);
    return undefined;
  }
}
/** The conversation's cumulative tokens as the definition's script reports
 * them. `input` and `output` are required; a missing count is not filled in. */
export function tokenUsage(value: unknown): TokenUsage | undefined {
  const record = object(value);
  const input = tokenNumber(record.input);
  const output = tokenNumber(record.output);
  if (input === undefined || output === undefined) return undefined;
  const optional = (field: keyof TokenUsage) => {
    const count = tokenNumber(record[field]);
    return count === undefined ? {} : { [field]: count };
  };
  return {
    input,
    output,
    ...optional("cacheRead"),
    ...optional("cacheWrite"),
    ...optional("reasoning"),
  };
}
/** Tokens asked for when a team child is measured or the Board counts. */
export function scriptSessionTokens(
  id: string,
  folder: string,
  script: DefinitionScript,
): SessionTokenReader {
  return {
    read: async (session: CliSession, shell: ShellDefinition, cwd?: string) =>
      tokenUsage(
        await run(
          id,
          folder,
          script,
          {
            ...(session.id ? { sessionId: session.id } : {}),
            ...(session.file ? { transcript: session.file } : {}),
            ...(cwd ? { cwd } : {}),
          },
          shell,
        ),
      ),
    // A script keeps no state that a conversation leaves behind.
    release: async () => {},
    script: true,
  };
}
/** The windows that a definition's usage script reports, read again when the
 * Host's own usage monitors read theirs. */
export function scriptUsage(
  id: string,
  folder: string,
  script: DefinitionScript,
): UsageMonitor {
  return monitorUsageCommand(
    async (shell, _command, signal): Promise<CliUsage | undefined> =>
      parseCliUsage(await run(id, folder, script, {}, shell, signal)),
  );
}
