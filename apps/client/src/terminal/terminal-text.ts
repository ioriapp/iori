import type { IBuffer } from "@xterm/xterm";

export type TerminalText = { lines: string[]; selectedLine: number };

/** Snapshot the loaded buffer, joining only xterm's visual wraps. */
export function terminalText(
  buffer: IBuffer,
  rows: number,
  selectedRow: number,
): TerminalText {
  const start = buffer.type === "alternate" ? buffer.viewportY : 0;
  const end = buffer.type === "alternate" ? start + rows : buffer.length;
  const lines: string[] = [];
  let selectedLine = 0;
  for (let row = start; row < end; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
    if (row === selectedRow) selectedLine = lines.length - 1;
  }
  while (lines.at(-1) === "") lines.pop();
  // A press on a dropped blank row selects the last kept line.
  return { lines, selectedLine: Math.min(selectedLine, lines.length - 1) };
}
