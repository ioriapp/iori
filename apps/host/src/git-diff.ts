import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  GitDiffInfo,
  GitDiffRow,
  GitDiffRowKind,
  GitDiffSource,
  ReadMethod,
  ReadParamsByMethod,
  ReadResultByMethod,
} from "@iori/protocol";
import type { FileHandle } from "node:fs/promises";
import {
  ReadingFailure,
  errorCode,
  throwIfAborted,
  toFailure,
} from "./reading-failure.ts";
import { finishGit, gitFailure, startGit, stopGit } from "./git-process.ts";
import {
  checkpointFor,
  indexLines,
  lineEnd,
  newLineIndex,
  readAt,
  readLines,
  rememberLineStart,
  scanMatches,
  searchLines,
  seekLine,
  type LineIndex,
  type LineMatch,
  type RawLineChunk,
} from "./text-lines.ts";
import { isWithin } from "./files-reading.ts";
import type { Repository } from "./git-reading.ts";

type Signal = AbortSignal | undefined;
type LineState = { old: number; new: number };

/**
 * A stretch of the diff's rows. Hunk rows come from the row file the Host
 * wrote from Git's output. Gap rows are the unchanged lines between hunks;
 * they are read from the new side of the file only when someone looks at them.
 */
type Part = {
  kind: "hunk" | "gap";
  /** The first row, counted over the whole diff. */
  row: number;
  rows: number;
  /** The first row's line in its file: the row file or the new side. */
  line: number;
  /** For a hunk: where `line` starts in the row file. */
  offset: number;
  /** The old and new line numbers at the first row. */
  old: number;
  new: number;
};

/** The new side of a diff, as a file whose lines can be read by range. */
type NewSide = {
  lines: number;
  load: (signal?: Signal) => Promise<{ file: string; index: LineIndex }>;
};

type NewSideSource =
  { kind: "file"; path: string } | { kind: "blob"; spec: string };

/**
 * A diff that the Host split into rows. Only Git's hunks are kept in a
 * temporary file, one row per line, each starting with its unified-diff
 * marker; the rows of the whole file are numbered as if nothing were left out.
 */
type DiffDocument = {
  revision: string;
  file?: string;
  size: number;
  /** Lines in the row file. */
  lines: number;
  /** Rows of the whole diff, gaps included. */
  rows: number;
  index: LineIndex;
  /** The line numbers in effect at the row file's indexed lines. */
  states: Map<number, LineState>;
  parts: Part[];
  newSide?: NewSide;
  /** A blob written out to read its lines; deleted with the document. */
  newFile?: string;
  info: GitDiffInfo;
  collapsed: Array<[number, number]>;
};

// Git's context around each change; longer unchanged stretches are collapsed.
const CONTEXT = "--unified=3";
const MIN_COLLAPSED_ROWS = 3;
// The collapsed list is sent in one response. Past this many runs the rest stay visible.
const MAX_COLLAPSED_RUNS = 16_384;
// Recent diffs kept on disk for scrolling and searching; older ones are deleted.
const MAX_DOCUMENTS = 16;
const WRITE_BUFFER_BYTES = 256 * 1024;
const BINARY_PROBE_BYTES = 8000;
const LINK_MODES = new Set(["120000", "160000"]);

const MARK_CONTEXT = 0x20;
const MARK_ADDED = 0x2b;
const MARK_DELETED = 0x2d;
const MARK_NOTE = 0x5c;

let cacheDirectory: Promise<string> | undefined;
const documents = new Map<string, DiffDocument>();
const pending = new Map<string, Promise<DiffDocument>>();
const started = new Map<string, number>();
let generations = 0;

/** Clears the Host's previous diff files and keeps new ones under `directory`. */
export async function configureDiffCache(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  cacheDirectory = Promise.resolve(directory);
}

function directory(): Promise<string> {
  cacheDirectory ??= mkdtemp(join(tmpdir(), "iori-reading-"));
  return cacheDirectory;
}

function kindOf(marker: number | undefined): GitDiffRowKind {
  return marker === MARK_ADDED
    ? "added"
    : marker === MARK_DELETED
      ? "deleted"
      : marker === MARK_NOTE
        ? "note"
        : "context";
}

