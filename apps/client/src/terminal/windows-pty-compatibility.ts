// Derived from Orca terminal helpers.
// Copyright (c) 2026 Lovecast Inc.; see ../../third-party/ORCA-MIT-LICENSE.txt for the MIT license.
import type { TerminalWindowsPty } from "@iori/protocol";
import type { ITerminalOptions } from "@xterm/xterm";

/** xterm receives the PTY backend and Windows build reported by its Host. */
export function buildWindowsPtyCompatibilityOptions(
  hostPty: TerminalWindowsPty | undefined,
): Partial<ITerminalOptions> {
  if (!hostPty) return {};
  const windowsPty =
    hostPty.buildNumber === undefined || hostPty.buildNumber < 21_376
      ? { backend: hostPty.backend }
      : hostPty;
  return {
    windowsPty,
    ...(hostPty.backend === "conpty" ? { reflowCursorLine: true } : {}),
  };
}
