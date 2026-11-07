/**
 * Files and Git read APIs shared by the Host and Client.
 * Paths are slash-separated and relative to `root`; `root` is the absolute
 * path selected by the user on the Host.
 */

import { ProtocolValidationError } from "./index.ts";
import type { ValueSchema } from "./index.ts";

// 1 MiB of raw bytes expands to about 1.34 MiB in base64, below the 4 MiB frame.
export const MAX_READ_BYTES = 1_048_576;
// JSON may escape a control byte as six characters; this keeps one text page
// below the frame size while leaving room for its metadata.
export const MAX_TEXT_RANGE_BYTES = 524_288;
export const MAX_PAGE_RESPONSE_BYTES = 524_288;
// One list request returns at most this many items; the Client asks by position.
export const MAX_LIST_COUNT = 512;
// One syntax request covers at most this many lines; the Client asks by page.
export const MAX_SYNTAX_LINES = 1024;

export type ReadMethod =
  | "files.list"
  | "files.resolve"
  | "files.info"
  | "files.read"
  | "files.lineRange"
  | "files.syntax"
  | "files.search"
  | "files.find"
  | "git.status"
  | "git.history"
  | "git.commit"
  | "git.commitMessage"
  | "git.commitFiles"
  | "git.diffOpen"
  | "git.diffRows"
  | "git.diffRead"
  | "git.imageInfo"
  | "git.imageRead"
  | "git.diffSearch";

export type FileEntryKind = "directory" | "file" | "symlink" | "other";
export type FileContentKind =
  "directory" | "text" | "image" | "binary" | "unsupported" | "symlink";
export type SymlinkTargetState = "inside_root" | "outside_root" | "broken";
export type SymlinkTargetKind = "directory" | "file" | "other";

export interface FileEntry {
  name: string;
  path: string;
  absolutePath: string;
  kind: FileEntryKind;
  targetKind?: SymlinkTargetKind;
  symlinkTarget?: SymlinkTargetState;
}

export interface FileInfo {
  path: string;
  absolutePath: string;
  kind: FileContentKind;
  sizeBytes?: number;
  modifiedAtMs?: number;
  mimeType?: string;
  lineCount?: number;
  /** The Host's current identity of the file. The Client only uses it to drop its own cache. */
  revision?: string;
  symlinkTarget?: SymlinkTargetState;
}

export interface FileLinePosition {
  line: number;
  byteOffset: number;
}

export interface FileLineChunk {
  line: number;
  text: string;
  byteOffset: number;
  nextByteOffset: number;
  complete: boolean;
}

/**
 * The kinds the Host sorts syntax into. The Client's theme picks the color of
 * each kind; text outside every span is plain.
 */
export const SYNTAX_KINDS = [
  "comment",
  "keyword",
  "string",
  "number",
  "constant",
  "type",
  "function",
  "variable",
  "property",
  "tag",
  "attribute",
  "operator",
  "regexp",
  "escape",
  "heading",
  "emphasis",
  "strong",
  "link",
  "inserted",
  "deleted",
] as const;
export type SyntaxKind = (typeof SYNTAX_KINDS)[number];

/** `column` and `length` count UTF-16 code units of the line's text. */
export type SyntaxSpan = [column: number, length: number, kind: SyntaxKind];

export interface SyntaxLine {
  line: number;
  spans: SyntaxSpan[];
}

/** `column` and `length` count UTF-16 code units of the line's text. */
export interface TextSearchMatch {
  line: number;
  column: number;
  length: number;
  byteOffset: number;
  byteLength: number;
}

