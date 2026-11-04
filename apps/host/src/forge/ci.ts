import {
  forgeCiState,
  forgeCiStateOrder,
  type ForgeCi,
  type ForgeCiLog,
  type ForgeCiResult,
  type ForgeCiRun,
  type ForgeCiStatus,
  type ForgeCiStatusOf,
} from "@iori/protocol";

/** The read of an adapter; the service adds the commit from the worktree's Git. */
export type ForgeCiRead = Omit<ForgeCi, "commit" | "url">;

/**
 * What one reader (a Client's connection) keeps of a done job's whole log, so
 * reading earlier parts of the same job does not receive it again. The next
 * job read by that reader replaces it; it goes with the connection.
 */
export type CiLogKeep = { key?: string; bytes?: Uint8Array };

// One response carries this much of a log. It fits a protocol frame even when
// every byte is escaped in JSON, and holds the few thousand lines around a
// failed step's end, which only short cleanup steps follow.
export const LOG_PART_BYTES = 256 * 1024;

/**
 * A Forge's state word in iori's terms. A word iori does not know stays as it
 * came, with a neutral mark, so a new word never stops the whole View.
 */
export function ciStatus(
  words: ReadonlyMap<string, ForgeCiStatus>,
  value: unknown,
): ForgeCiStatusOf {
  const status = typeof value === "string" ? words.get(value) : undefined;
  if (status) return { status };
  return {
    status: "other",
    ...(typeof value === "string" && value ? { word: value } : {}),
  };
}

/** Commit statuses of GitHub, Forgejo and Gitea, for the marks and the CI View. */
export const commitStatusWords = new Map<string, ForgeCiStatus>([
  ["success", "passed"],
  ["failure", "failed"],
  ["error", "error"],
  ["warning", "warning"],
  ["pending", "pending"],
  ["skipped", "skipped"],
]);

/** The sidebar mark's group: skipped counts as passed; a word iori does not know is not counted. */
export function markState(
  status: ForgeCiStatus,
): "passed" | "failed" | "running" | "other" {
  const state = forgeCiState(status);
  return state === "skipped" ? "passed" : state;
}

/** Forge timestamps; Forgejo writes the zero time for a run not yet stopped. */
export function ciTime(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : undefined;
}

export function sortRuns(runs: ForgeCiRun[]): ForgeCiRun[] {
  const rank = (run: ForgeCiRun) =>
    forgeCiStateOrder.indexOf(forgeCiState(run.status));
  return [...runs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

export function sortResults(results: ForgeCiResult[]): ForgeCiResult[] {
  const rank = (result: ForgeCiResult) =>
    forgeCiStateOrder.indexOf(forgeCiState(result.status));
  return [...results].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

/** A failing run, else a running one (results after runs), else the commit's own CI page. */
export function ciBrowserUrl(read: ForgeCiRead, commitUrl: string): string {
  for (const state of ["failed", "running"] as const) {
    const url = [...read.runs, ...read.results].find(
      (item) => forgeCiState(item.status) === state && item.url,
    )?.url;
    if (url) return url;
  }
  return commitUrl;
}

/**
 * Bytes `chunk` of a log that starts at byte `offset`; text starts at a line
 * unless it is the log's start. A newline byte never occurs inside a UTF-8
 * character, so the offsets stay exact around a cut character.
 */
export function logPart(
  chunk: Uint8Array,
  offset: number,
  size: number,
): ForgeCiLog {
  let skip = 0;
  if (offset > 0) {
    const newline = chunk.indexOf(0x0a);
    // A line longer than the part is shown cut, so reading earlier still moves back.
    if (newline >= 0 && newline + 1 < chunk.length) skip = newline + 1;
  }
  return {
    start: offset + skip,
    end: offset + chunk.length,
    size,
    text: new TextDecoder().decode(chunk.subarray(skip)),
  };
}

/** The part of a log `size` bytes long to read: the end, or the part before `before`. */
export function logRange(before: number | undefined, size?: number) {
  const end = Math.min(before ?? size ?? Infinity, size ?? Infinity);
  return { end, start: Math.max(0, end - LOG_PART_BYTES) };
}
