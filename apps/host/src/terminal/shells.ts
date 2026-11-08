import { realpath } from "node:fs/promises";
import { platform } from "node:os";
import {
  discoverShells as discoverPlatformShells,
  type ShellDefinition,
} from "./platform.ts";

// Kept apart from platform.ts: the Terminal daemon imports platform.ts, and a
// change there changes the daemon's compatibility fingerprint.

/** A shell, with the ids of other shells that resolve to the same executable. */
export type ShellChoice = ShellDefinition & { aliases?: string[] };

export type ResolvedShellCandidate = {
  shell: ShellDefinition;
  realpath?: string;
};

export function deduplicateShellsByRealPath(
  candidates: readonly ResolvedShellCandidate[],
): ShellChoice[] {
  const shells: ShellChoice[] = [];
  const firstByPath = new Map<string, number>();
  for (const candidate of candidates) {
    const existingIndex =
      candidate.realpath === undefined
        ? undefined
        : firstByPath.get(candidate.realpath);
    if (existingIndex !== undefined) {
      const first = shells[existingIndex]!;
      shells[existingIndex] = {
        ...first,
        aliases: [...(first.aliases ?? []), candidate.shell.id],
      };
      continue;
    }
    if (candidate.realpath !== undefined)
      firstByPath.set(candidate.realpath, shells.length);
    shells.push({ ...candidate.shell });
  }
  return shells;
}

export function resolveShell(
  shells: readonly ShellChoice[],
  id: string | undefined,
): ShellChoice | undefined {
  if (!id) return undefined;
  return shells.find((shell) => shell.id === id || shell.aliases?.includes(id));
}

/** The Host's shells, listing one entry per POSIX executable (sh and dash on Debian). */
export async function discoverShells(): Promise<{
  shells: ShellChoice[];
  preferred: string;
}> {
  const discovered = await discoverPlatformShells();
  if (platform() === "win32") return discovered;
  const shells = deduplicateShellsByRealPath(
    await Promise.all(
      discovered.shells.map(async (shell) => {
        try {
          return { shell, realpath: await realpath(shell.executable) };
        } catch {
          return { shell };
        }
      }),
    ),
  );
  return {
    shells,
    preferred:
      resolveShell(shells, discovered.preferred)?.id ?? shells[0]?.id ?? "",
  };
}