export interface GitRepositoryStatus {
  root: string;
  branch?: string;
  head?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export type GitChangeArea = "staged" | "unstaged" | "untracked" | "conflict";
export type GitChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "conflict"
  | "untracked";
export type GitReadIssue = "permission_denied" | "read_failed";

export interface GitChangeEntry {
  area: GitChangeArea;
  kind: GitChangeKind;
  path: string;
  absolutePath: string;
  oldPath?: string;
  stages?: Array<1 | 2 | 3>;
  addedLines?: number;
  removedLines?: number;
  binary?: boolean;
  error?: GitReadIssue;
}

export interface GitHistoryEntry {
  hash: string;
  subject: string;
  author: string;
  authorTimeMs: number;
}

export interface GitCommitFile {
  path: string;
  absolutePath: string;
  oldPath?: string;
  kind: GitChangeKind;
}

export type GitDiffSource =
  | {
      kind: "change";
      area: "staged" | "unstaged" | "untracked";
      path: string;
      oldPath?: string;
    }
  | { kind: "stage"; path: string; stage: 1 | 2 | 3 }
  | {
      kind: "commit";
      hash: string;
      parent?: string;
      path: string;
      oldPath?: string;
    };

export type GitImageSide = "old" | "new";

export type GitDiffRowKind = "context" | "added" | "deleted" | "note";

export interface GitDiffRow {
  row: number;
  kind: GitDiffRowKind;
  oldLine?: number;
  newLine?: number;
  text: string;
  byteOffset: number;
  nextByteOffset: number;
  complete: boolean;
  /** For a row returned in part: where its text ends. */
  lineEnd?: number;
}

export interface GitDiffInfo {
  binary?: boolean;
  newFile?: boolean;
  deletedFile?: boolean;
  oldMode?: string;
  newMode?: string;
  directory?: boolean;
}

export interface GitDiffSearchMatch {
  row: number;
  column: number;
  length: number;
  byteOffset: number;
  byteLength: number;
}

type SearchParams = {
  query: string;
  direction: "forward" | "backward";
  caseSensitive: boolean;
};

export interface ReadParamsByMethod {
  "files.list": {
    root: string;
    path: string;
    start: number;
    count: number;
    /** A name whose position in the sorted folder is returned as `located`. */
    locate?: string;
  };
  "files.resolve": { root: string; paths: string[] };
  "files.info": { root: string; path: string };
  "files.read": { root: string; path: string; offset: number; length: number };
  "files.lineRange": {
    root: string;
    path: string;
    startLine: number;
    lineCount: number;
    byteLimit: number;
    continuation?: FileLinePosition;
  };
  /** Syntax of the lines from `startLine`, for at most `lineCount` lines. */
  "files.syntax": {
    root: string;
    path: string;
    startLine: number;
    lineCount: number;
  };
  "files.search": SearchParams & {
    root: string;
    path: string;
    from: { line: number; column: number };
  };
  "files.find": { root: string; query: string; start: number; count: number };
  "git.status": { root: string; start: number; count: number };
  "git.history": { root: string; path?: string; start: number; count: number };
  "git.commit": { root: string; hash: string };
  "git.commitMessage": { root: string; hash: string; offset: number };
  "git.commitFiles": {
    root: string;
    hash: string;
    parent?: string;
    start: number;
    count: number;
  };
  "git.diffOpen": { root: string; source: GitDiffSource; refresh?: boolean };
  "git.diffRows": {
    root: string;
    source: GitDiffSource;
    startRow: number;
    rowCount: number;
    byteLimit: number;
    continuation?: { row: number; byteOffset: number };
  };
  "git.diffRead": {
    root: string;
    source: GitDiffSource;
    offset: number;
    length: number;
  };
  "git.imageInfo": { root: string; source: GitDiffSource; side: GitImageSide };
  "git.imageRead": {
    root: string;
    source: GitDiffSource;
    side: GitImageSide;
    offset: number;
    length: number;
  };
  "git.diffSearch": SearchParams & {
    root: string;
    source: GitDiffSource;
    from: { row: number; column: number };
  };
}

export interface ReadResultByMethod {
  "files.list": { entries: FileEntry[]; total: number; located?: number };
  "files.resolve": {
    results: {
      found: boolean;
      absolutePath: string;
      root: string;
      path: string;
      displayPath: string;
    }[];
  };
  "files.info": FileInfo;
  "files.read": {
    offset: number;
    nextOffset: number;
    bytesBase64: string;
    eof: boolean;
    sizeBytes: number;
    revision: string;
  };
  "files.lineRange": {
    lines: FileLineChunk[];
    next?: FileLinePosition;
    totalLines: number;
    sizeBytes: number;
    revision: string;
  };
  /**
   * `language` is absent when the file has no language or is not colored;
   * then `lines` is empty. Lines in `startLine`..`endLine - 1` without an
   * entry are plain. `endLine` may stop before the asked range to keep the
   * response small; the Client asks again from there.
   */
  "files.syntax": {
    language?: string;
    lines: SyntaxLine[];
    startLine: number;
    endLine: number;
    revision: string;
  };
  "files.search": {
    match?: TextSearchMatch;
    wrapped: boolean;
    revision: string;
  };
  "files.find": { entries: FileEntry[]; hasMore: boolean };
  "git.status": {
    isRepository: boolean;
    repository?: GitRepositoryStatus;
    /** Entries are ordered staged, unstaged, untracked, conflict; `start` indexes that order. */
    counts: Record<GitChangeArea, number>;
    entries: GitChangeEntry[];
  };
  "git.history": { commits: GitHistoryEntry[]; hasMore: boolean };
  "git.commit": {
    hash: string;
    author: string;
    authorTimeMs: number;
    parents: string[];
    message: string;
    messageNextOffset?: number;
  };
  "git.commitMessage": { text: string; nextOffset?: number };
  "git.commitFiles": { files: GitCommitFile[]; total: number };
  "git.diffOpen": {
    revision: string;
    totalRows: number;
    info: GitDiffInfo;
    /** Unchanged rows far from any change: [startRow, rowCount]. */
    collapsed: Array<[number, number]>;
  };
  "git.diffRows": {
    revision: string;
    totalRows: number;
    rows: GitDiffRow[];
    next?: { row: number; byteOffset: number };
  };
  "git.diffRead": {
    offset: number;
    nextOffset: number;
    bytesBase64: string;
    eof: boolean;
    revision: string;
  };
  "git.imageInfo": {
    present: boolean;
    path: string;
    mimeType?: string;
    sizeBytes?: number;
    revision: string;
  };
  "git.imageRead": {
    offset: number;
    nextOffset: number;
    bytesBase64: string;
    eof: boolean;
    sizeBytes: number;
    revision: string;
  };
  "git.diffSearch": {
    match?: GitDiffSearchMatch;
    wrapped: boolean;
    revision: string;
  };
}

export type ReadRequest = {
  [M in ReadMethod]: {
    kind: "request";
    operationId: string;
    method: M;
    params: ReadParamsByMethod[M];
  };
}[ReadMethod];

/**
 * `paths` are relative to the watched base (the selected folder for Files,
 * the repository root for Git). Without `paths`, anything may have changed.
 */
export type ReadingChangedEvent = {
  type: "reading.changed";
  operationId: string;
  root: string;
  paths?: string[];
};

export interface ReadingWatchRequest {
  kind: "subscribe";
  operationId: string;
  method: "reading.watch";
  params: { root: string; scope: "files" | "file" | "git" };
}

function fail(message: string): never {
  throw new ProtocolValidationError("invalid_request", message);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    return fail(`${field} must be ${allowEmpty ? "a" : "a non-empty"} string`);
  }
  if (value.includes("\0")) return fail(`${field} must not contain NUL`);
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}

