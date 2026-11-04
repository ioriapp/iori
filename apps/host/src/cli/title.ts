/** Console's inherited shell executable title is not a CLI title. */
export function cliTitle(
  title: string,
  fallback: string,
  windows: boolean,
): string {
  const clean = title
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
    .trim()
    // CLI status symbols do not belong in the displayed or stored title.
    .replace(/^[\p{So}\s]+/u, "");
  return !clean ||
    (windows &&
      /(?:^|[\\/:\s])(?:cmd|pwsh|powershell|bash)(?:\.exe)["']?$/iu.test(clean))
    ? fallback
    : clean;
}
