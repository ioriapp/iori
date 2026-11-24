import { createHash, randomUUID, type Hash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { MAX_PAGE_RESPONSE_BYTES, type SyntaxLine } from "@iori/protocol";
import type {
  GitDiffInfo,
  GitDiffRow,
  GitDiffRowKind,
  GitDiffSource,
  GitImageSide,
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
import {
  collectGit,
  finishGit,
  gitFailure,
  startGit,
  stopGit,
} from "./git-process.ts";
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
import {
  handleFileRead,
  revisionFor,
  isWithin,
  MIME_BY_EXTENSION,
} from "./files-reading.ts";
import { readBufferSyntax, MAX_SYNTAX_FILE_BYTES } from "./files-syntax.ts";
import { syntaxLanguage } from "./files-syntax-language.ts";
import { branchMergeBase, type Repository } from "./git-reading.ts";
import { createConcurrencyLimiter } from "./resource-limits.ts";

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
  load: (
    signal?: Signal,
  ) => Promise<{ file: string; index: LineIndex; revision?: string }>;
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
  scratchBytes: number;
  readers: number;
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
  imageFiles?: Map<string, Promise<string>>;
  info: GitDiffInfo;
  collapsed: Array<[number, number]>;
  hunks: number[];
  patchHunks?: { row: number; fingerprint: string }[];
  mergeBase?: string;
  worktreeRevision?: string;
  oldBlob?: string;
  newBlob?: string;
};

// Git's context around each change; longer unchanged stretches are collapsed.
const CONTEXT = "--unified=3";
const MIN_COLLAPSED_ROWS = 3;
// The collapsed list is sent in one response. Past this many runs the rest stay visible.
const MAX_HUNKS = 4096;
const MAX_COLLAPSED_RUNS = 16_384;
// Recent diffs kept on disk for scrolling and searching; older ones are deleted.
const MAX_DOCUMENTS = 16;
const MAX_SCRATCH_BYTES = 64 * 1024 * 1024;
const runDiff = createConcurrencyLimiter(4);
const WRITE_BUFFER_BYTES = 256 * 1024;
const BINARY_PROBE_BYTES = 8000;
const LINK_MODES = new Set(["120000", "160000"]);

const MARK_CONTEXT = 0x20;
const MARK_ADDED = 0x2b;
const MARK_DELETED = 0x2d;
const MARK_NOTE = 0x5c;

let cacheDirectory: Promise<string> | undefined;
type CachedDiff = {
  document?: DiffDocument;
  pending?: Promise<DiffDocument>;
  lookups: number;
  replaced: Set<DiffDocument>;
};
const documents = new Map<string, CachedDiff>();

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

export const gitPatchOptions = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--full-index",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  CONTEXT,
];

/**
 * Checks a path in the worktree, which Git and the Host read from the OS,
 * against the repository: no folder on the way may lead outside it.
 */
async function worktreeTarget(
  repository: Repository,
  path: string,
  tracked = false,
) {
  if (process.platform === "win32" && path.includes("\\")) {
    throw new ReadingFailure(
      "path_outside_root",
      "Worktree paths must use slash separators",
    );
  }
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
    info = await lstat(absolute, { bigint: true });
  } catch (error) {
    throw toFailure(error);
  }
  if (info.isSymbolicLink()) {
    if (tracked) return { absolute, directory: false, file: false };
    const target = await realpath(absolute).catch(() => undefined);
    if (target && !isWithin(repository.root, target))
      throw new ReadingFailure(
        "path_outside_root",
        "Link points outside the Git repository",
      );
    if (target && (await lstat(target)).isDirectory())
      return { absolute, directory: true, file: false };
  }
  return {
    absolute,
    directory: info.isDirectory(),
    file: info.isFile(),
    revision: revisionFor(info),
  };
}

async function commandFor(
  repository: Repository,
  source: GitDiffSource,
  signal?: Signal,
): Promise<
  | {
      args: string[];
      plain: boolean;
      accepted: number[];
      newSide?: NewSideSource;
      worktreeRevision?: string;
      mergeBase?: string;
    }
  | { directory: true }
