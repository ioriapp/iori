// Startup shell dialects and install directories derived from Orca
// tui-agent-startup-shell.ts and node-cli-command-resolution.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { access, stat, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, extname, win32, isAbsolute } from "node:path";
import { isWindowsHost, type ShellDefinition } from "../terminal/platform.ts";
import { readWindowsLoginEnvironment } from "./windows-login-environment.ts";

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

type ResolvedShellCommand = {
  command: string | undefined;
  file: string | undefined;
};
const shellResolutions = new Map<string, Map<string, ResolvedShellCommand>>();

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
    const cached = shellResolutions.get(shell.executable)?.get(command);
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
        .catch(
          () => shellResolutions.get(shell.executable)?.get("node")?.command,
        );
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

/** Profiles and aliases are evaluated by the user's own shell. No deadline
 * declares a slow profile or version probe to have failed. */
export function runInShell(
  shell: ShellDefinition,
  script: string,
  signal?: AbortSignal,
  exchange?: {
    start: (send: (line: string) => void, end: () => void) => void;
    data: (chunk: string) => void;
  },
  completeOutput = false,
  environment?: Record<string, string>,
): Promise<{ output: string; stderr: string; code: number | null }> {
  return runInShellEnvironment(
    shell,
    script,
    { ...process.env, ...environment },
    signal,
    exchange,
    completeOutput,
  );
}
/** The variables that a login shell needs to start. A definition's script does
 * not receive the Host's other variables: no keys, Forge tokens or team
 * secrets (docs/design/cli-definitions.md「環境変数」). */
const loginVariables = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "SystemRoot",
  "SystemDrive",
  "ComSpec",
  "PATHEXT",
  "WINDIR",
  "USERNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
];
export function loginEnvironment(): Record<string, string> {
  const kept = new Set(loginVariables.map((name) => name.toUpperCase()));
  const names = new Set<string>();
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const key = name.toUpperCase();
    if (value === undefined || names.has(key)) continue;
    if (!kept.has(key) && !key.startsWith("LC_")) continue;
    names.add(key);
    environment[name] = value;
  }
  return environment;
}
/** Run a definition's script (or command) in the user's login shell, with the
 * login environment and the input written to stdin before it is closed. */
export async function runInLoginShell(
  shell: ShellDefinition,
  script: string,
  input: string,
  signal?: AbortSignal,
): Promise<{ output: string; stderr: string; code: number | null }> {
  return runInShellEnvironment(
    shell,
    script,
    isWindowsHost()
      ? await readWindowsLoginEnvironment(loginEnvironment())
      : loginEnvironment(),
    signal,
    {
      start: (send, end) => {
        send(input.endsWith("\n") ? input.slice(0, -1) : input);
        end();
      },
      data: () => {},
    },
    true,
  );
}
function runInShellEnvironment(
  shell: ShellDefinition,
  script: string,
  environment: Record<string, string | undefined>,
  signal?: AbortSignal,
  exchange?: {
    start: (send: (line: string) => void, end: () => void) => void;
    data: (chunk: string) => void;
  },
  completeOutput = false,
): Promise<{ output: string; stderr: string; code: number | null }> {
  const dialect = shellDialect(shell);
  // POSIX interactive shell warnings stay on fd 2; only the CLI's stderr
  // reaches fd 3. Windows shells keep native stderr on its original pipe.
  if (completeOutput && dialect === "posix")
    script =
      shell.id === "fish"
        ? `begin\n${script}\nend 2>&3`
        : `{ ${script}\n} 2>&3`;
  const args =
    dialect === "powershell"
      ? ["-NoLogo", "-NonInteractive", "-Command", script]
      : dialect === "cmd"
        ? ["/s", "/c", `"${script}"`]
        : ["-l", "-i", "-c", script];
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const child = spawn(shell.executable, args, {
      env: environment,
      cwd: homedir(),
      windowsHide: true,
      stdio:
        completeOutput && dialect === "posix"
          ? [exchange ? "pipe" : "ignore", "pipe", "ignore", "pipe"]
          : [
              exchange ? "pipe" : "ignore",
              "pipe",
              completeOutput ? "pipe" : "ignore",
            ],
      ...(dialect === "cmd" ? { windowsVerbatimArguments: true } : {}),
      ...(signal ? { signal } : {}),
    });
    let output = "";
    let stderr = "";
    const errors = dialect === "posix" ? child.stdio[3] : child.stderr;
    if (errors instanceof Readable) {
      errors.setEncoding("utf8");
      errors.on("data", (data: string) => {
        stderr += data;
      });
    }
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (data: string) => {
      // Model discovery retains complete diagnostics; other dialogues stream only.
      if (!exchange || completeOutput)
        output = completeOutput ? output + data : (output + data).slice(-65536);
      if (exchange && !settled) {
        try {
          exchange.data(data);
        } catch (error) {
          child.stdin?.end();
          fail(error as Error);
        }
      }
    });
    child.stdin?.on("error", fail);
    try {
      exchange?.start(
        (line) => child.stdin?.write(line + "\n"),
        () => child.stdin?.end(),
      );
    } catch (error) {
      fail(error as Error);
    }
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ output, stderr, code });
    });
  });
}

