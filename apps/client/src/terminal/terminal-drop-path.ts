// Quoting follows Orca's terminal drop (src/renderer/src/components/terminal-pane/
// pane-helpers.ts shellEscapePath), with PowerShell's literal single quotes.

const windowsPath = (path: string) =>
  /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith("\\\\");

/** The path relative to the directory, when the path is inside it. */
export function pathInside(path: string, directory: string) {
  const windows = windowsPath(path);
  const normalize = (value: string) =>
    windows ? value.replaceAll("/", "\\") : value;
  const separator = windows ? "\\" : "/";
  const same = (left: string, right: string) =>
    windows ? left.toLowerCase() === right.toLowerCase() : left === right;
  const base = normalize(directory).replace(/[\\/]+$/u, "");
  const target = normalize(path);
  if (same(target, base)) return ".";
  const prefix = base + separator;
  return target.length > prefix.length &&
    same(target.slice(0, prefix.length), prefix)
    ? target.slice(prefix.length)
    : undefined;
}

/** A path as the shell reads one argument, without expanding anything in it. */
export function quotePath(path: string, shell: string, windows: boolean) {
  // A leading "-" or "@" would start a parameter or a splat in PowerShell.
  if (shell === "powershell")
    return /^[A-Za-z0-9_./:\\][A-Za-z0-9_./:\\-]*$/u.test(path)
      ? path
      : `'${path.replace(/['‘’‚‛]/gu, "$&$&")}'`;
  // cmd expands %name% also inside quotes; "^%" outside them is a plain "%".
  // Windows file names cannot hold the quote itself; backslashes before a
  // closing quote are doubled, as programs read the command line.
  if (shell === "cmd" || (windows && shell !== "git-bash"))
    return /^[A-Za-z0-9_./:\\-]+$/u.test(path)
      ? path
      : path
          .split("%")
          .map((part) => (part ? `"${part.replace(/\\+$/u, "$&$&")}"` : ""))
          .join("^%");
  // A command reads a leading "-" as an option, quoted or not; "./" keeps it a name.
  const slashed = shell === "git-bash" ? path.replaceAll("\\", "/") : path;
  const posix = slashed.startsWith("-") ? `./${slashed}` : slashed;
  if (/^[A-Za-z0-9_./@:-]+$/u.test(posix)) return posix;
  // fish reads \\ and \' inside single quotes as escapes.
  if (shell === "fish") return `'${posix.replace(/[\\']/gu, "\\$&")}'`;
  return `'${posix.replaceAll("'", `'\\''`)}'`;
}

/**
 * What a drop of a Host path types into a Terminal: the path relative to the
 * Terminal's known working directory when it is inside it, otherwise the
 * absolute path, quoted for the shell and followed by a space. Enter is not typed.
 * A name with a control character is not typed: the Terminal would read it as
 * keys (Enter, line editing, the CLI's own keys) whatever the quoting.
 */
export function terminalDropText(
  path: string,
  cwd: string | undefined,
  shell: string,
) {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(path)) return undefined;
  const typed = (cwd === undefined ? undefined : pathInside(path, cwd)) ?? path;
  return `${quotePath(typed, shell, windowsPath(path))} `;
}