> {
  const paths = source.kind === "stage" ? [] : [source.oldPath, source.path];
  const pathspec = ["--", ...paths.filter((path) => path !== undefined)];
  if (
    (source.kind === "branch" && source.untracked) ||
    (source.kind === "change" && source.area === "untracked")
  ) {
    const target = await worktreeTarget(repository, source.path);
    if (target.directory) return { directory: true };
    return {
      args: [
        "diff",
        "--no-index",
        ...gitPatchOptions,
        "--",
        process.platform === "win32" ? "NUL" : "/dev/null",
        target.absolute,
      ],
      plain: false,
      accepted: [0, 1],
      worktreeRevision: target.file ? target.revision : undefined,
    };
  }
  if (
    source.kind === "branch" ||
    (source.kind === "change" && source.area === "unstaged")
  ) {
    const mergeBase =
      source.kind === "branch"
        ? await branchMergeBase(repository, source.base, signal)
        : undefined;
    const target = await worktreeTarget(repository, source.path, true).catch(
      (error: unknown) => {
        if (error instanceof ReadingFailure && error.code === "path_not_found")
          return undefined;
        throw error;
      },
    );
    return {
      args: [
        "diff",
        ...(mergeBase ? ["-M"] : []),
        ...gitPatchOptions,
        ...(mergeBase ? ["--end-of-options", mergeBase] : []),
        ...pathspec,
      ],
      plain: false,
      accepted: [0],
      mergeBase,
      newSide: target?.file ? { kind: "file", path: source.path } : undefined,
      worktreeRevision: target?.file ? target.revision : undefined,
    };
  }
  switch (source.kind) {
    case "change":
      return {
        args: ["diff", "--cached", "-M", ...gitPatchOptions, ...pathspec],
        plain: false,
        accepted: [0],
        newSide: { kind: "blob", spec: `:0:${source.path}` },
      };
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
              ...gitPatchOptions,
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
              ...gitPatchOptions,
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
): Promise<{ index: LineIndex; size: number }> {
  const output = await open(file, "w+", 0o600);
  let git: ReturnType<typeof startGit> | undefined;
  try {
    git = startGit(repository.root, ["cat-file", "blob", spec], signal);
    let size = 0;
    for await (const value of git.child.stdout) {
      throwIfAborted(signal);
      const chunk = value as Buffer;
      await output.write(chunk);
      size += chunk.length;
    }
    await finishGit(git, signal, [0]);
    return { index: await indexLines(output, size, signal), size };
  } catch (error) {
    if (git) await stopGit(git);
    await output.close().catch(() => undefined);
    await removeScratch(file);
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
      const loaded = Promise.resolve({
        file: target.absolute,
        index,
        revision: document.worktreeRevision,
      });
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
      loaded ??= runDiff(async () => {
        const file = join(await directory(), `${document.revision}.new`);
        const { index, size } = await writeBlob(
          repository,
          source.spec,
          file,
          requestSignal,
        );
        document.newFile = file;
        document.scratchBytes += size;
        return { file, index };
      }, requestSignal).catch((error: unknown) => {
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
    scratchBytes: 0,
    readers: 0,
    lines: 0,
    rows: 0,
    index: newLineIndex(256),
    states: new Map([[1, { old: 1, new: 1 }]]),
    parts: [],
    info: {},
    collapsed: [],
    hunks: [],
    ...(source.kind === "change" &&
    (source.area === "staged" || source.area === "unstaged") &&
    !source.oldPath
      ? { patchHunks: [] }
      : {}),
  };
  const command = await commandFor(repository, source, signal);
  if ("directory" in command) {
    document.info.directory = true;
    return document;
  }
  document.mergeBase = command.mergeBase;
  document.worktreeRevision = command.worktreeRevision;
  const file = join(await directory(), `${document.revision}.diff`);
  const output = await open(file, "w", 0o600);
  let git: ReturnType<typeof startGit> | undefined;
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
  let patchHash: Hash | undefined;
  let patchRow: number | undefined;
  const finishPatchHunk = () => {
    if (patchHash && patchRow !== undefined)
      document.patchHunks!.push({
        row: patchRow,
        fingerprint: patchHash.digest("hex"),
      });
    patchHash = undefined;
    patchRow = undefined;
  };
  let changing = false;
  const addGap = (rows: number) => {
    if (rows <= 0) return;
    changing = false;
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
    const changed = marker === MARK_ADDED || marker === MARK_DELETED;
    if (changed && !changing && document.hunks.length < MAX_HUNKS)
      document.hunks.push(document.rows);
    changing = changed;
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
    if (lineType === "header") {
      newMode = parseHeader(text, document.info) ?? newMode;
      const blobs = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/u.exec(text);
      if (blobs) {
        document.oldBlob = blobs[1];
        document.newBlob = blobs[2];
      }
    } else if (lineType === "hunk") {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(text);
      if (match) {
        // An empty range names the line before it.
        const oldBegin = Number(match[1]) + (match[2] === "0" ? 1 : 0);
        const newBegin = Number(match[3]) + (match[4] === "0" ? 1 : 0);
        addGap(newBegin - state.new);
        if (patchHash) patchRow = document.rows;
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
    git = startGit(repository.root, command.args, signal);
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
          if (first === 0x40 || first === 0x64) {
            finishPatchHunk();
            if (
              first === 0x40 &&
              document.patchHunks &&
              document.patchHunks.length < MAX_HUNKS
            )
              patchHash = createHash("sha256");
          }
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
        patchHash?.update(segment);
        if (lineType === "row") await write(segment);
        else if (lineType !== "other" && headerBytes < 65_536) {
          header.push(segment);
          headerBytes += segment.length;
        }
        if (newline >= 0) endLine();
        at = end;
      }
    }
    finishPatchHunk();
    if (!atLineStart && lineType === "row") await write(Buffer.of(10));
    if (document.info.binary && command.plain) await stopGit(git);
    else await finishGit(git, signal, command.accepted);
    if (bufferedBytes)
      await output.write(Buffer.concat(buffered, bufferedBytes));
    document.index.lines = document.lines;
    document.file = file;
    document.scratchBytes = document.size;
    if (document.info.binary) {
      document.rows = document.lines = document.index.lines = 0;
      document.parts = [];
      document.collapsed = [];
      document.hunks = [];
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
        command.newSide.kind === "blob" && document.newBlob
          ? { kind: "blob", spec: document.newBlob }
          : command.newSide,
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
    if (git) await stopGit(git);
    await output.close().catch(() => undefined);
    await removeScratch(file);
    throw gitFailure(error);
  } finally {
    await output.close().catch(() => undefined);
  }
}

async function removeScratch(file: string): Promise<void> {
  try {
    await rm(file, { force: true });
  } catch (error) {
    console.error(
      "Git diff scratch file could not be removed",
      errorCode(error),
    );
  }
}

async function release(document: DiffDocument): Promise<void> {
  const images = await Promise.allSettled(document.imageFiles?.values() ?? []);
  const files = [document.file, document.newFile];
  for (const result of images)
    if (result.status === "fulfilled") files.push(result.value);
  await Promise.all(files.map((file) => file && removeScratch(file)));
}

async function trimDiffCache(): Promise<void> {
  const cached = [...documents].filter(([, entry]) => entry.document);
  let count = cached.length;
  let bytes = cached.reduce(
    (sum, [, entry]) => sum + entry.document!.scratchBytes,
    0,
  );
  const evicted: DiffDocument[] = [];
  for (const [key, entry] of cached) {
    // Retain one recent diff so even a single file larger than the entire
    // cache can keep its revision between requests for rows, search and copy.
    if (
      count <= MAX_DOCUMENTS &&
      (bytes <= MAX_SCRATCH_BYTES || entry === cached.at(-1)?.[1])
    )
      break;
    const document = entry.document!;
    if (entry.lookups > 0 || document.readers > 0) continue;
    documents.delete(key);
    evicted.push(document);
    count -= 1;
    bytes -= document.scratchBytes;
  }
  await Promise.all(evicted.map(release));
}

function documentFor(
  entry: CachedDiff,
  repository: Repository,
  source: GitDiffSource,
  refresh: boolean,
  signal?: Signal,
): Promise<DiffDocument> {
  if (!refresh) {
    if (entry.document) return Promise.resolve(entry.document);
    if (entry.pending) return entry.pending;
  }
  const generation: Promise<DiffDocument> = runDiff(
    () => generate(repository, source, signal),
    signal,
  )
    .then(async (document) => {
      // A newer refresh wins even if this generation finishes later.
      if (entry.pending !== generation) {
        await release(document);
        return (
          entry.pending ?? documentFor(entry, repository, source, false, signal)
        );
      }
      if (entry.document) entry.replaced.add(entry.document);
      entry.document = document;
      return document;
    })
    .finally(() => {
      if (entry.pending === generation) entry.pending = undefined;
    });
  entry.pending = generation;
  return generation;
}

async function withDocument<T>(
  repository: Repository,
  source: GitDiffSource,
  refresh: boolean,
  signal: Signal,
  read: (document: DiffDocument) => T | Promise<T>,
): Promise<T> {
  const key = JSON.stringify([repository.root, source]);
  const entry = documents.get(key) ?? {
    lookups: 0,
    replaced: new Set<DiffDocument>(),
  };
  documents.delete(key);
  documents.set(key, entry);
  entry.lookups += 1;
  let document: DiffDocument | undefined;
  try {
    try {
      document = await documentFor(entry, repository, source, refresh, signal);
      document.readers += 1;
    } finally {
      entry.lookups -= 1;
    }
    throwIfAborted(signal);
    return await read(document);
  } finally {
    if (document) document.readers -= 1;
    if (entry.lookups === 0) {
      const unused = [...entry.replaced].filter((diff) => diff.readers === 0);
      for (const diff of unused) entry.replaced.delete(diff);
      if (!entry.document && !entry.pending) documents.delete(key);
      await Promise.all(unused.map(release));
    }
    await trimDiffCache();
  }
}

export async function handleDiffRead<M extends ReadMethod>(
  repository: Repository,
  method: M,
  params: ReadParamsByMethod[M],
  signal?: Signal,
): Promise<ReadResultByMethod[M]> {
  const { source } = params as { source: GitDiffSource };
  if (method === "git.imageInfo" || method === "git.imageRead")
    return handleImageRead(
      repository,
      method,
      params as ReadParamsByMethod["git.imageRead"],
      signal,
    ) as Promise<ReadResultByMethod[M]>;
  if (method === "git.diffOpen") {
    return withDocument(
      repository,
      source,
      (params as ReadParamsByMethod["git.diffOpen"]).refresh === true,
      signal,
      (document) =>
        ({
          revision: document.revision,
          totalRows: document.rows,
          info: document.info,
          collapsed: document.collapsed,
          hunks: document.hunks,
          patchHunks: document.patchHunks,
        }) as ReadResultByMethod[M],
    );
  }
  return withDocument(repository, source, false, signal, async (document) => {
    try {
      if (method === "git.diffSyntax")
        return (await diffSyntax(
          repository,
          document,
          params as ReadParamsByMethod["git.diffSyntax"],
          signal,
        )) as ReadResultByMethod[M];
      return await readDocument(document, method, params, signal);
    } catch (error) {
      throw toFailure(error);
    }
  });
}

/** Resolve each side from the comparison, keeping paths relative to the repository. */
function contentSource(
  source: GitDiffSource,
  side: GitImageSide,
  mergeBase?: string,
):
  | { kind: "missing"; path: string }
  | { kind: "file"; path: string }
  | { kind: "blob"; path: string; spec: string } {
  if (source.kind === "stage")
    return {
      kind: "blob",
      path: source.path,
      spec: `:${source.stage}:${source.path}`,
    };
  const path =
    side === "old" && (source.kind !== "change" || source.area === "staged")
      ? (source.oldPath ?? source.path)
      : source.path;
  if (source.kind === "branch") {
    if (side === "new") return { kind: "file", path };
    return source.untracked
      ? { kind: "missing", path }
      : { kind: "blob", path, spec: `${mergeBase}:${path}` };
  }
  if (source.kind === "commit")
    return {
      kind: "blob",
      path,
      spec: `${side === "old" ? (source.parent ?? `${source.hash}^`) : source.hash}:${path}`,
    };
  if (source.area === "untracked")
    return side === "old" ? { kind: "missing", path } : { kind: "file", path };
  if (source.area === "unstaged")
    return side === "old"
      ? { kind: "blob", path, spec: `:0:${path}` }
      : { kind: "file", path };
  return {
    kind: "blob",
    path,
    spec: side === "old" ? `HEAD:${path}` : `:0:${path}`,
  };
}

async function handleImageRead(
  repository: Repository,
  method: "git.imageInfo" | "git.imageRead",
  value: ReadParamsByMethod["git.imageRead"],
  signal?: Signal,
): Promise<
  ReadResultByMethod["git.imageInfo"] | ReadResultByMethod["git.imageRead"]
> {
  if (value.source.kind === "stage")
    throw new ReadingFailure("invalid_request", "Stage images are unsupported");
  const base =
    value.source.kind === "branch" &&
    !value.source.untracked &&
    value.side === "old"
      ? await branchMergeBase(repository, value.source.base, signal)
      : undefined;
  const source = contentSource(value.source, value.side, base);
  const mimeType = MIME_BY_EXTENSION[extname(source.path).toLowerCase()];
  const missing = () => {
    if (method === "git.imageRead")
      throw new ReadingFailure("path_not_found", "Image side does not exist");
    return {
      present: false,
      path: source.path,
      ...(mimeType ? { mimeType } : {}),
      revision: "",
    };
  };
  if (source.kind === "missing") return missing();
  if (source.kind === "file") {
    try {
      const result = await handleFileRead(
        "files.read",
        {
          root: repository.root,
          path: source.path,
          offset: method === "git.imageRead" ? value.offset : 0,
          length: method === "git.imageRead" ? value.length : 1,
        },
        signal,
      );
      return method === "git.imageRead"
        ? result
        : {
            present: true,
            path: source.path,
            ...(mimeType ? { mimeType } : {}),
            sizeBytes: result.sizeBytes,
            revision: result.revision,
          };
    } catch (error) {
      if (error instanceof ReadingFailure && error.code === "path_not_found")
        return missing();
      throw error;
    }
  }
  const resolved = await collectGit(
    repository.root,
    ["rev-parse", "--verify", "--quiet", source.spec],
    signal,
    [0, 1],
  );
  if (resolved.code === 1) return missing();
  const revision = resolved.stdout.toString("utf8").trim();
  const sizeResult = await collectGit(
    repository.root,
    ["cat-file", "-s", revision],
    signal,
  );
  const sizeBytes = Number(sizeResult.stdout.toString("utf8").trim());
  if (method === "git.imageInfo")
    return {
      present: true,
      path: source.path,
      ...(mimeType ? { mimeType } : {}),
      sizeBytes,
      revision,
    };
  const length = Math.min(value.length, Math.max(0, sizeBytes - value.offset));
  return withDocument(
    repository,
    value.source,
    false,
    signal,
    async (document) => {
      const bytes = await readImage(
        document,
        repository,
        revision,
        sizeBytes,
        value.offset,
        length,
        signal,
      );
      return {
        offset: value.offset,
        nextOffset: value.offset + bytes.length,
        bytesBase64: bytes.toString("base64"),
        eof: value.offset + bytes.length >= sizeBytes,
        sizeBytes,
        revision,
      };
    },
  );
}

async function readImage(
  document: DiffDocument,
  repository: Repository,
  revision: string,
  size: number,
  offset: number,
  length: number,
  signal?: Signal,
): Promise<Buffer> {
  if (length === 0) return Buffer.alloc(0);
  const images = (document.imageFiles ??= new Map());
  let file = images.get(revision);
  // A diff normally reads at most two immutable image sides. A live index
  // can resolve to a newer blob before the diff itself is refreshed.
  const retain = file !== undefined || images.size < 2;
  if (!file) {
    file = runDiff(async () => {
      const path = join(await directory(), `${randomUUID()}.image`);
      await writeImageBlob(repository, revision, path, signal);
      if (retain) document.scratchBytes += size;
      return path;
    }, signal);
    if (retain) {
      images.set(revision, file);
      void file.catch(() => images.delete(revision));
    }
  }
  const path = await file;
  try {
    const handle = await open(path, "r");
    try {
      return await readAt(handle, offset, length);
    } finally {
      await handle.close();
    }
  } finally {
    if (!retain) await removeScratch(path);
  }
}

async function writeImageBlob(
  repository: Repository,
  revision: string,
  file: string,
  signal?: Signal,
): Promise<void> {
  const output = await open(file, "w", 0o600);
  let git: ReturnType<typeof startGit> | undefined;
  try {
    git = startGit(repository.root, ["cat-file", "blob", revision], signal);
    for await (const value of git.child.stdout) {
      throwIfAborted(signal);
      await output.write(value as Buffer);
    }
    await finishGit(git, signal);
  } catch (error) {
    if (git) await stopGit(git);
    await output.close().catch(() => undefined);
    await removeScratch(file);
    throw gitFailure(error);
  } finally {
    await output.close().catch(() => undefined);
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
      const { file, index, revision } = await side.load(this.#signal);
      const handle = await this.#open(file);
      const info = await handle.stat({ bigint: true });
      // eslint-disable-next-line iori/no-stored-value-rejection -- The worktree path may now point to a different file, including a link outside the repository.
      if (revision && revisionFor(info) !== revision)
        throw new ReadingFailure("read_failed", "The diff file has changed");
      return { handle, size: Number(info.size), index };
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

type SyntaxRow = { row: number; side: GitImageSide; line: number };

/** Gap rows have consecutive new-side lines. For hunks only the marker bytes are needed. */
async function syntaxRows(
  document: DiffDocument,
  start: number,
  end: number,
  signal?: Signal,
) {
  const rows: SyntaxRow[] = [];
  const files = new Files(document, signal);
  try {
    for (let at = partAt(document, start); at < document.parts.length; at++) {
      const part = document.parts[at]!;
      if (part.row >= end) break;
      let row = Math.max(start, part.row);
      const stop = Math.min(end, part.row + part.rows);
      if (part.kind === "gap") {
        for (; row < stop; row++)
          rows.push({ row, side: "new", line: part.new + row - part.row });
        continue;
      }
      const { handle, size, offset, state } = await locate(
        files,
        document,
        part,
        row,
        signal,
      );
      await seekLine(
        handle,
        size,
        { line: row, offset },
        stop,
        signal,
        (marker) => {
          if (marker === MARK_DELETED)
            rows.push({ row, side: "old", line: state.old });
          else if (marker === MARK_ADDED || marker === MARK_CONTEXT)
            rows.push({ row, side: "new", line: state.new });
          advance(state, marker);
          row++;
        },
      );
    }
    return rows;
  } finally {
    await files.close();
  }
}

async function diffSyntax(
  repository: Repository,
  document: DiffDocument,
  value: ReadParamsByMethod["git.diffSyntax"],
  signal?: Signal,
): Promise<ReadResultByMethod["git.diffSyntax"]> {
  const { source, startRow, rowCount } = value;
  const language = syntaxLanguage(source.path, "");
  const result: ReadResultByMethod["git.diffSyntax"] = {
    rows: [],
    startRow,
    endRow: startRow,
    revision: document.revision,
  };
  if (!language) return result;
  result.language = language;
  result.endRow = Math.max(
    startRow,
    Math.min(document.rows, startRow + rowCount),
  );
  if (result.endRow === startRow) return result;
  const positions = await syntaxRows(document, startRow, result.endRow, signal);
  const spansByRow = new Map<number, SyntaxLine["spans"]>();
  for (const side of ["old", "new"] as const) {
    const selected = positions.filter((pos) => pos.side === side);
    if (!selected.length) continue;
    const startLine = selected[0]!.line;
    const range = {
      startLine,
      lineCount: selected.at(-1)!.line - startLine + 1,
    };
    const content = contentSource(source, side, document.mergeBase);
    try {
      let syntax: ReadResultByMethod["files.syntax"];
      if (content.kind === "file") {
        if (!document.worktreeRevision) continue;
        syntax = await handleFileRead(
          "files.syntax",
          { root: repository.root, path: content.path, ...range },
          signal,
        );
        if (syntax.revision !== document.worktreeRevision) continue;
      } else if (content.kind === "blob") {
        const blob =
          (side === "old" ? document.oldBlob : document.newBlob) ??
          (
            await collectGit(
              repository.root,
              ["rev-parse", "--verify", "--end-of-options", content.spec],
              signal,
            )
          ).stdout
            .toString("utf8")
            .trim();
        syntax = await readBufferSyntax(
          blob,
          blob,
          language,
          range,
          async () => {
            const size = await collectGit(
              repository.root,
              ["cat-file", "-s", blob],
              signal,
            );
            if (Number(size.stdout.toString("utf8")) > MAX_SYNTAX_FILE_BYTES)
              return Buffer.alloc(0);
            return (
              await collectGit(
                repository.root,
                ["cat-file", "blob", blob],
                signal,
              )
            ).stdout;
          },
          signal,
        );
      } else continue;
      const lines = new Map(
        syntax.lines.map(({ line, spans }) => [line, spans]),
      );
      for (const { row, line } of selected) {
        if (syntax.lines.length && line >= syntax.endLine) {
          result.endRow = Math.min(result.endRow, row);
          break;
        }
        const spans = lines.get(line);
        if (spans) spansByRow.set(row, spans);
      }
    } catch {
      // Highlighting is optional; one unavailable side leaves the other readable.
      throwIfAborted(signal);
    }
  }
  let bytes = Buffer.byteLength(JSON.stringify(result));
  for (const { row } of positions) {
    if (row >= result.endRow) break;
    const entry = { row, spans: spansByRow.get(row) ?? [] };
    bytes += Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (result.rows.length && bytes > MAX_PAGE_RESPONSE_BYTES) {
      result.endRow = row;
      break;
    }
    result.rows.push(entry);
  }
  return result;
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
