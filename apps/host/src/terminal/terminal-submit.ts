/** Match xterm paste newline handling; the runtime sends Enter after redraw. */
export function terminalSubmitPaste(
  text: string,
  bracketedPaste: boolean,
): string {
  const pasted = text.replace(/\r?\n/gu, "\r");
  return bracketedPaste ? `\x1b[200~${pasted}\x1b[201~` : pasted;
}
