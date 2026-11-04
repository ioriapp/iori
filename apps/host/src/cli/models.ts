import type { CliModels } from "@iori/protocol";
import { runInShell } from "./shell-command.ts";
import type { ShellDefinition } from "../terminal/platform.ts";
/** Preserve CLI diagnostics separately from iori's error category. */
export class ModelCommandError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("command_failed");
    this.detail = detail.replace(/\x1b\[[0-9;]*m/gu, "");
  }
}
export type ModelAdapter = (
  shell: ShellDefinition,
  command: string,
  signal: AbortSignal,
) => Promise<CliModels>;
export function plainModels(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}
export async function modelCommand(
  shell: ShellDefinition,
  command: string,
  signal: AbortSignal,
): Promise<string> {
  const { output, stderr, code } = await runInShell(
    shell,
    command,
    signal,
    undefined,
    true,
  );
  if (code !== 0) throw new ModelCommandError(stderr || output);
  return output.replace(/\x1b\[[0-9;]*m/gu, "");
}
/** JSON line dialogue on the same profile-aware shell used for CLI detection. */
export async function modelDialogue(
  shell: ShellDefinition,
  command: string,
  signal: AbortSignal,
  initial: object,
  receive: (
    value: Record<string, unknown>,
    send: (value: object) => void,
    end: () => void,
  ) => void,
  completeOutput = false,
): Promise<{ output: string; stderr: string }> {
  let pending = "";
  let send = (_v: object) => {};
  let end = () => {};
  let failed = false;
  const result = await runInShell(
    shell,
    command,
    signal,
    {
      start(write, finish) {
        send = (value) => write(JSON.stringify(value));
        end = finish;
        send(initial);
      },
      data(chunk) {
        pending += chunk;
        let index;
        while ((index = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, index);
          pending = pending.slice(index + 1);
          let value: Record<string, unknown>;
          try {
            value = JSON.parse(line);
          } catch {
            continue;
          }
          try {
            receive(value, send, end);
          } catch {
            failed = true;
            end();
          }
        }
      },
    },
    completeOutput,
  );
  if (failed) throw new ModelCommandError(result.stderr || result.output);
  return result;
}
