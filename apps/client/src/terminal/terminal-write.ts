import type { Terminal } from "@xterm/xterm";

export function writeTerminal(terminal: Terminal, data: string) {
  // A new CLI can have an empty snapshot. xterm's resize flush drops an empty
  // queued write without its callback, leaving restoration (and ack) pending.
  if (data.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => terminal.write(data, resolve));
}
