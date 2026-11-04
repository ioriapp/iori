import type { Terminal } from "@xterm/xterm";

type TouchScrollEvent = Event & { clientX?: number; clientY?: number };

/** The screen bounds include the mobile desktop-width CSS scale. */
export function terminalRowAtClientY(
  terminal: Terminal,
  clientY: number,
): number {
  const rect = terminal
    .element!.querySelector<HTMLElement>(".xterm-screen")!
    .getBoundingClientRect();
  const row = Math.floor((clientY - rect.top) / (rect.height / terminal.rows));
  return (
    terminal.buffer.active.viewportY +
    Math.max(0, Math.min(row, terminal.rows - 1))
  );
}

/** Keep xterm's inertia reports at the last position of the user's finger. */
export function attachTerminalTouchCoordinates(terminal: Terminal): () => void {
  const element = terminal.element;
  let position: { clientX: number; clientY: number } | undefined;
  const start = () => {
    position = undefined;
  };
  const change = (event: TouchScrollEvent) => {
    if (event.clientX !== undefined && event.clientY !== undefined) {
      position = { clientX: event.clientX, clientY: event.clientY };
    } else if (position) {
      // xterm 6.1 beta's inertia events carry only translation, unlike real
      // touchmove events. Supply viewport coordinates before MouseService
      // converts them to terminal cells.
      // https://github.com/xtermjs/xterm.js/issues/6108
      Object.assign(event, position);
    }
  };
  element?.addEventListener("-xterm-gesturestart", start, true);
  element?.addEventListener("-xterm-gesturechange", change, true);
  return () => {
    element?.removeEventListener("-xterm-gesturestart", start, true);
    element?.removeEventListener("-xterm-gesturechange", change, true);
  };
}
