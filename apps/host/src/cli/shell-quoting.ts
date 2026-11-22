// Startup shell dialects and install directories derived from Orca
// tui-agent-startup-shell.ts and node-cli-command-resolution.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import { win32 } from "node:path";
import type { ShellDefinition } from "../terminal/platform.ts";
export function shellDialect(
  shell: ShellDefinition,
): "posix" | "powershell" | "cmd" {
  return shell.id === "powershell"
    ? "powershell"
    : shell.id === "cmd"
      ? "cmd"
      : "posix";
}
export function quoteShell(value: string, shell: ShellDefinition): string {
  const dialect = shellDialect(shell);
  return dialect === "cmd"
    ? `"${value.replaceAll('"', '""')}"`
    : dialect === "powershell"
      ? `'${value.replace(/['\u2018\u2019\u201a\u201b]/gu, "$&$&")}'`
      : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Quote one argv item for the Windows C runtime, including empty items and
 * backslashes immediately before quotes or the closing delimiter. */
export function quoteWindowsArgument(value: string): string {
  return (
    '"' + value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, "$1$1") + '"'
  );
}

/** cross-spawn's cmd meta-character protection, after CRT quoting. A batch's
 * %* is parsed again and therefore needs a second layer. */
export function quoteCmdArgument(value: string, batch = false): string {
  const escape = (word: string) =>
    word.replace(/([()[\]%!^"`<>&|;, *?])/gu, "^$1");
  const quoted = escape(quoteWindowsArgument(value));
  return batch ? escape(quoted) : quoted;
}

/** Values containing line breaks remain one line of PSReadLine input. */
function powerShellArgument(value: string, shell: ShellDefinition): string {
  return /[\r\n]/u.test(value)
    ? `([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(value, "utf16le").toString("base64")}')))`
    : quoteShell(value, shell);
}

export type ShellCommandOptions = {
  /** The command is already a user-authored shell expression. */
  commandLine?: boolean;
  /** Persist the original CLI expression, without a runtime wrapper. */
  stored?: boolean;
  prefixArguments?: readonly string[];
  /** A user-authored suffix stays in the user's shell syntax. */
  rawArguments?: string;
};

/** Render generated argv only at the final call boundary. PowerShell's native
 * preference is scoped to this invocation, leaving the user's shell intact. */
export function formatShellCommand(
  command: string,
  args: readonly string[],
  shell: ShellDefinition,
  options: ShellCommandOptions = {},
): string {
  const dialect = shellDialect(shell);
  const call = options.commandLine ? command : invocation(command, shell);
  const raw = options.rawArguments ? " " + options.rawArguments : "";
  const words = (quote: (arg: string) => string) =>
    args.length ? " " + args.map(quote).join(" ") : "";
  if (dialect === "posix" || options.stored)
    return call + raw + words((arg) => quoteShell(arg, shell));
  const prefix = (quote: (arg: string) => string) =>
    options.prefixArguments?.length
      ? " " + options.prefixArguments.map(quote).join(" ")
      : "";
  const batch = !options.commandLine && /\.(?:cmd|bat)$/iu.test(command);
  if (dialect === "cmd") {
    // A child cmd completes a batch before returning to the Terminal marker.
    const native =
      (options.commandLine ? `call ${command}` : quoteCmdArgument(command)) +
      prefix((arg) => quoteCmdArgument(arg, batch)) +
      raw +
      words((arg) => quoteCmdArgument(arg, batch));
    return batch ? `cmd.exe /d /s /c "${native}"` : native;
  }
  if (batch)
    return legacyNativeInvocation(
      call + raw,
      args.map((arg) => quoteCmdArgument(arg, true)).join(" "),
      shell,
    );
  if (!options.commandLine && /\.(?:exe|com)$/iu.test(command)) {
    if (win32.basename(shell.executable).toLowerCase() === "powershell.exe")
      return legacyNativeInvocation(
        call +
          prefix((arg) =>
            powerShellArgument(quoteWindowsArgument(arg), shell),
          ) +
          raw,
        args.map(quoteWindowsArgument).join(" "),
        shell,
      );
    const standard =
      call +
      prefix((arg) => powerShellArgument(arg, shell)) +
      raw +
      words((arg) => powerShellArgument(arg, shell));
    return `& { $PSNativeCommandArgumentPassing='Standard'; ${standard} }`;
  }
  return (
    call +
    prefix((arg) => powerShellArgument(arg, shell)) +
    raw +
    words((arg) => powerShellArgument(arg, shell))
  );
}

/** Stop parsing bypasses 5.1's extra quote insertion. The environment expands
 * once, after parsing: embedded %, quotes and CR/LF are not shell syntax.
 * A newline terminates --% before the finally block; the temporary variable
 * is restored even when invocation fails. */
function legacyNativeInvocation(
  call: string,
  argumentsLine: string,
  shell: ShellDefinition,
): string {
  if (!argumentsLine) return call;
  const script = `${call} --% %IORI_NATIVE_ARGUMENTS%\n`;
  const invoke = `& ([ScriptBlock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(script, "utf16le").toString("base64")}'))))`;
  // Keep generated values out of the encoded script so long instructions do
  // not expand with UTF-16/base64. Only the stop-parsing invocation is encoded.
  return `& { $ioriPreviousNativeArguments=[Environment]::GetEnvironmentVariable('IORI_NATIVE_ARGUMENTS'); try { $PSNativeCommandArgumentPassing='Legacy'; $env:IORI_NATIVE_ARGUMENTS=${powerShellArgument(argumentsLine, shell)}; ${invoke} } finally { [Environment]::SetEnvironmentVariable('IORI_NATIVE_ARGUMENTS',$ioriPreviousNativeArguments) } }`;
}
export function invocation(command: string, shell: ShellDefinition): string {
  const quoted =
    shellDialect(shell) === "posix" && /^[a-zA-Z0-9_-]+$/u.test(command)
      ? command
      : quoteShell(command, shell);
  return shellDialect(shell) === "powershell" ? `& ${quoted}` : quoted;
}
