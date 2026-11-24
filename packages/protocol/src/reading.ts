/**
 * Files and Git read APIs shared by the Host and Client.
 * Paths are slash-separated and relative to `root`; `root` is the absolute
 * path selected by the user on the Host.
 */
import * as v from "valibot";
import {
  ProtocolValidationError,
  type ValueSchema,
  parseValue,
  schema,
  method,
  nonNulText,
  decoded,
  integer,
  type Params,
  type Results,
  type ResultSchemas,
  hasMethod,
} from "./primitives.ts";

// 1 MiB of raw bytes expands to about 1.34 MiB in base64, below the 4 MiB frame.
export const MAX_READ_BYTES = 1_048_576;
// JSON may escape a control byte as six characters; this keeps one text page
// below the frame size while leaving room for its metadata.
export const MAX_TEXT_RANGE_BYTES = 524_288;
export const MAX_PAGE_RESPONSE_BYTES = 524_288;
// One list request returns at most this many items; the Client asks by position.
export const MAX_LIST_COUNT = 512;
export const MAX_WORKSPACE_SEARCH_RESULTS = 500;
// One syntax request covers at most this many lines; the Client asks by page.
export const MAX_SYNTAX_LINES = 1024;

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

export interface WorkspaceSearchMatch {
  path: string;
  absolutePath: string;
  /** 1-based line, with column and length in UTF-16 code units. */
  line: number;
  column: number;
  length: number;
  text: string;
  /** Offset of the match in the line preview. */
  previewColumn: number;
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

export type GitDiffSource = v.InferOutput<typeof source>;

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

function objectId(value: unknown, field: string): string {
  const parsed = text(value, field);
  if (!/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u.test(parsed))
    return fail(`${field} must be a Git object id`);
  return parsed.toLowerCase();
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

const root = nonNulText;
const relative = decoded((value) => relativePath(value, "path"));
const filePath = decoded((value) => relativePath(value, "path", false));
const listWindow = { start: integer(0), count: integer(1, MAX_LIST_COUNT) };
const range = { offset: integer(0), length: integer(1, MAX_READ_BYTES) };
const byteLimit = integer(1, MAX_TEXT_RANGE_BYTES);
const search = {
  query: nonNulText,
  direction: v.picklist(["forward", "backward"]),
  caseSensitive: v.boolean(),
};
const hash = decoded((value) => objectId(value, "hash"));
const changePath = { path: filePath, oldPath: v.optional(filePath) };
const branchRef = v.pipe(
  nonNulText,
  v.check(
    (name) =>
      !/^-|[\s\p{Cc}~^:?*\[\\]|\.\.|@\{|\.$/u.test(name) &&
      name !== "@" &&
      name
        .split("/")
        .every(
          (part) => part && !part.startsWith(".") && !part.endsWith(".lock"),
        ),
  ),
);
const source = v.variant("kind", [
  v.object({
    kind: v.literal("change"),
    area: v.picklist(["staged", "unstaged", "untracked"]),
    ...changePath,
  }),
  v.object({
    kind: v.literal("branch"),
    base: branchRef,
    untracked: v.optional(v.boolean()),
    ...changePath,
  }),
  v.pipe(
    v.object({
      kind: v.literal("stage"),
      stage: v.picklist([1, 2, 3]),
      ...changePath,
    }),
    v.transform(({ kind, path, stage }) => ({ kind, path, stage })),
  ),
  v.object({
    kind: v.literal("commit"),
    hash,
    parent: v.optional(hash),
    ...changePath,
  }),
]);
const image = {
  root,
  source: v.pipe(
    source,
    v.check((value) => value.kind !== "stage"),
  ),
  side: v.picklist(["old", "new"]),
};
export const readMethods = {
  "files.list": method(
    v.object({
      root,
      path: relative,
      ...listWindow,
      locate: v.optional(nonNulText),
    }),
    shaped<{ entries: FileEntry[]; total: number; located?: number }>(
      "files.list",
      { entries: "array", total: "number" },
    ),
  ),
  "files.resolve": method(
    v.object({ root, paths: v.array(nonNulText) }),
    shaped<{
      results: {
        found: boolean;
        absolutePath: string;
        root: string;
        path: string;
        displayPath: string;
      }[];
    }>("files.resolve", { results: "array" }),
  ),
  "files.info": method(
    v.object({ root, path: filePath }),
    shaped<FileInfo>("files.info", {
      path: "string",
      absolutePath: "string",
      kind: "string",
    }),
  ),
  "files.read": method(
    v.object({ root, path: filePath, ...range }),
    shaped<{
      offset: number;
      nextOffset: number;
      bytesBase64: string;
      eof: boolean;
      sizeBytes: number;
      revision: string;
    }>("files.read", {
      offset: "number",
      nextOffset: "number",
      bytesBase64: "string",
      eof: "boolean",
      revision: "string",
    }),
  ),
  "files.lineRange": method(
    v.object({
      root,
      path: filePath,
      startLine: integer(1),
      lineCount: integer(1),
      byteLimit,
      continuation: v.optional(
        v.object({ line: integer(1), byteOffset: integer(0) }),
      ),
    }),
    shaped<{
      lines: FileLineChunk[];
      next?: FileLinePosition;
      totalLines: number;
      sizeBytes: number;
      revision: string;
    }>("files.lineRange", {
      lines: "array",
      totalLines: "number",
      revision: "string",
    }),
  ),
  "files.syntax": method(
    v.object({
      root,
      path: filePath,
      startLine: integer(1),
      lineCount: integer(1, MAX_SYNTAX_LINES),
    }),
    shaped<{
      language?: string;
      lines: SyntaxLine[];
      startLine: number;
      endLine: number;
      revision: string;
    }>("files.syntax", {
      lines: "array",
      startLine: "number",
      endLine: "number",
      revision: "string",
    }),
  ),
  "files.search": method(
    v.object({
      root,
      path: filePath,
      ...search,
      from: v.object({ line: integer(1), column: integer(0) }),
    }),
    shaped<{
      match?: TextSearchMatch;
      wrapped: boolean;
      revision: string;
    }>("files.search", {
      wrapped: "boolean",
      revision: "string",
    }),
  ),
  "files.searchWorkspace": method(
    v.object({
      root,
      folder: v.optional(relative),
      query: nonNulText,
      caseSensitive: v.boolean(),
      regex: v.optional(v.boolean()),
      maxResults: v.optional(integer(1, MAX_WORKSPACE_SEARCH_RESULTS)),
    }),
    shaped<{
      matches: WorkspaceSearchMatch[];
      truncated: boolean;
      fileCount: number;
    }>("files.searchWorkspace", {
      matches: "array",
      truncated: "boolean",
      fileCount: "number",
    }),
  ),
  "files.find": method(
    v.object({
      root,
      query: decoded((value) => text(value, "query", true)),
      ...listWindow,
    }),
    shaped<{ entries: FileEntry[]; hasMore: boolean }>("files.find", {
      entries: "array",
      hasMore: "boolean",
    }),
  ),
  "git.status": method(
    v.object({ root, ...listWindow }),
    shaped<{
      isRepository: boolean;
      repository?: GitRepositoryStatus;
      /** Entries are ordered staged, unstaged, untracked, conflict; `start` indexes that order. */
      counts: Record<GitChangeArea, number>;
      entries: GitChangeEntry[];
    }>("git.status", {
      isRepository: "boolean",
      counts: "object",
      entries: "array",
    }),
  ),
  "git.branches": method(
    v.object({ root }),
    shaped<{ current?: string; defaultBase?: string; branches: string[] }>(
      "git.branches",
      { branches: "array" },
    ),
  ),
  "git.branchChanges": method(
    v.object({ root, base: branchRef, ...listWindow }),
    shaped<{
      base: string;
      mergeBase?: string;
      total: number;
      entries: GitChangeEntry[];
    }>("git.branchChanges", {
      base: "string",
      total: "number",
      entries: "array",
    }),
  ),
  "git.history": method(
    v.object({ root, path: v.optional(nonNulText), ...listWindow }),
    shaped<{ commits: GitHistoryEntry[]; hasMore: boolean }>("git.history", {
      commits: "array",
      hasMore: "boolean",
    }),
  ),
  "git.commit": method(
    v.object({ root, hash }),
    shaped<{
      hash: string;
      author: string;
      authorTimeMs: number;
      parents: string[];
      message: string;
      messageNextOffset?: number;
    }>("git.commit", {
      hash: "string",
      parents: "array",
      message: "string",
    }),
  ),
  "git.commitMessage": method(
    v.object({ root, hash, offset: integer(0) }),
    shaped<{ text: string; nextOffset?: number }>("git.commitMessage", {
      text: "string",
    }),
  ),
  "git.commitFiles": method(
    v.object({ root, hash, parent: v.optional(hash), ...listWindow }),
    shaped<{ files: GitCommitFile[]; total: number }>("git.commitFiles", {
      files: "array",
      total: "number",
    }),
  ),
  "git.diffOpen": method(
    v.object({ root, source, refresh: v.optional(v.boolean()) }),
    shaped<{
      revision: string;
      totalRows: number;
      hunks?: number[];
      /** Start rows of Git patch hunks, in git.applyHunk index order. */
      patchHunks?: { row: number; fingerprint: string }[];
      info: GitDiffInfo;
      /** Unchanged rows far from any change: [startRow, rowCount]. */
      collapsed: Array<[number, number]>;
    }>("git.diffOpen", {
      revision: "string",
      totalRows: "number",
      info: "object",
      collapsed: "array",
    }),
  ),
  "git.diffSyntax": method(
    v.object({
      root,
      source,
      startRow: integer(0),
      rowCount: integer(1, MAX_SYNTAX_LINES),
    }),
    shaped<{
      language?: string;
      rows: { row: number; spans: SyntaxSpan[] }[];
      startRow: number;
      endRow: number;
      revision: string;
    }>("git.diffSyntax", {
      rows: "array",
      startRow: "number",
      endRow: "number",
      revision: "string",
    }),
  ),
  "git.diffRows": method(
    v.object({
      root,
      source,
      startRow: integer(0),
      rowCount: integer(1),
      byteLimit,
      continuation: v.optional(
        v.object({ row: integer(0), byteOffset: integer(0) }),
      ),
    }),
    shaped<{
      revision: string;
      totalRows: number;
      rows: GitDiffRow[];
      next?: { row: number; byteOffset: number };
    }>("git.diffRows", {
      revision: "string",
      totalRows: "number",
      rows: "array",
    }),
  ),
  "git.diffRead": method(
    v.object({ root, source, ...range }),
    shaped<{
      offset: number;
      nextOffset: number;
      bytesBase64: string;
      eof: boolean;
      revision: string;
    }>("git.diffRead", {
      offset: "number",
      nextOffset: "number",
      bytesBase64: "string",
      eof: "boolean",
      revision: "string",
    }),
  ),
  "git.imageInfo": method(
    v.object({ ...image }),
    shaped<{
      present: boolean;
      path: string;
      mimeType?: string;
      sizeBytes?: number;
      revision: string;
    }>("git.imageInfo", {
      present: "boolean",
      path: "string",
      revision: "string",
    }),
  ),
  "git.imageRead": method(
    v.object({ ...image, ...range }),
    shaped<{
      offset: number;
      nextOffset: number;
      bytesBase64: string;
      eof: boolean;
      sizeBytes: number;
      revision: string;
    }>("git.imageRead", {
      offset: "number",
      nextOffset: "number",
      bytesBase64: "string",
      eof: "boolean",
      sizeBytes: "number",
      revision: "string",
    }),
  ),
  "git.diffSearch": method(
    v.object({
      root,
      source,
      ...search,
      from: v.object({ row: integer(0), column: integer(0) }),
    }),
    shaped<{
      match?: GitDiffSearchMatch;
      wrapped: boolean;
      revision: string;
    }>("git.diffSearch", {
      wrapped: "boolean",
      revision: "string",
    }),
  ),
};

export type ReadMethod = keyof typeof readMethods;
export type ReadParamsByMethod = Params<typeof readMethods>;
export type ReadResultByMethod = Results<typeof readMethods>;
export const readResultSchemas: ResultSchemas<ReadResultByMethod> = readMethods;
export function isReadMethod(value: unknown): value is ReadMethod {
  return hasMethod(readMethods, value);
}
export function readOperationId(value: unknown) {
  return text(value, "operationId");
}
/** The Host's entry check for values received from a Client. */
export function parseReadRequest(value: unknown): ReadRequest {
  const input = record(value, "request");
  if (input.kind !== "request") return fail("reading request kind is invalid");
  if (!isReadMethod(input.method)) return fail("method is unsupported");
  return {
    kind: "request",
    operationId: readOperationId(input.operationId),
    method: input.method,
    params: parseValue(
      readMethods[input.method].params,
      record(input.params, "params"),
    ),
  } as ReadRequest;
}

const readingWatch = v.object({
  kind: v.literal("subscribe"),
  operationId: nonNulText,
  method: v.literal("reading.watch"),
  params: v.object({
    root: nonNulText,
    scope: v.picklist(["files", "file", "git"]),
  }),
});
export type ReadingWatchRequest = v.InferOutput<typeof readingWatch>;
export const parseReadingWatchRequest = schema(readingWatch).parse;
export function parseReadingChangedEvent(value: unknown): ReadingChangedEvent {
  const input = record(value, "reading change event");
  if (input.type !== "reading.changed") return fail("event type is invalid");
  const paths = Array.isArray(input.paths)
    ? input.paths.filter((path): path is string => typeof path === "string")
    : undefined;
  return {
    type: "reading.changed",
    operationId: readOperationId(input.operationId),
    root: text(input.root, "root"),
    ...(paths === undefined ? {} : { paths }),
  };
}
