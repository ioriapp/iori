// Derived from Orca terminal helpers.
// Copyright (c) 2026 Lovecast Inc.; see ../../third-party/ORCA-MIT-LICENSE.txt for the MIT license.

const TERMINAL_IME_OWNED_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "PageDown",
  "PageUp",
]);

type TerminalImeKeyboardEvent = Pick<
  KeyboardEvent,
  "type" | "key" | "keyCode" | "isComposing"
>;

export function isWindowsTerminalImeEvent(
  event: TerminalImeKeyboardEvent,
  isWindows: boolean,
  compositionActive: boolean,
) {
  if (!isWindows || event.type !== "keydown") return false;
  return (
    event.isComposing ||
    event.keyCode === 229 ||
    (compositionActive && TERMINAL_IME_OWNED_KEYS.has(event.key))
  );
}
