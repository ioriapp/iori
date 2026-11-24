import type { ForgeCiStep } from "@iori/protocol";

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

export type FileLink = {
  start: number;
  end: number;
  path: string;
  line: number;
  column?: number;
};

const FILE_LINK =
  /(^|[\s(\[\]<'"`,;])((?:[^\s:()[\]<>"'`,;\\]|\\(?!\s))+?)(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s*(\d+))?\))(?=$|[\s)\]>'"`,;:.])/gu;
const FILE_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,9}$/u;
const HOSTNAME_TLD =
  /\.(?:com|org|net|io|dev|edu|gov|local|internal|localhost)$/iu;
const HAS_ALNUM = /[A-Za-z0-9]/u;

function isWorkspaceRelativePath(rawPath: string): string | undefined {
  if (!rawPath || rawPath.startsWith("/") || rawPath.startsWith("\\"))
    return undefined;
  if (rawPath.includes("..")) return undefined;
  if (/^https?:\/\//iu.test(rawPath)) return undefined;
  const normalized = rawPath.replace(/^(?:\.\/)+/u, "");
  if (!normalized || normalized.startsWith("/")) return undefined;
  const slash = normalized.lastIndexOf("/");
  if (slash >= 0) {
    const base = normalized.slice(slash + 1);
    if (!base || base === "." || !HAS_ALNUM.test(base)) return undefined;
    return normalized;
  }
  const dot = normalized.lastIndexOf(".");
  if (
    dot <= 0 ||
    !FILE_EXTENSION.test(normalized) ||
    HOSTNAME_TLD.test(normalized)
  )
    return undefined;
  return normalized;
}

/**
 * Extract workspace-relative file references (`path:line`, `path:line:col`,
 * `path(line,col)`) from a plain log line, excluding URLs, `..`, and absolute
 * paths.
 */
export function extractFileLinks(plainLine: string): FileLink[] {
  const links: FileLink[] = [];
  for (const match of plainLine.matchAll(FILE_LINK)) {
    const prefix = match[1] ?? "";
    const rawPath = match[2] ?? "";
    const path = isWorkspaceRelativePath(rawPath);
    if (!path) continue;
    const lineStr = match[3] ?? match[5];
    const colStr = match[4] ?? match[6];
    const line = Number(lineStr);
    if (!Number.isSafeInteger(line) || line < 1) continue;
    const column = colStr !== undefined ? Number(colStr) : undefined;
    if (column !== undefined && (!Number.isSafeInteger(column) || column < 1))
      continue;
    const start = match.index + prefix.length;
    const end = match.index + match[0].length;
    links.push({
      start,
      end,
      path,
      line,
      ...(column !== undefined ? { column } : {}),
    });
  }
  return links;
}

/**
 * Return 0-based line indices of all error/failure lines in ascending order.
 */
export function findErrorLines(lines: readonly LogLine[]): number[] {
  const result: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.kind === "error" || FAILURE.test(lineText(line)))
      result.push(index);
  }
  return result;
}

const START_ACTION = /^##\[start-action\s+display=([^;\]]+)/u;
const RUNNER_STEP = /^\s*⭐\s+(?:Run\s+)?(.+)$/u;

function stepHeadingText(plain: string): string | undefined {
  if (plain.startsWith("##[group]")) {
    const text = plain.slice("##[group]".length).trim();
    return text || undefined;
  }
  const action = START_ACTION.exec(plain);
  if (action) {
    const text = action[1]!.trim();
    return text || undefined;
  }
  const runner = RUNNER_STEP.exec(plain);
  if (runner) {
    const text = runner[1]!.trim();
    return text || undefined;
  }
  return undefined;
}

function stripRunPrefix(lower: string): string {
  return lower.startsWith("run ") ? lower.slice(4).trim() : lower;
}

/**
 * Map each step array index to the 0-based start line index in the loaded log.
 * Unmatched steps are omitted.
 */
export function findStepLineIndices(
  lines: readonly LogLine[],
  steps: readonly ForgeCiStep[],
): Map<number, number> {
  const result = new Map<number, number>();
  if (lines.length === 0 || steps.length === 0) return result;

  const plainLines = lines.map((line) => lineText(line).trim());
  const headings = plainLines.map((plain) => {
    const heading = stepHeadingText(plain);
    return heading ? heading.toLowerCase() : undefined;
  });

  let cursor = 0;
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
    const name = steps[stepIndex]!.name.trim();
    if (!name) continue;
    const nameLower = name.toLowerCase();
    const nameCore = stripRunPrefix(nameLower);

    let matched = -1;
    // Pass 1: exact heading match (##[group], ##[start-action], runner step, or exact line).
    for (let i = cursor; i < plainLines.length; i += 1) {
      const heading = headings[i];
      if (heading !== undefined) {
        if (
          heading === nameLower ||
          heading === `run ${nameLower}` ||
          stripRunPrefix(heading) === nameCore
        ) {
          matched = i;
          break;
        }
      } else if (plainLines[i]!.toLowerCase() === nameLower) {
        matched = i;
        break;
      }
    }

    // Pass 2: heading contains step name.
    if (matched < 0) {
      for (let i = cursor; i < plainLines.length; i += 1) {
        const heading = headings[i];
        if (heading === undefined) continue;
        if (
          heading.includes(nameLower) ||
          (nameCore.length >= 3 && heading.includes(nameCore))
        ) {
          matched = i;
          break;
        }
      }
    }

    if (matched >= 0) {
      result.set(stepIndex, matched);
      cursor = matched + 1;
    }
  }
  return result;
}

export type CiFailureForAgentInput = {
  jobName: string;
  runName?: string;
  jobId: string;
  failedStepName?: string;
  errorExcerpt: string;
};

const MAX_EXCERPT_LINES = 40;
const MAX_EXCERPT_CHARS = 4000;

function trimErrorExcerpt(raw: string): string {
  const normalized = raw.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  const split = normalized.split("\n");
  if (split.at(-1) === "") split.pop();
  const tailLines =
    split.length > MAX_EXCERPT_LINES ? split.slice(-MAX_EXCERPT_LINES) : split;
  let excerpt = tailLines.join("\n");
  if (excerpt.length > MAX_EXCERPT_CHARS) {
    let start = excerpt.length - MAX_EXCERPT_CHARS;
    const code = excerpt.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) start += 1;
    excerpt = excerpt.slice(start);
  }
  return excerpt;
}

/**
 * Format a failed CI job summary and trimmed tail excerpt for sending to an Agent.
 */
export function formatCiFailureForAgent(input: CiFailureForAgentInput): string {
  const title = input.runName?.trim()
    ? `${input.runName.trim()} / ${input.jobName.trim()}`
    : input.jobName.trim();
  const out = [`CI failed: ${title}`];
  const step = input.failedStepName?.trim();
  if (step) out.push(`Failed step: ${step}`);
  out.push(`Full log: \`iori ci log ${input.jobId}\``);
  const excerpt = trimErrorExcerpt(input.errorExcerpt);
  if (excerpt.trim()) {
    out.push("", "```", excerpt, "```");
  }
  return out.join("\n");
}
