// Derived from Orca terminal helpers. Copyright (c) 2026 Lovecast Inc.; see ../ORCA-LICENSE.txt for the MIT license.

import type { Terminal } from "@xterm/headless";
import { readTerminalMouseEncoding } from "../shared/terminal-mouse-encoding.ts";
import type { TerminalModes } from "./types.ts";

import { kittyKeyboardFlags } from "./xterm-adapter.ts";

/** Mode state a snapshot must carry so a restored pane behaves like the live one. */
export function readTerminalModes(terminal: Terminal): TerminalModes {
  const buffer = terminal.buffer.active;
  const mouseTrackingMode = terminal.modes.mouseTrackingMode;
  const mouseEncoding = readTerminalMouseEncoding(terminal);
  return {
    bracketedPaste: terminal.modes.bracketedPasteMode,
    mouseTracking: mouseTrackingMode !== "none",
    mouseTrackingMode,
    sgrMouseMode: mouseEncoding === "sgr",
    sgrMousePixelsMode: mouseEncoding === "sgr-pixels",
    applicationCursor:
      buffer.type === "normal"
        ? terminal.modes.applicationCursorKeysMode
        : false,
    alternateScreen: buffer.type === "alternate",
    kittyKeyboardFlags: kittyKeyboardFlags(terminal),
  };
}