function safeInteger(value: unknown, field: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    return fail(`${field} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") return fail(`${field} must be boolean`);
  return value;
}

function relativePath(value: unknown, field: string, allowRoot = true): string {
  const parsed = text(value, field, allowRoot);
  if (parsed === "" && allowRoot) return parsed;
  if (
    parsed.startsWith("/") ||
    parsed.startsWith("\\") ||
    /^[a-zA-Z]:/u.test(parsed) ||
    parsed.split(/[\\/]/u).some((part) => part === ".." || part === ".")
  ) {
    return fail(`${field} must stay relative to root`);
  }
  return parsed;
}

function choice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    return fail(`${field} is unsupported`);
  }
  return value;
}

function listWindow(input: Record<string, unknown>) {
  const count = safeInteger(input.count, "count", 1);
  if (count > MAX_LIST_COUNT) return fail("count exceeds the list window");
  return { start: safeInteger(input.start, "start"), count };
}

function readLength(value: unknown): number {
  const length = safeInteger(value, "length", 1);
  if (length > MAX_READ_BYTES) return fail("length exceeds the read range");
  return length;
}

function textRangeLimit(value: unknown): number {
  const byteLimit = safeInteger(value, "byteLimit", 1);
  if (byteLimit > MAX_TEXT_RANGE_BYTES)
    return fail("byteLimit exceeds the text range");
  return byteLimit;
}

function searchParams(input: Record<string, unknown>): SearchParams {
  return {
    query: text(input.query, "query"),
    direction: choice(
      input.direction,
      ["forward", "backward"] as const,
      "direction",
    ),
    caseSensitive: boolean(input.caseSensitive, "caseSensitive"),
  };
}

function objectId(value: unknown, field: string): string {
  const parsed = text(value, field);
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(parsed))
    return fail(`${field} must be a Git object id`);
  return parsed.toLowerCase();
}

function diffSource(value: unknown): GitDiffSource {
  const input = record(value, "source");
  const path = relativePath(input.path, "path", false);
  const oldPath =
    input.oldPath === undefined
      ? undefined
      : relativePath(input.oldPath, "oldPath", false);
  switch (input.kind) {
    case "change":
      return {
        kind: "change",
        area: choice(
          input.area,
          ["staged", "unstaged", "untracked"] as const,
          "area",
        ),
        path,
        ...(oldPath === undefined ? {} : { oldPath }),
      };
    case "stage":
      if (input.stage !== 1 && input.stage !== 2 && input.stage !== 3)
        return fail("stage must be 1, 2, or 3");
      return { kind: "stage", path, stage: input.stage };
    case "commit":
      return {
        kind: "commit",
        hash: objectId(input.hash, "hash"),
        ...(input.parent === undefined
          ? {}
          : { parent: objectId(input.parent, "parent") }),
        path,
        ...(oldPath === undefined ? {} : { oldPath }),
      };
    default:
      return fail("source kind is unsupported");
  }
}

function parseParams(
  method: ReadMethod,
  params: Record<string, unknown>,
): ReadParamsByMethod[ReadMethod] {
  const root = text(params.root, "root");
  switch (method) {
    case "files.list": {
      const locate = optionalText(params.locate, "locate");
      return {
        root,
        path: relativePath(params.path, "path"),
        ...listWindow(params),
        ...(locate === undefined ? {} : { locate }),
      };
    }
    case "files.resolve":
      if (!Array.isArray(params.paths)) return fail("paths must be an array");
      return { root, paths: params.paths.map((path) => text(path, "path")) };
    case "files.info":
      return { root, path: relativePath(params.path, "path", false) };
    case "files.read":
      return {
        root,
        path: relativePath(params.path, "path", false),
        offset: safeInteger(params.offset, "offset"),
        length: readLength(params.length),
      };
    case "files.lineRange": {
      const continuation =
        params.continuation === undefined
          ? undefined
          : record(params.continuation, "continuation");
      return {
        root,
        path: relativePath(params.path, "path", false),
        startLine: safeInteger(params.startLine, "startLine", 1),
        lineCount: safeInteger(params.lineCount, "lineCount", 1),
        byteLimit: textRangeLimit(params.byteLimit),
        ...(continuation === undefined
          ? {}
          : {
              continuation: {
                line: safeInteger(continuation.line, "continuation.line", 1),
                byteOffset: safeInteger(
                  continuation.byteOffset,
                  "continuation.byteOffset",
                ),
              },
            }),
      };
    }
    case "files.syntax": {
      const lineCount = safeInteger(params.lineCount, "lineCount", 1);
      if (lineCount > MAX_SYNTAX_LINES)
        return fail("lineCount exceeds the syntax range");
      return {
        root,
        path: relativePath(params.path, "path", false),
        startLine: safeInteger(params.startLine, "startLine", 1),
        lineCount,
      };
    }
    case "files.search": {
      const from = record(params.from, "from");
      return {
        root,
        path: relativePath(params.path, "path", false),
        from: {
          line: safeInteger(from.line, "from.line", 1),
          column: safeInteger(from.column, "from.column"),
        },
        ...searchParams(params),
      };
    }
    case "files.find":
      return {
        root,
        query: text(params.query, "query"),
        ...listWindow(params),
      };
    case "git.status":
      return { root, ...listWindow(params) };
    case "git.history": {
      const path = optionalText(params.path, "path");
      return {
        root,
        ...(path === undefined ? {} : { path }),
        ...listWindow(params),
      };
    }
    case "git.commit":
      return { root, hash: objectId(params.hash, "hash") };
    case "git.commitMessage":
      return {
        root,
        hash: objectId(params.hash, "hash"),
        offset: safeInteger(params.offset, "offset"),
      };
    case "git.commitFiles":
      return {
        root,
        hash: objectId(params.hash, "hash"),
        ...(params.parent === undefined
          ? {}
          : { parent: objectId(params.parent, "parent") }),
        ...listWindow(params),
      };
    case "git.diffOpen":
      return {
        root,
        source: diffSource(params.source),
        ...(params.refresh === undefined
          ? {}
          : { refresh: boolean(params.refresh, "refresh") }),
      };
    case "git.diffRows": {
      const continuation =
        params.continuation === undefined
          ? undefined
          : record(params.continuation, "continuation");
      return {
        root,
        source: diffSource(params.source),
        startRow: safeInteger(params.startRow, "startRow"),
        rowCount: safeInteger(params.rowCount, "rowCount", 1),
        byteLimit: textRangeLimit(params.byteLimit),
        ...(continuation === undefined
          ? {}
          : {
              continuation: {
                row: safeInteger(continuation.row, "continuation.row"),
                byteOffset: safeInteger(
                  continuation.byteOffset,
                  "continuation.byteOffset",
                ),
              },
            }),
      };
    }
    case "git.diffRead":
      return {
        root,
        source: diffSource(params.source),
        offset: safeInteger(params.offset, "offset"),
        length: readLength(params.length),
      };
    case "git.imageInfo":
    case "git.imageRead": {
      const source = diffSource(params.source);
      if (source.kind === "stage") return fail("source kind is unsupported");
      return {
        root,
        source,
        side: choice(params.side, ["old", "new"] as const, "side"),
        ...(method === "git.imageRead"
          ? {
              offset: safeInteger(params.offset, "offset"),
              length: readLength(params.length),
            }
          : {}),
      };
    }
    case "git.diffSearch": {
      const from = record(params.from, "from");
      return {
        root,
        source: diffSource(params.source),
        from: {
          row: safeInteger(from.row, "from.row"),
          column: safeInteger(from.column, "from.column"),
        },
        ...searchParams(params),
      };
    }
  }
}

const readMethods: readonly ReadMethod[] = [
  "files.list",
  "files.resolve",
  "files.info",
  "files.read",
  "files.lineRange",
  "files.syntax",
  "files.search",
  "files.find",
  "git.status",
  "git.history",
  "git.commit",
  "git.commitMessage",
  "git.commitFiles",
  "git.diffOpen",
  "git.diffRows",
  "git.diffRead",
  "git.imageInfo",
  "git.imageRead",
  "git.diffSearch",
];

export function isReadMethod(value: unknown): value is ReadMethod {
  return typeof value === "string" && readMethods.includes(value as ReadMethod);
}

/** The Host's entry check for values received from a Client. */
export function parseReadRequest(value: unknown): ReadRequest {
  const input = record(value, "request");
  if (input.kind !== "request") return fail("reading request kind is invalid");
  if (!isReadMethod(input.method)) return fail("method is unsupported");
  return {
    kind: "request",
    operationId: text(input.operationId, "operationId"),
    method: input.method,
    params: parseParams(input.method, record(input.params, "params")),
  } as ReadRequest;
}

export function parseReadingWatchRequest(value: unknown): ReadingWatchRequest {
  const input = record(value, "watch request");
  if (input.kind !== "subscribe" || input.method !== "reading.watch")
    return fail("reading watch request is invalid");
  const params = record(input.params, "params");
  return {
    kind: "subscribe",
    operationId: text(input.operationId, "operationId"),
    method: "reading.watch",
    params: {
      root: text(params.root, "root"),
      scope: choice(params.scope, ["files", "file", "git"] as const, "scope"),
    },
  };
}

// Results come from the Host this Client is registered with. The Client only
// checks the shape it reads and ignores unknown fields and values.
function shaped<T>(
  label: string,
  fields: Record<string, "string" | "number" | "boolean" | "array" | "object">,
): ValueSchema<T> {
  return {
    parse(value) {
      const input = record(value, label);
      for (const [field, type] of Object.entries(fields)) {
        const actual = input[field];
        const ok =
          type === "array"
            ? Array.isArray(actual)
            : type === "object"
              ? typeof actual === "object" && actual !== null
              : typeof actual === type;
        if (!ok) return fail(`${label}.${field} must be ${type}`);
      }
      return input as T;
    },
  };
}

export const readResultSchemas: {
  [M in ReadMethod]: ValueSchema<ReadResultByMethod[M]>;
} = {
  "files.list": shaped("files.list", { entries: "array", total: "number" }),
  "files.resolve": shaped("files.resolve", { results: "array" }),
  "files.info": shaped("files.info", {
    path: "string",
    absolutePath: "string",
    kind: "string",
  }),
  "files.read": shaped("files.read", {
    offset: "number",
    nextOffset: "number",
    bytesBase64: "string",
    eof: "boolean",
    revision: "string",
  }),
  "files.lineRange": shaped("files.lineRange", {
    lines: "array",
    totalLines: "number",
    revision: "string",
  }),
  "files.syntax": shaped("files.syntax", {
    lines: "array",
    startLine: "number",
    endLine: "number",
    revision: "string",
  }),
  "files.search": shaped("files.search", {
    wrapped: "boolean",
    revision: "string",
  }),
  "files.find": shaped("files.find", { entries: "array", hasMore: "boolean" }),
  "git.status": shaped("git.status", {
    isRepository: "boolean",
    counts: "object",
    entries: "array",
  }),
  "git.history": shaped("git.history", {
    commits: "array",
    hasMore: "boolean",
  }),
  "git.commit": shaped("git.commit", {
    hash: "string",
    parents: "array",
    message: "string",
  }),
  "git.commitMessage": shaped("git.commitMessage", { text: "string" }),
  "git.commitFiles": shaped("git.commitFiles", {
    files: "array",
    total: "number",
  }),
  "git.diffOpen": shaped("git.diffOpen", {
    revision: "string",
    totalRows: "number",
    info: "object",
    collapsed: "array",
  }),
  "git.diffRows": shaped("git.diffRows", {
    revision: "string",
    totalRows: "number",
    rows: "array",
  }),
  "git.diffRead": shaped("git.diffRead", {
    offset: "number",
    nextOffset: "number",
    bytesBase64: "string",
    eof: "boolean",
    revision: "string",
  }),
  "git.imageInfo": shaped("git.imageInfo", {
    present: "boolean",
    path: "string",
    revision: "string",
  }),
  "git.imageRead": shaped("git.imageRead", {
    offset: "number",
    nextOffset: "number",
    bytesBase64: "string",
    eof: "boolean",
    sizeBytes: "number",
    revision: "string",
  }),
  "git.diffSearch": shaped("git.diffSearch", {
    wrapped: "boolean",
    revision: "string",
  }),
};

export function parseReadingChangedEvent(value: unknown): ReadingChangedEvent {
  const input = record(value, "reading change event");
  if (input.type !== "reading.changed") return fail("event type is invalid");
  const paths = Array.isArray(input.paths)
    ? input.paths.filter((path): path is string => typeof path === "string")
    : undefined;
  return {
    type: "reading.changed",
    operationId: text(input.operationId, "operationId"),
    root: text(input.root, "root"),
    ...(paths === undefined ? {} : { paths }),
  };
}
