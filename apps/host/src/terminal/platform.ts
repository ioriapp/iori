import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { delimiter, basename, join } from "node:path";
import { homedir, platform, release, userInfo } from "node:os";
import type { TerminalWindowsPty } from "@iori/protocol";

export type ShellDefinition = {
  id: string;
  label: string;
  executable: string;
  args: string[];
};

const require = createRequire(import.meta.url);

function shellLabel(id: string): string {
  switch (id) {
    case "bash":
      return "Bash";
    case "zsh":
      return "Zsh";
    case "fish":
      return "Fish";
    case "powershell":
      return "PowerShell";
    case "cmd":
      return "Command Prompt";
    case "git-bash":
      return "Git Bash";
    default:
      return id;
  }
}

async function executableAt(path: string): Promise<boolean> {
  try {
    await access(
      path,
      platform() === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(name: string): Promise<string | undefined> {
  const windows = platform() === "win32";
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const variants =
    windows && !/\.exe$/iu.test(name) ? [name, `${name}.exe`] : [name];
  for (const entry of pathEntries) {
    for (const variant of variants) {
      const candidate = join(entry.replace(/^"|"$/gu, ""), variant);
      if (await executableAt(candidate)) return candidate;
    }
  }
  return undefined;
}

async function discoverWindowsShells(): Promise<{
  shells: ShellDefinition[];
  preferred: string;
}> {
  const candidates: ShellDefinition[] = [];
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const pwsh = await findOnPath("pwsh.exe");
  const windowsPowerShellPath = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const windowsPowerShell =
    (await findOnPath("powershell.exe")) ??
    ((await executableAt(windowsPowerShellPath))
      ? windowsPowerShellPath
      : undefined);
  const cmdPath = join(systemRoot, "System32", "cmd.exe");
  const cmd =
    (await findOnPath("cmd.exe")) ??
    ((await executableAt(cmdPath)) ? cmdPath : undefined);
  const pathBash = await findOnPath("bash.exe");
  const pathGitBash =
    pathBash && /[\\/]Git[\\/]/iu.test(pathBash) ? pathBash : undefined;
  const gitBashCandidates = [
    ...(pathGitBash ? [pathGitBash] : []),
    join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Git",
      "bin",
      "bash.exe",
    ),
    ...(process.env.LOCALAPPDATA
      ? [join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe")]
      : []),
  ];
  let gitBash: string | undefined;
  for (const candidate of gitBashCandidates) {
    if (await executableAt(candidate)) {
      gitBash = candidate;
      break;
    }
  }

  if (pwsh ?? windowsPowerShell) {
    candidates.push({
      id: "powershell",
      label: shellLabel("powershell"),
      executable: pwsh ?? windowsPowerShell!,
      args: ["-NoLogo"],
    });
  }
  if (cmd) {
    candidates.push({
      id: "cmd",
      label: shellLabel("cmd"),
      executable: cmd,
      args: [],
    });
  }
  if (gitBash) {
    candidates.push({
      id: "git-bash",
      label: shellLabel("git-bash"),
      executable: gitBash,
      args: ["--login", "-i"],
    });
  }
  return { shells: candidates, preferred: candidates[0]?.id ?? "" };
}

async function discoverPosixShells(): Promise<{
  shells: ShellDefinition[];
  preferred: string;
}> {
  const loginShell = userInfo().shell;
  const candidates: ShellDefinition[] = [];
  for (const id of ["bash", "zsh", "fish", "sh", "dash"] as const) {
    const executable =
      (loginShell &&
      basename(loginShell) === id &&
      (await executableAt(loginShell))
        ? loginShell
        : undefined) ?? (await findOnPath(id));
    if (!executable) continue;
    candidates.push({
      id,
      label: shellLabel(id),
      executable,
      args: ["-l"],
    });
  }

  if (
    loginShell &&
    !(await candidates.some((shell) => shell.executable === loginShell))
  ) {
    const executable = (await executableAt(loginShell))
      ? loginShell
      : undefined;
    if (executable) {
      const label = basename(executable) || executable;
      candidates.unshift({
        id: "login-shell",
        label,
        executable,
        args: ["-l"],
      });
    }
  }

  const loginShellId = candidates.find(
    (shell) => shell.executable === loginShell,
  )?.id;
  const preferred =
    loginShellId ??
    candidates.find((shell) => shell.id === "bash")?.id ??
    candidates[0]?.id ??
    "";
  return { shells: candidates, preferred };
}

export async function discoverShells(): Promise<{
  shells: ShellDefinition[];
  preferred: string;
}> {
  return platform() === "win32"
    ? discoverWindowsShells()
    : discoverPosixShells();
}

export function getHomeDirectory(): string {
  return homedir();
}

export function isWindowsHost(): boolean {
  return platform() === "win32";
}

/**
 * Windows names environment variables case-insensitively and a process uses
 * the first of `Path` and `PATH`, so one of each name is kept, the later. Its
 * `Path` is the Host's current one, after the `iori` command's location when
 * the Terminal has it: the Terminal daemon's own Path can be older.
 */
export function ptyEnvironment(
  env: Record<string, string | undefined>,
  commandBin?: string,
): Record<string, string | undefined> {
  if (!isWindowsHost()) return env;
  const names = new Map<string, string>();
  for (const name of Object.keys(env)) names.set(name.toUpperCase(), name);
  const result = Object.fromEntries(
    Object.entries(env).filter(
      ([name]) => names.get(name.toUpperCase()) === name,
    ),
  );
  const path = process.env.PATH ?? "";
  result[names.get("PATH") ?? "Path"] = commandBin
    ? `${commandBin};${path}`
    : path;
  return result;
}

// Derived from Orca terminal helpers and PTY setup.
// Copyright (c) 2026 Lovecast Inc.; see ./ORCA-LICENSE.txt for the MIT license.
export function getWindowsPtyCompatibility(): TerminalWindowsPty | undefined {
  if (!isWindowsHost()) return undefined;
  const buildNumber = parseWindowsBuildNumber(release());
  return {
    // node-pty's default backend selection uses the same build boundary.
    backend:
      buildNumber !== undefined && buildNumber >= 18_309 ? "conpty" : "winpty",
    ...(buildNumber === undefined ? {} : { buildNumber }),
  };
}

// Orca selects the bundled ConPTY on Windows because its wrap markers match
// xterm's expectations. node-pty ships this DLL and routes its lifecycle calls
// through it when this option is enabled.
export function getWindowsPtySpawnOptions(): { useConptyDll: true } | {} {
  return isWindowsHost() ? { useConptyDll: true } : {};
}

function parseWindowsBuildNumber(osRelease: string): number | undefined {
  const build = /(\d+)\.(\d+)\.(\d+)/u.exec(osRelease)?.[3];
  if (!build) return undefined;
  const parsed = Number.parseInt(build, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