async function installPath(
  command: string,
  extensions: string[],
): Promise<string | undefined> {
  const home = homedir();
  const directories = [
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".fnm", "aliases", "default", "bin"),
    join(home, ".local", "share", "mise", "shims"),
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".yarn", "bin"),
    ...(isWindowsHost()
      ? [
          join(home, "AppData", "Roaming", "npm"),
          join(home, "AppData", "Local", "pnpm"),
          join(home, "AppData", "Local", "Yarn", "bin"),
        ]
      : [join(home, ".local", "share", "pnpm"), join(home, "Library", "pnpm")]),
  ];
  const names = isWindowsHost()
    ? extname(command)
      ? [command]
      : extensions.map((ext) => command + ext)
    : [command];
  for (const directory of directories)
    for (const name of names) {
      const path = join(directory, name);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, isWindowsHost() ? constants.F_OK : constants.X_OK);
        return path;
      } catch {
        /* This candidate is absent; keep searching install directories. */
      }
    }
  return undefined;
}

/** Resolve all names inside one profile-aware shell. PATH and PATHEXT come
 * from that shell, rather than an environment copied into the Terminal.
 * Report backing files separately so aliases/functions keep their invocation.
 * Windows resolves Node in this same shell and refreshes the cached names here,
 * so execution never starts another profile just to resolve a shim's Node. */
export async function resolveShellCommands(
  shell: ShellDefinition,
  commands: string[],
  fallback = false,
  onResolvedFile?: (command: string, file: string | undefined) => void,
): Promise<(string | undefined)[]> {
  const dialect = shellDialect(shell);
  const requestedCount = commands.length;
  if (dialect !== "posix" && !commands.includes("node"))
    commands = [...commands, "node"];
  const resolvedNames = new Map<string, ResolvedShellCommand>();
  const prefix = "IORI_CLI_PATH_";
  const extensionsMarker = "IORI_CLI_EXTENSIONS:";
  const probes = commands.map((command, index) => {
    const quoted = quoteShell(command, shell);
    const marker = `${prefix}${index}:`;
    if (dialect === "powershell")
      return `$c=Get-Command ${quoted} -ErrorAction SilentlyContinue; if ($c -and $c.CommandType -in @('Alias','Function','Filter')) { [Console]::WriteLine('${marker}' + ${quoted}) } else { $found=$null; $name=${quoted}; $ext=[IO.Path]::GetExtension($name); $suffixes=if ($ext) { @('') } else { $env:PATHEXT -split ';' }; $dirs=if ([IO.Path]::IsPathRooted($name)) { @('') } else { $env:PATH -split ';' }; foreach ($dir in $dirs) { foreach ($suffix in $suffixes) { if (-not $suffix -and -not $ext) { continue }; $p=if ($dir) { Join-Path $dir.Trim('"') ($name+$suffix) } else { $name+$suffix }; if (Test-Path -LiteralPath $p -PathType Leaf) { $found=$p; break } }; if ($found) { break } }; if ($found) { [Console]::WriteLine('${marker}'+$found) } }`;
    if (dialect === "cmd") {
      // where accepts directory:pattern, rather than a full file path.
      const pattern = /[\\/]/u.test(command)
        ? `${win32.dirname(command)}:${win32.basename(command)}`
        : command;
      // Bound each FOR body before chaining probes: an absent first command
      // must not skip the following commands in cmd's same-line DO body.
      return `(for /f "delims=" %P in ('where ${quoteShell(pattern, shell)} 2^>nul') do @echo ${marker}%P)`;
    }
    return shell.id === "fish"
      ? `if type -q ${quoted}; printf '${marker}%s\\n' (type -p ${quoted}); end`
      : `if command -v ${quoted} >/dev/null 2>&1; then printf '${marker}%s\\n' \"$(command -v ${quoted})\"; fi`;
  });
  const extensionProbe =
    dialect === "powershell"
      ? `[Console]::WriteLine('${extensionsMarker}'+$env:PATHEXT)`
      : dialect === "cmd"
        ? `echo ${extensionsMarker}%PATHEXT%`
        : "";
  const script = [extensionProbe, ...probes]
    .filter(Boolean)
    .join(dialect === "cmd" ? " & " : "; ");
  const { output } = await runInShell(shell, script);
  const lines = output.split(/\r?\n/u);
  const extensions = (
    lines
      .find((line) => line.startsWith(extensionsMarker))
      ?.slice(extensionsMarker.length) || ".EXE;.CMD;.BAT;.COM"
  )
    .split(";")
    .filter(Boolean);
  const results = await Promise.all(
    commands.map(async (command, index) => {
      const marker = `${prefix}${index}:`;
      const candidates = lines
        .filter((line) => line.startsWith(marker))
        .map((line) => line.slice(marker.length).trim());
      const found =
        dialect === "posix"
          ? candidates.length
            ? command
            : undefined
          : candidates.find(
              (path) =>
                extensions.some((ext) =>
                  path.toLowerCase().endsWith(ext.toLowerCase()),
                ) ||
                (dialect === "powershell" && path === command),
            );
      const resolved =
        found ??
        (fallback ? await installPath(command, extensions) : undefined);
      const path = candidates.find((candidate) =>
        isWindowsHost() ? win32.isAbsolute(candidate) : isAbsolute(candidate),
      );
      const file =
        path ??
        (resolved &&
        (isWindowsHost() ? win32.isAbsolute(resolved) : isAbsolute(resolved))
          ? resolved
          : undefined);
      resolvedNames.set(command, { command: resolved, file });
      if (index < requestedCount) onResolvedFile?.(command, file);
      return resolved;
    }),
  );
  if (dialect !== "posix") {
    const cached =
      shellResolutions.get(shell.executable) ??
      new Map<string, ResolvedShellCommand>();
    for (const [name, resolution] of resolvedNames)
      cached.set(name, resolution);
    shellResolutions.set(shell.executable, cached);
  }
  return results.slice(0, requestedCount);
}

