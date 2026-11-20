export function isNonKeyTerminalInput(data: string): boolean {
  // Match one complete mouse or focus report at the current position.
  const report = /\u001b\[(?:<\d+;\d+;\d+[Mm]|M[\s\S]{3}|\d+;\d+;\d+M|[IO])/uy;
  while (report.test(data)) {
    if (report.lastIndex === data.length) return true;
  }
  return false;
}
