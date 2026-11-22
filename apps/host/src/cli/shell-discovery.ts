// Startup shell dialects and install directories derived from Orca
// tui-agent-startup-shell.ts and node-cli-command-resolution.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ./ORCA-LICENSE.txt.
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, extname, win32, isAbsolute } from "node:path";
import { isWindowsHost, type ShellDefinition } from "../terminal/platform.ts";
import { quoteShell, shellDialect } from "./shell-quoting.ts";
import { runInShell } from "./shell-process.ts";

type ResolvedShellCommand = {
  command: string | undefined;
  file: string | undefined;
};
const shellResolutions = new Map<string, Map<string, ResolvedShellCommand>>();

export const cachedShellCommand = (shell: ShellDefinition, name: string) =>
  shellResolutions.get(shell.executable)?.get(name);
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