function advance(state: LineState, marker: number | undefined): void {
  if (marker === MARK_CONTEXT) {
    state.old += 1;
    state.new += 1;
  } else if (marker === MARK_ADDED) state.new += 1;
  else if (marker === MARK_DELETED) state.old += 1;
}

const common = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  CONTEXT,
];

/**
 * Checks a path in the worktree, which Git and the Host read from the OS,
 * against the repository: no folder on the way may lead outside it.
 */
async function worktreeTarget(repository: Repository, path: string) {
  const parts = path.split("/");
  let current = repository.root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const real = await realpath(current).catch(() => current);
    if (!isWithin(repository.root, real))
      throw new ReadingFailure(
        "path_outside_root",
        "Worktree path is outside the Git repository",
      );
  }
  const absolute = join(repository.root, ...parts);
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    throw toFailure(error);
  }
  if (info.isSymbolicLink()) {
    const target = await realpath(absolute).catch(() => undefined);
    if (target && !isWithin(repository.root, target))
      throw new ReadingFailure(
        "path_outside_root",
        "Link points outside the Git repository",
      );
    if (target && (await lstat(target)).isDirectory())
      return { absolute, directory: true, file: false };
  }
  return { absolute, directory: info.isDirectory(), file: info.isFile() };
}

async function commandFor(
  repository: Repository,
  source: GitDiffSource,
): Promise<
  | {
      args: string[];
      plain: boolean;
      accepted: number[];
      newSide?: NewSideSource;
    }
  | { directory: true }
> {
  const paths = source.kind === "stage" ? [] : [source.oldPath, source.path];
  const pathspec = ["--", ...paths.filter((path) => path !== undefined)];
  switch (source.kind) {
    case "change":
      if (source.area === "staged")
        return {
          args: ["diff", "--cached", "-M", ...common, ...pathspec],
          plain: false,
          accepted: [0],
          newSide: { kind: "blob", spec: `:0:${source.path}` },
        };
      if (source.area === "unstaged")
        return {
          args: ["diff", ...common, ...pathspec],
          plain: false,
          accepted: [0],
          newSide: { kind: "file", path: source.path },
        };
      {
        const target = await worktreeTarget(repository, source.path);
        if (target.directory) return { directory: true };
        return {
          args: [
            "diff",
            "--no-index",
            ...common,
            "--",
            process.platform === "win32" ? "NUL" : "/dev/null",
            target.absolute,
          ],
          plain: false,
          accepted: [0, 1],
        };
      }
    case "stage":
      return {
        args: ["cat-file", "blob", `:${source.stage}:${source.path}`],
        plain: true,
        accepted: [0],
      };
    case "commit":
      return {
        args: source.parent
          ? [
              "diff",
              "-M",
              ...common,
              "--end-of-options",
              source.parent,
              source.hash,
              ...pathspec,
            ]
          : [
              "diff-tree",
              "-p",
              "--root",
              "--no-commit-id",
              "-M",
              ...common,
              "--end-of-options",
              source.hash,
              ...pathspec,
            ],
        plain: false,
        accepted: [0],
        newSide: { kind: "blob", spec: `${source.hash}:${source.path}` },
      };
  }
}

/** Reads a header line; returns the mode of the new side when the line has it. */
function parseHeader(line: string, info: GitDiffInfo): string | undefined {
  let match: RegExpExecArray | null;
  if ((match = /^new file mode (\d+)/u.exec(line))) {
    info.newFile = true;
    info.newMode = match[1];
    return match[1];
  }
  if ((match = /^deleted file mode (\d+)/u.exec(line))) {
    info.deletedFile = true;
    info.oldMode = match[1];
  } else if ((match = /^old mode (\d+)/u.exec(line))) info.oldMode = match[1];
  else if ((match = /^new mode (\d+)/u.exec(line))) {
    info.newMode = match[1];
    return match[1];
  } else if ((match = /^index \S+ (\d+)$/u.exec(line))) return match[1];
  else if (/^Binary files /u.test(line) || line === "GIT binary patch")
    info.binary = true;
  return undefined;
}