export async function resolveShellCommand(
  shell: ShellDefinition,
  command: string,
  fallback = false,
  onResolvedFile?: (command: string, file: string | undefined) => void,
): Promise<string | undefined> {
  return (
    await resolveShellCommands(shell, [command], fallback, onResolvedFile)
  )[0];
}

export function invocation(command: string, shell: ShellDefinition): string {
  const quoted =
    shellDialect(shell) === "posix" && /^[a-zA-Z0-9_-]+$/u.test(command)
      ? command
      : quoteShell(command, shell);
  return shellDialect(shell) === "powershell" ? `& ${quoted}` : quoted;
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

/** Saving checks only forms that can be resolved without executing the command
 * or any substitutions. The shell remains the authority for all other forms. */
export async function canResolveLaunchCommand(
  shell: ShellDefinition,
  command: string,
): Promise<boolean> {
  let source = command.trim();
  let assignments = "";
  if (shellDialect(shell) === "posix" && shell.id !== "fish") {
    const assignment =
      /^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"$`\\]*"|[^\s;|&<>()$`\\'"]+)\s+/u;
    for (
      let match = assignment.exec(source);
      match;
      match = assignment.exec(source)
    ) {
      assignments += match[0];
      source = source.slice(match[0].length);
    }
  }
  const first =
    /^(?:&\s+)?(?:'([^']+)'|"([^"$`\\]+)"|([A-Za-z0-9_.:/\\-]+))(?:\s|$)/u.exec(
      source,
    );
  const executable = first?.[1] ?? first?.[2] ?? first?.[3];
  if (!executable || /[$`\r\n]/u.test(executable) || /[;|&<>()]/u.test(source))
    return true;
  if (/[\\/]/u.test(executable)) return true;
  if (!assignments)
    return Boolean(await resolveShellCommand(shell, executable));
  const quoted = quoteShell(executable, shell);
  const { output } = await runInShell(
    shell,
    `${assignments}command -v ${quoted} >/dev/null 2>&1 && printf 'IORI_COMMAND_FOUND\\n'`,
  );
  return output.split(/\r?\n/u).includes("IORI_COMMAND_FOUND");
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
