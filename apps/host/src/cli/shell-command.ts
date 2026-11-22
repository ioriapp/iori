// Startup shell dialects and install directories derived from Orca
// tui-agent-startup-shell.ts and node-cli-command-resolution.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import { access, stat, readFile } from "node:fs/promises";
import { win32 } from "node:path";
import type { ShellDefinition } from "../terminal/platform.ts";
import {
  shellDialect,
  invocation,
  formatShellCommand,
  type ShellCommandOptions,
} from "./shell-quoting.ts";
import { cachedShellCommand, resolveShellCommand } from "./shell-discovery.ts";
export * from "./shell-quoting.ts";
export {
  canResolveLaunchCommand,
  resolveShellCommand,
  resolveShellCommands,
} from "./shell-discovery.ts";
export {
  runInShell,
  runInLoginShell,
  loginEnvironment,
} from "./shell-process.ts";
/** Only the complete, standard Node templates are bypassed. Any extra batch
 * commands (environment setup included) retain their original execution. */
export function readNodeCmdShim(
  source: string,
): { script: string; args: string[] } | undefined {
  const text = source.replaceAll("\r\n", "\n");
  const npm =
    /^@ECHO off\nGOTO start\n:find_dp0\nSET dp0=%~dp0\nEXIT \/b\n:start\nSETLOCAL\nCALL :find_dp0\n\nIF EXIST "%dp0%\\node.exe" \(\n  SET "_prog=%dp0%\\node.exe"\n\) ELSE \(\n  SET "_prog=node"\n\)\n\nendLocal & goto #_undefined_# 2>NUL \|\| title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%" ([^\n]*?) "%dp0%\\([^"\n]+)" %\*\n$/u.exec(
      text,
    );
  const pnpm =
    /^@SETLOCAL\n@IF EXIST "%~dp0%?\\node.exe" \(\n  "%~dp0%?\\node.exe" ([^\n]*?) "%~dp0%?\\([^"\n]+)" %\*\n\) ELSE \(\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\n  node \1 "%~dp0%?\\\2" %\*\n\)\n$/u.exec(
      text,
    );
  const match = npm ?? pnpm;
  if (!match) return undefined;
  // Node shebang flags are ordinary command-line words; batch substitutions
  // or operators make this a template we cannot resolve faithfully.
  const fixed = match[1]!.trim();
  if (/["%&|<>^]/u.test(fixed) || match[2]!.includes("%")) return undefined;
  return { script: match[2]!, args: fixed ? fixed.split(/\s+/u) : [] };
}

/** Resolve npm/pnpm shims for this call, never for a stored resume command. */
export async function shellCommand(
  command: string,
  args: readonly string[],
  shell: ShellDefinition,
  options: ShellCommandOptions = {},
): Promise<string> {
  if (shellDialect(shell) === "posix")
    return formatShellCommand(command, args, shell, options);
  const originalCommand = command;
  const originalOptions = options;
  if (options.commandLine) {
    const first =
      /^(?:&\s+)?(?:'((?:[^']|'')+)'|"([^"$`]+)"|([^\s'";&|]+))(?:\s+(.*))?$/su.exec(
        command,
      );
    if (!first) return formatShellCommand(command, args, shell, options);
    command =
      first[1]?.replace(/(['\u2018\u2019\u201a\u201b])\1/gu, "$1") ??
      first[2] ??
      first[3]!;
    options = {
      rawArguments: [first[4], options.rawArguments].filter(Boolean).join(" "),
    };
  }
  // Shell lookup keeps alias/function precedence; their names have no backing
  // file and must not be replaced by a similarly named npm installation.
  let file: string | undefined;
  let resolved: string | undefined;
  if (
    win32.isAbsolute(command) &&
    (await stat(command).catch(() => undefined))?.isFile()
  ) {
    resolved = command;
    file = command;
  } else {
    const cached = cachedShellCommand(shell, command);
    if (cached) {
      resolved = cached.command;
      file = cached.file;
    } else
      resolved = await resolveShellCommand(
        shell,
        command,
        false,
        (_command, backing) => {
          file = backing;
        },
      );
  }
  if (!resolved && originalOptions.commandLine)
    return formatShellCommand(originalCommand, args, shell, originalOptions);
  const target = resolved ?? command;
  if (resolved && !file)
    return formatShellCommand(invocation(command, shell), args, shell, {
      ...options,
      commandLine: true,
    });
  if (/\.cmd$/iu.test(target)) {
    const shim = await readFile(target, "utf8")
      .then(readNodeCmdShim)
      .catch(() => undefined);
    if (shim) {
      const directory = win32.dirname(target);
      const localNode = win32.join(directory, "node.exe");
      const node = await access(localNode)
        .then(() => localNode)
        .catch(() => cachedShellCommand(shell, "node")?.command);
      if (node && /\.(?:exe|com)$/iu.test(node))
        return formatShellCommand(node, args, shell, {
          ...options,
          prefixArguments: [
            ...shim.args,
            win32.resolve(directory, shim.script),
          ],
        });
    }
  }
  return formatShellCommand(target, args, shell, options);
}

/** Windows startup runs as a shell argument, never as line-editor input. */
export function cliStartup(
  command: string,
  shell: ShellDefinition,
  marker: string,
): string[] | string {
  if (shell.id === "powershell")
    return [
      ...shell.args,
      "-NoExit",
      "-Command",
      `try { ${command} } finally { [Console]::Write(([char]27).ToString() + ']133;D;${marker}' + [char]7) }`,
    ];
  if (shell.id === "cmd")
    return `/s /k "${command} & ${cmdCompletion(marker)}"`;
  return shell.args;
}

/** Resume in the already displayed shell. The hook route was inherited when
 * that shell started, so it never appears in input, output or shell history. */
export function cliResumeCommand(
  command: string,
  shell: ShellDefinition,
  marker: string,
): string {
  if (shell.id === "powershell")
    return `try { ${command} } finally { [Console]::Write(([char]27).ToString() + ']133;D;${marker}' + [char]7) }`;
  if (shell.id === "cmd") return `${command} & ${cmdCompletion(marker)}`;
  return command;
}

// Expansion happens after cmd's line editor, so no literal Escape is typed.
// Both startup and resume use cmd's echo; no helper process is needed.
function cmdCompletion(marker: string): string {
  return `echo(%IORI_ESCAPE%]133;D;${marker}%IORI_BELL%`;
}

/** Login profiles can replace PATH. Prepend the Host-provided command directory
 * after profiles have run, without putting the session secret in shell input. */
export function withCommandPath(
  command: string,
  shell: ShellDefinition,
): string {
  const dialect = shellDialect(shell);
  if (dialect === "powershell")
    return `$env:PATH=$env:IORI_COMMAND_BIN+';'+$env:PATH; ${command}`;
  if (dialect === "cmd")
    return `set "PATH=%IORI_COMMAND_BIN%;%PATH%" & ${command}`;
  // A shell without the variable keeps its PATH as it is.
  return shell.id === "fish"
    ? `test -n "$IORI_COMMAND_BIN"; and set -gx PATH "$IORI_COMMAND_BIN" $PATH; ${command}`
    : `export PATH="\${IORI_COMMAND_BIN:+$IORI_COMMAND_BIN:}$PATH"; ${command}`;
}