/** Counts a blob's lines without keeping it. */
async function blobLines(
  repository: Repository,
  spec: string,
  signal?: Signal,
): Promise<number> {
  const git = startGit(repository.root, ["cat-file", "blob", spec], signal);
  let lineFeeds = 0;
  let finalByte = -1;
  try {
    for await (const value of git.child.stdout) {
      throwIfAborted(signal);
      const chunk = value as Buffer;
      for (let at = chunk.indexOf(10); at >= 0; at = chunk.indexOf(10, at + 1))
        lineFeeds += 1;
      if (chunk.length) finalByte = chunk[chunk.length - 1]!;
    }
    await finishGit(git, signal, [0]);
  } catch (error) {
    await stopGit(git);
    throw gitFailure(error);
  }
  return finalByte < 0 ? 0 : lineFeeds + (finalByte === 10 ? 0 : 1);
}

/** Writes a blob out once so that its lines can be read by range. */
async function writeBlob(
  repository: Repository,
  spec: string,
  file: string,
  signal?: Signal,
): Promise<LineIndex> {
  const output = await open(file, "w+", 0o600);
  const git = startGit(repository.root, ["cat-file", "blob", spec], signal);
  try {
    let size = 0;
    for await (const value of git.child.stdout) {
      throwIfAborted(signal);
      const chunk = value as Buffer;
      await output.write(chunk);
      size += chunk.length;
    }
    await finishGit(git, signal, [0]);
    return await indexLines(output, size, signal);
  } catch (error) {
    await stopGit(git);
    await rm(file, { force: true }).catch(() => undefined);
    throw gitFailure(error);
  } finally {
    await output.close().catch(() => undefined);
  }
}

