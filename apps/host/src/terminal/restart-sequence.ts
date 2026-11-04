import type { TerminalSnapshot } from "@iori/protocol";
import { buildProcessBoundaryGround } from "./shared/terminal-mode-reset-profiles.ts";

export function buildTerminalRestartRecoverySequence(
  snapshot: Pick<TerminalSnapshot, "modes">,
  separatorText: string,
): string {
  const modeReset = buildProcessBoundaryGround({
    keepFocusReporting: false,
    leaveAlternateScreen: snapshot.modes.alternateScreen,
  });
  return `${modeReset}\r\n${separatorText}\r\n\r\n`;
}

export function buildFreshShellViewportBlankingSequence(
  viewportRows: number,
  cursorRow: number,
): string {
  const rowsToPush = Math.max(1, Math.floor(cursorRow) + 1);
  const bottomRow = Math.max(
    1,
    Math.floor(Number.isFinite(viewportRows) ? viewportRows : 24),
  );
  // New ConPTY output can paint at absolute screen coordinates. Scroll restored
  // rows into history through the row after the restart separator, avoiding a
  // viewport of blank rows beneath it.
  return `\x1b[?6l\x1b[r\x1b[${bottomRow};1H${"\r\n".repeat(rowsToPush)}\x1b[H`;
}
