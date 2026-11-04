// Derived from Orca terminal helpers. Copyright (c) 2026 Lovecast Inc.; see ../ORCA-LICENSE.txt for the MIT license.

import type { TerminalOscLinkRange } from "../shared/terminal-osc-link-ranges.ts";

export type TerminalMouseTrackingMode =
  "none" | "x10" | "vt200" | "drag" | "any";

export type TerminalModes = {
  bracketedPaste: boolean;
  mouseTracking: boolean;
  mouseTrackingMode: TerminalMouseTrackingMode;
  sgrMouseMode: boolean;
  sgrMousePixelsMode: boolean;
  applicationCursor: boolean;
  alternateScreen: boolean;
  kittyKeyboardFlags: number;
};

export type TerminalSnapshot = {
  snapshotAnsi: string;
  pendingEscapeTailAnsi?: string;
  scrollbackAnsi: string;
  oscLinks?: TerminalOscLinkRange[];
  rehydrateSequences: string;
  frameRestoreAnsi?: string;
  cwd: string | null;
  modes: TerminalModes;
  cols: number;
  rows: number;
  scrollbackLines: number;
  lastTitle?: string;
};