async function newSideFor(
  repository: Repository,
  source: NewSideSource,
  document: DiffDocument,
  signal?: Signal,
): Promise<NewSide | undefined> {
  if (source.kind === "file") {
    const target = await worktreeTarget(repository, source.path);
    if (!target.file) return undefined;
    const handle = await open(target.absolute, "r");
    try {
      const index = await indexLines(
        handle,
        (await handle.stat()).size,
        signal,
      );
      const loaded = Promise.resolve({ file: target.absolute, index });
      return { lines: index.lines, load: () => loaded };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
  const lines = await blobLines(repository, source.spec, signal);
  let loaded: Promise<{ file: string; index: LineIndex }> | undefined;
  return {
    lines,
    load: (requestSignal) => {
      loaded ??= (async () => {
        const file = join(await directory(), `${document.revision}.new`);
        document.newFile = file;
        const index = await writeBlob(
          repository,
          source.spec,
          file,
          requestSignal,
        );
        return { file, index };
      })().catch((error: unknown) => {
        loaded = undefined;
        throw error;
      });
      return loaded;
    },
  };
}

/** Runs Git once and writes its hunks; the index allows reading any row later. */
async function generate(
  repository: Repository,
  source: GitDiffSource,
  signal?: Signal,
): Promise<DiffDocument> {
  const document: DiffDocument = {
    revision: randomUUID(),
    size: 0,
    lines: 0,
    rows: 0,
    index: newLineIndex(256),
    states: new Map([[1, { old: 1, new: 1 }]]),
    parts: [],
    info: {},
    collapsed: [],
  };
  const command = await commandFor(repository, source);
  if ("directory" in command) {
    document.info.directory = true;
    return document;
  }
  const file = join(await directory(), `${document.revision}.diff`);
  const output = await open(file, "w", 0o600);
  const git = startGit(repository.root, command.args, signal);
  let buffered: Buffer[] = [];
  let bufferedBytes = 0;
  const write = async (bytes: Buffer) => {
    buffered.push(bytes);
    bufferedBytes += bytes.length;
    document.size += bytes.length;
    if (bufferedBytes >= WRITE_BUFFER_BYTES) {
      const data = Buffer.concat(buffered, bufferedBytes);
      buffered = [];
      bufferedBytes = 0;
      await output.write(data);
    }
  };

  // The next old and new line numbers.
  const state: LineState = { old: 1, new: 1 };
  let hunk: Part | undefined;
  let newMode: string | undefined;
  let inRows = command.plain;
  let atLineStart = true;
  let lineType: "row" | "header" | "hunk" | "other" = "other";
  let header: Buffer[] = [];
  let headerBytes = 0;
  let probed = !command.plain;
  const addGap = (rows: number) => {
    if (rows <= 0) return;
    document.parts.push({
      kind: "gap",
      row: document.rows,
      rows,
      line: state.new,
      offset: 0,
      old: state.old,
      new: state.new,
    });
    if (
      rows >= MIN_COLLAPSED_ROWS &&
      document.collapsed.length < MAX_COLLAPSED_RUNS
    )
      document.collapsed.push([document.rows, rows]);
    document.rows += rows;
    state.old += rows;
    state.new += rows;
  };
  const beginRow = async (marker: number) => {
    const line = document.lines + 1;
    if (!hunk) {
      hunk = {
        kind: "hunk",
        row: document.rows,
        rows: 0,
        line,
        offset: document.size,
        old: state.old,
        new: state.new,
      };
      document.parts.push(hunk);
    }
    rememberLineStart(document.index, line, document.size, (dropped) =>
      document.states.delete(dropped),
    );
    if (document.index.offsets.get(line) === document.size)
      document.states.set(line, { ...state });
    hunk.rows += 1;
    document.lines += 1;
    document.rows += 1;
    advance(state, marker);
    if (command.plain) await write(Buffer.of(MARK_CONTEXT));
  };
  const endLine = () => {
    const text = Buffer.concat(header, headerBytes)
      .toString("utf8")
      .replace(/\r?\n$/u, "");
    if (lineType === "header")
      newMode = parseHeader(text, document.info) ?? newMode;
    else if (lineType === "hunk") {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(text);
      if (match) {
        // An empty range names the line before it.
        const oldBegin = Number(match[1]) + (match[2] === "0" ? 1 : 0);
        const newBegin = Number(match[3]) + (match[4] === "0" ? 1 : 0);
        addGap(newBegin - state.new);
        state.old = oldBegin;
        state.new = newBegin;
        hunk = undefined;
        inRows = true;
      }
    }
    header = [];
    headerBytes = 0;
    atLineStart = true;
  };

  try {
    for await (const value of git.child.stdout) {
      throwIfAborted(signal);
      const chunk = value as Buffer;
      if (!probed) {
        probed = true;
        if (chunk.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
          document.info.binary = true;
          break;
        }
      }
      let at = 0;
      while (at < chunk.length) {
        const newline = chunk.indexOf(10, at);
        const end = newline < 0 ? chunk.length : newline + 1;
        const segment = chunk.subarray(at, end);
        if (atLineStart) {
          atLineStart = false;
          const first = segment[0]!;
          if (command.plain) {
            lineType = "row";
            await beginRow(MARK_CONTEXT);
          } else if (first === 0x40) lineType = "hunk";
          else if (
            inRows &&
            (first === MARK_CONTEXT ||
              first === MARK_ADDED ||
              first === MARK_DELETED ||
              first === MARK_NOTE)
          ) {
            lineType = "row";
            await beginRow(first);
          } else lineType = inRows ? "other" : "header";
        }
        if (lineType === "row") await write(segment);
        else if (lineType !== "other" && headerBytes < 65_536) {
          header.push(segment);
          headerBytes += segment.length;
        }
        if (newline >= 0) endLine();
        at = end;
      }
    }
    if (!atLineStart && lineType === "row") await write(Buffer.of(10));
    if (document.info.binary && command.plain) await stopGit(git);
    else await finishGit(git, signal, command.accepted);
    if (bufferedBytes)
      await output.write(Buffer.concat(buffered, bufferedBytes));
    document.index.lines = document.lines;
    document.file = file;
    if (document.info.binary) {
      document.rows = document.lines = document.index.lines = 0;
      document.parts = [];
      document.collapsed = [];
    } else if (
      command.newSide &&
      document.parts.length > 0 &&
      !document.info.newFile &&
      !document.info.deletedFile &&
      !(newMode && LINK_MODES.has(newMode))
    ) {
      // The unchanged lines after the last hunk: the new side's line count says how many.
      const newSide = await newSideFor(
        repository,
        command.newSide,
        document,
        signal,
      ).catch(() => {
        // Without a readable new side the diff still shows every change.
        throwIfAborted(signal);
        return undefined;
      });
      if (newSide) {
        document.newSide = newSide;
        addGap(newSide.lines - (state.new - 1));
      }
    }
    return document;
  } catch (error) {
    await stopGit(git);
    await rm(file, { force: true }).catch(() => undefined);
    throw gitFailure(error);
  } finally {
    await output.close().catch(() => undefined);
  }
}

function release(document: DiffDocument | undefined): void {
  for (const file of [document?.file, document?.newFile])
    if (file) void rm(file, { force: true }).catch(() => undefined);
}

async function documentFor(
  repository: Repository,
  source: GitDiffSource,
  refresh: boolean,
  signal?: Signal,
): Promise<DiffDocument> {
  const key = JSON.stringify([repository.root, source]);
  if (!refresh) {
    const cached = documents.get(key);
    if (cached) {
      documents.delete(key);
      documents.set(key, cached);
      return cached;
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
  }
  const order = ++generations;
  started.set(key, order);
  const generation = generate(repository, source, signal).then((document) => {
    // A newer refresh of the same diff wins even if this one finishes later.
    if (started.get(key) !== order) {
      release(document);
      return documentFor(repository, source, false, signal);
    }
    const previous = documents.get(key);
    documents.delete(key);
    if (previous !== document) release(previous);
    documents.set(key, document);
    while (documents.size > MAX_DOCUMENTS) {
      const oldest = documents.keys().next().value!;
      release(documents.get(oldest));
      documents.delete(oldest);
      started.delete(oldest);
    }
    return document;
  });
  pending.set(key, generation);
  try {
    return await generation;
  } finally {
    if (pending.get(key) === generation) pending.delete(key);
  }
}

export async function handleDiffRead<M extends ReadMethod>(
  repository: Repository,
  method: M,
  params: ReadParamsByMethod[M],
  signal?: Signal,
): Promise<ReadResultByMethod[M]> {
  const { source } = params as { source: GitDiffSource };
  if (method === "git.diffOpen") {
    const document = await documentFor(
      repository,
      source,
      (params as ReadParamsByMethod["git.diffOpen"]).refresh === true,
      signal,
    );
    return {
      revision: document.revision,
      totalRows: document.rows,
      info: document.info,
      collapsed: document.collapsed,
    } as ReadResultByMethod[M];
  }
  let document = await documentFor(repository, source, false, signal);
  try {
    return await readDocument(document, method, params, signal);
  } catch (error) {
    // A newer refresh replaced this file while the request was starting.
    if (errorCode(error) !== "ENOENT") throw toFailure(error);
    document = await documentFor(repository, source, false, signal);
    return readDocument(document, method, params, signal);
  }
}

/** The part holding `row`. */
function partAt(document: DiffDocument, row: number): number {
  let low = 0;
  let high = document.parts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (document.parts[middle]!.row <= row) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Open files of one request; each is opened when first needed. */
class Files {
  #document: DiffDocument;
  #signal: Signal;
  #rows?: Promise<{ handle: FileHandle; size: number }>;
  #newSide?: Promise<{
    handle: FileHandle;
    size: number;
    index: LineIndex;
  }>;
  #opened: FileHandle[] = [];

  constructor(document: DiffDocument, signal: Signal) {
    this.#document = document;
    this.#signal = signal;
  }

  rows() {
    this.#rows ??= this.#open(this.#document.file!).then(async (handle) => ({
      handle,
      size: this.#document.size,
    }));
    return this.#rows;
  }

  newSide() {
    this.#newSide ??= (async () => {
      const side = this.#document.newSide;
      if (!side)
        throw new ReadingFailure("read_failed", "The new side is not readable");
      const { file, index } = await side.load(this.#signal);
      const handle = await this.#open(file);
      return { handle, size: (await handle.stat()).size, index };
    })();
    return this.#newSide;
  }

  async #open(file: string) {
    const handle = await open(file, "r");
    this.#opened.push(handle);
    return handle;
  }

  async close() {
    await Promise.all(
      [this.#rows, this.#newSide].map((opened) =>
        opened?.catch(() => undefined),
      ),
    );
    await Promise.all(
      this.#opened.map((handle) => handle.close().catch(() => undefined)),
    );
  }
}

