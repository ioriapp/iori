/** A color of the Terminal's palette (0–255) or an RGB color. */
export type LogColor = number | readonly [number, number, number];
export type LogStyle = {
  foreground?: LogColor;
  background?: LogColor;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
};
export type LogSpan = { text: string; style: LogStyle };
/** One line of a job's log as the screen shows it. */
export type LogLine = {
  spans: LogSpan[];
  /** The Forge's mark of an error or warning line (`##[error]`). */
  kind?: "error" | "warning";
};

// Both Forges start every line with the time it was written.
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}) /u;
// CSI (ESC [ … final), OSC (ESC ] … BEL or ESC \) and two-byte ESC sequences.
const ESCAPE =
  /\u001b(?:\[([0-?]*)[ -/]*([@-~])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[ -/]*[0-~]?)/gu;

/** The lines of a part of a log; a final newline does not start an empty line. */
export function logLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function applySgr(style: LogStyle, parameters: string): LogStyle {
  const codes = parameters
    ? parameters.split(/[;:]/u).map((value) => Number(value || 0))
    : [0];
  let next: LogStyle = { ...style };
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]!;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 9) next.strike = true;
    else if (code === 21 || code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code === 29) delete next.strike;
    else if (code >= 30 && code <= 37) next.foreground = code - 30;
    else if (code >= 90 && code <= 97) next.foreground = code - 90 + 8;
    else if (code === 39) delete next.foreground;
    else if (code >= 40 && code <= 47) next.background = code - 40;
    else if (code >= 100 && code <= 107) next.background = code - 100 + 8;
    else if (code === 49) delete next.background;
    else if (code === 38 || code === 48) {
      const field = code === 38 ? "foreground" : "background";
      if (codes[index + 1] === 5 && codes[index + 2] !== undefined) {
        next[field] = Math.min(255, codes[index + 2]!);
        index += 2;
      } else if (codes[index + 1] === 2 && codes[index + 4] !== undefined) {
        next[field] = [
          Math.min(255, codes[index + 2]!),
          Math.min(255, codes[index + 3]!),
          Math.min(255, codes[index + 4]!),
        ];
        index += 4;
      }
    }
  }
  return next;
}

/**
 * One raw line of a job's log as shown: without its leading timestamp, with
 * what the last carriage return left (as a terminal shows progress output),
 * and with its colors. Other escape sequences are left out.
 */
export function parseLogLine(raw: string): LogLine {
  let text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  const stamp = TIMESTAMP.exec(text);
  if (stamp) text = text.slice(stamp[0].length);
  const carriage = text.lastIndexOf("\r");
  if (carriage >= 0) text = text.slice(carriage + 1);
  const spans: LogSpan[] = [];
  let style: LogStyle = {};
  let at = 0;
  const push = (value: string) => {
    if (!value) return;
    const last = spans.at(-1);
    if (last && last.style === style) last.text += value;
    else spans.push({ text: value, style });
  };
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(at, match.index));
    at = match.index + match[0].length;
    if (match[2] === "m") style = applySgr(style, match[1] ?? "");
  }
  push(text.slice(at));
  const plain = spans.map((span) => span.text).join("");
  const kind = plain.startsWith("##[error]")
    ? "error"
    : plain.startsWith("##[warning]")
      ? "warning"
      : undefined;
  return { spans, ...(kind ? { kind } : {}) };
}

export function lineText(line: LogLine): string {
  return line.spans.map((span) => span.text).join("");
}

// The line that ends a failed step: GitHub's `##[error]`, and Forgejo's runner.
const FAILURE =
  /^(?:##\[error\]|.*\[runner\]: exitcode '\d+': failure|\s*❌\s+Failure - )/u;

/**
 * The end of the failed step among loaded lines: the last failure line, so a
 * step that failed but let the job go on is passed over.
 */
export function failedStepEnd(lines: readonly LogLine[]): number | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1)
    if (FAILURE.test(lineText(lines[index]!))) return index;
  return undefined;
}
