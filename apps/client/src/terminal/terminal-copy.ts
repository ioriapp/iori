/** Remove the screen margin shared by all nonblank selected lines. */
export function trimTerminalCopyMargin(
  selection: string,
  startColumn: number | undefined,
): string {
  if (startColumn !== 0) return selection;
  const lines = selection.split("\n");
  let margin = Infinity;
  for (const line of lines) {
    // A Windows row's CR belongs to its line ending, not its content.
    const text = line.endsWith("\r") ? line.slice(0, -1) : line;
    const spaces = text.length - text.replace(/^ */, "").length;
    if (spaces === text.length) continue;
    margin = Math.min(margin, spaces);
  }
  if (!Number.isFinite(margin) || margin === 0) return selection;
  return lines
    .map((line) => line.replace(/^ */, (spaces) => spaces.slice(margin)))
    .join("\n");
}