/** Where a row's line starts in its file, and the line numbers in effect there. */
async function locate(
  files: Files,
  document: DiffDocument,
  part: Part,
  row: number,
  signal?: Signal,
): Promise<{
  handle: FileHandle;
  size: number;
  offset: number;
  state: LineState;
}> {
  const line = part.line + (row - part.row);
  if (part.kind === "gap") {
    const { handle, size, index } = await files.newSide();
    const base = checkpointFor(index, line);
    const offset = await seekLine(
      handle,
      size,
      { line: base, offset: index.offsets.get(base) ?? 0 },
      line,
      signal,
    );
    return {
      handle,
      size,
      offset,
      state: {
        old: part.old + (row - part.row),
        new: part.new + (row - part.row),
      },
    };
  }
  const { handle, size } = await files.rows();
  let base = checkpointFor(document.index, line);
  let from = document.index.offsets.get(base);
  let state = document.states.get(base);
  if (base <= part.line || from === undefined || state === undefined) {
    base = part.line;
    from = part.offset;
    state = { old: part.old, new: part.new };
  }
  const current = { ...state };
  const offset = await seekLine(
    handle,
    size,
    { line: base, offset: from },
    line,
    signal,
    (marker) => advance(current, marker),
  );
  return { handle, size, offset, state: current };
}

/** Row file offsets are kept; new-side offsets come after the row file's end. */
function shift(document: DiffDocument, part: Part): number {
  return part.kind === "gap" ? document.size : 0;
}

async function readRows(
  files: Files,
  document: DiffDocument,
  value: ReadParamsByMethod["git.diffRows"],
  signal?: Signal,
): Promise<{ rows: GitDiffRow[]; next?: { row: number; byteOffset: number } }> {
  const rows: GitDiffRow[] = [];
  let row = value.startRow;
  let budget = value.byteLimit;
  for (
    let at = partAt(document, row);
    at < document.parts.length && row < value.startRow + value.rowCount;
    at += 1
  ) {
    const part = document.parts[at]!;
    if (row >= part.row + part.rows) continue;
    const base = shift(document, part);
    const found = await locate(files, document, part, row, signal);
    const continuation =
      rows.length === 0 && value.continuation?.row === value.startRow;
    const marker =
      continuation && part.kind === "hunk"
        ? (await readAt(found.handle, found.offset, 1))[0]
        : undefined;
    const line = part.line + (row - part.row);
    const result = await readLines(found.handle, found.size, {
      startLine: line,
      startOffset: continuation
        ? value.continuation!.byteOffset - base
        : found.offset,
      lineCount: Math.min(
        value.startRow + value.rowCount - row,
        part.row + part.rows - row,
      ),
      byteLimit: budget,
      totalLines: part.line + part.rows - 1,
      prefix: part.kind === "hunk",
      continuation,
      ...(marker === undefined ? {} : { continuationMarker: marker }),
    });
    let chunks: RawLineChunk[] = result.lines;
    // A line that does not fit in what is left of the budget starts the next request.
    if (rows.length > 0 && chunks[0] && !chunks[0].complete) chunks = [];
    const state = found.state;
    for (const chunk of chunks) {
      const marker = part.kind === "hunk" ? chunk.marker : MARK_CONTEXT;
      const kind = kindOf(marker);
      rows.push({
        row: part.row + (chunk.line - part.line),
        kind,
        ...(kind === "context" || kind === "deleted"
          ? { oldLine: state.old }
          : {}),
        ...(kind === "context" || kind === "added"
          ? { newLine: state.new }
          : {}),
        text: chunk.text,
        byteOffset: base + chunk.byteOffset,
        nextByteOffset: base + chunk.nextByteOffset,
        complete: chunk.complete,
        ...(chunk.complete
          ? {}
          : {
              lineEnd:
                base +
                (await lineEnd(
                  found.handle,
                  found.size,
                  chunk.nextByteOffset,
                  signal,
                )),
            }),
      });
      advance(state, marker);
      budget -= chunk.nextByteOffset - chunk.byteOffset;
    }
    const last = chunks.at(-1);
    if (!last) break;
    if (result.next && chunks.length === result.lines.length)
      return {
        rows,
        next: {
          row: part.row + (result.next.line - part.line),
          byteOffset: base + result.next.byteOffset,
        },
      };
    row = part.row + (last.line - part.line) + 1;
    // The budget ran out inside this part.
    if (row < part.row + part.rows || budget <= 0) break;
  }
  return { rows };
}

function emptyResult(document: DiffDocument, method: ReadMethod) {
  return method === "git.diffRows"
    ? { revision: document.revision, totalRows: 0, rows: [] }
    : method === "git.diffRead"
      ? {
          offset: 0,
          nextOffset: 0,
          bytesBase64: "",
          eof: true,
          revision: document.revision,
        }
      : { wrapped: false, revision: document.revision };
}

async function readDocument<M extends ReadMethod>(
  document: DiffDocument,
  method: M,
  params: ReadParamsByMethod[M],
  signal?: Signal,
): Promise<ReadResultByMethod[M]> {
  if (!document.file || document.rows === 0)
    return emptyResult(document, method) as ReadResultByMethod[M];
  const files = new Files(document, signal);
  try {
    switch (method) {
      case "git.diffRows": {
        const value = params as ReadParamsByMethod["git.diffRows"];
        const result = await readRows(files, document, value, signal);
        return {
          revision: document.revision,
          totalRows: document.rows,
          ...result,
        } as ReadResultByMethod[M];
      }
      case "git.diffRead": {
        const value = params as ReadParamsByMethod["git.diffRead"];
        const gap = value.offset >= document.size;
        const { handle, size } = gap
          ? await files.newSide()
          : await files.rows();
        const offset = value.offset - (gap ? document.size : 0);
        const bytes = await readAt(
          handle,
          offset,
          Math.min(value.length, Math.max(0, size - offset)),
        );
        return {
          offset: value.offset,
          nextOffset: value.offset + bytes.length,
          bytesBase64: bytes.toString("base64"),
          eof: offset + bytes.length >= size,
          revision: document.revision,
        } as ReadResultByMethod[M];
      }
      case "git.diffSearch": {
        const value = params as ReadParamsByMethod["git.diffSearch"];
        const result = await searchLines(
          (startLine, endLine, visit) =>
            scanParts(
              files,
              document,
              startLine - 1,
              endLine - 1,
              value,
              visit,
              signal,
            ),
          document.rows,
          {
            direction: value.direction,
            from: { line: value.from.row + 1, column: value.from.column },
          },
        );
        return {
          ...(result.match
            ? {
                match: {
                  row: result.match.line - 1,
                  column: result.match.column,
                  length: result.match.length,
                  byteOffset: result.match.byteOffset,
                  byteLength: result.match.byteLength,
                },
              }
            : {}),
          wrapped: result.wrapped,
          revision: document.revision,
        } as ReadResultByMethod[M];
      }
      default:
        throw new ReadingFailure("invalid_request", "Not a diff request");
    }
  } finally {
    await files.close();
  }
}

/** Streams the matches in rows `first`..`end` (exclusive), across hunks and gaps. */
async function scanParts(
  files: Files,
  document: DiffDocument,
  first: number,
  end: number,
  options: { query: string; caseSensitive: boolean },
  visit: (match: LineMatch) => boolean,
  signal?: Signal,
): Promise<boolean> {
  for (let at = partAt(document, first); at < document.parts.length; at += 1) {
    const part = document.parts[at]!;
    if (part.row >= end) break;
    const from = Math.max(first, part.row);
    const to = Math.min(end, part.row + part.rows);
    if (from >= to) continue;
    const found = await locate(files, document, part, from, signal);
    const line = part.line + (from - part.row);
    const base = shift(document, part);
    const stopped = await scanMatches(
      found.handle,
      found.size,
      {
        startLine: line,
        startOffset: found.offset,
        endLine: line + (to - from),
      },
      {
        ...options,
        ...(part.kind === "hunk"
          ? {
              prefix: true,
              skipMarker: (marker: number) => marker === MARK_NOTE,
            }
          : {}),
      },
      (match) =>
        visit({
          ...match,
          line: part.row + (match.line - part.line) + 1,
          byteOffset: base + match.byteOffset,
        }),
      signal,
    );
    if (stopped) return true;
  }
  return false;
}
