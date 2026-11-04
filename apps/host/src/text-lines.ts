import type { FileHandle } from "node:fs/promises";
import { throwIfAborted } from "./reading-failure.ts";

type Signal = AbortSignal | undefined;

export const READ_CHUNK = 64 * 1024;
const MAX_INDEX_OFFSETS = 8192;
// A logical line longer than this is searched in windows instead of whole.
const SEARCH_WINDOW_BYTES = 1024 * 1024;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export type LineIndex = {
  stride: number;
  lines: number;
  /** Byte offset of every `stride`-th line start, keyed by 1-based line number. */
  offsets: Map<number, number>;
};

export function newLineIndex(stride = 1024): LineIndex {
  return { stride, lines: 0, offsets: new Map([[1, 0]]) };
}

/** Records the start of `line`, keeping at most a fixed number of offsets. */
export function rememberLineStart(
  index: LineIndex,
  line: number,
  offset: number,
  onDrop?: (line: number) => void,
): void {
  if ((line - 1) % index.stride !== 0) return;
  if (index.offsets.size >= MAX_INDEX_OFFSETS) {
    index.stride *= 2;
    for (const key of index.offsets.keys())
      if ((key - 1) % index.stride !== 0) {
        index.offsets.delete(key);
        onDrop?.(key);
      }
    if ((line - 1) % index.stride !== 0) return;
  }
  index.offsets.set(line, offset);
}

export function checkpointFor(index: LineIndex, line: number): number {
  return Math.floor((line - 1) / index.stride) * index.stride + 1;
}

export async function readAt(
  handle: FileHandle,
  position: number,
  length: number,
): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0);
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/**
 * What one pass over a file found, kept so that a file that only grew can be
 * scanned on from where the pass stopped.
 */
export type TextScan = {
  /** Text unless the initial binary probe contains NUL. */
  text: boolean;
  index: LineIndex;
  /** Bytes looked at. Less than the size when the file is not text. */
  scanned: number;
  lineFeeds: number;
  finalByte: number;
  /** A NUL byte was found in the initial binary probe. */
  broken: boolean;
  /** The last scanned bytes, to tell an appended file from a rewritten one. */
  tail: Buffer;
};

const TAIL_BYTES = 64;

/**
 * One pass over a file: UTF-8 text or not, line count and a sparse line index.
 * With `previous` from the same file that has only grown, the pass goes on
 * from where `previous` stopped.
 */
export async function scanText(
  handle: FileHandle,
  size: number,
  signal?: Signal,
  previous?: TextScan,
): Promise<TextScan> {
  return scan(handle, size, signal, true, previous);
}

/** The line count and a sparse line index of any file, text or not. */
export async function indexLines(
  handle: FileHandle,
  size: number,
  signal?: Signal,
): Promise<LineIndex> {
  return (await scan(handle, size, signal, false)).index;
}

export async function continuesText(
  handle: FileHandle,
  size: number,
  previous: TextScan,
): Promise<boolean> {
  if (previous.scanned >= size) return false;
  const tail = await readAt(
    handle,
    previous.scanned - previous.tail.length,
    previous.tail.length,
  );
  return tail.equals(previous.tail);
}

async function scan(
  handle: FileHandle,
  size: number,
  signal: Signal,
  checkText: boolean,
  previous?: TextScan,
): Promise<TextScan> {
  const resume =
    previous && (await continuesText(handle, size, previous))
      ? previous
      : undefined;
  if (resume?.broken) return resume;
  const index: LineIndex = resume
    ? { ...resume.index, offsets: new Map(resume.index.offsets) }
    : newLineIndex();
  let position = resume?.scanned ?? 0;
  let lineFeeds = resume?.lineFeeds ?? 0;
  let finalByte = resume?.finalByte ?? -1;
  let tail = resume?.tail ?? Buffer.alloc(0);
  const result = (broken: boolean): TextScan => {
    index.lines = position === 0 ? 0 : lineFeeds + (finalByte === 10 ? 0 : 1);
    return {
      text: !broken,
      index,
      scanned: position,
      lineFeeds,
      finalByte,
      broken,
      tail,
    };
  };
  while (position < size) {
    throwIfAborted(signal);
    const block = await readAt(
      handle,
      position,
      Math.min(READ_CHUNK, size - position),
    );
    if (block.length === 0) break;
    // VS Code's binary probe reads the first 512 bytes. Invalid UTF-8 elsewhere
    // is decoded with replacement by the text reader, including a partial EOF.
    if (
      checkText &&
      position < 512 &&
      block.subarray(0, 512 - position).includes(0)
    )
      return result(true);
    for (let at = block.indexOf(10); at >= 0; at = block.indexOf(10, at + 1)) {
      lineFeeds += 1;
      rememberLineStart(index, lineFeeds + 1, position + at + 1);
    }
    finalByte = block[block.length - 1]!;
    position += block.length;
    tail = Buffer.from(
      (block.length >= TAIL_BYTES
        ? block
        : Buffer.concat([tail, block])
      ).subarray(-TAIL_BYTES),
    );
  }
  return result(false);
}

/** Where the line containing `offset` ends: its line feed, or the file's end. */
export async function lineEnd(
  handle: FileHandle,
  size: number,
  offset: number,
  signal?: Signal,
): Promise<number> {
  let position = offset;
  while (position < size) {
    throwIfAborted(signal);
    const block = await readAt(
      handle,
      position,
      Math.min(READ_CHUNK, size - position),
    );
    if (block.length === 0) break;
    const newline = block.indexOf(10);
    if (newline >= 0) return position + newline;
    position += block.length;
  }
  return Math.min(position, size);
}

/**
 * Walks forward from a known line start to the start of `target`.
 * `onLine` sees the first byte of every line passed over.
 */
export async function seekLine(
  handle: FileHandle,
  size: number,
  from: { line: number; offset: number },
  target: number,
  signal?: Signal,
  onLine?: (firstByte: number | undefined) => void,
): Promise<number> {
  let line = from.line;
  let position = from.offset;
  let atLineStart = true;
  while (line < target && position < size) {
    throwIfAborted(signal);
    const block = await readAt(
      handle,
      position,
      Math.min(READ_CHUNK, size - position),
    );
    if (block.length === 0) break;
    let at = 0;
    while (line < target) {
      if (atLineStart) {
        if (at >= block.length) break;
        onLine?.(block[at]);
        atLineStart = false;
      }
      const newline = block.indexOf(10, at);
      if (newline < 0) {
        at = block.length;
        break;
      }
      line += 1;
      at = newline + 1;
      atLineStart = true;
    }
    position += at;
    if (line >= target) return position;
  }
  return position;
}

/** The longest prefix of `bytes[0..end)` that does not end inside a UTF-8 sequence. */
export function utf8Boundary(bytes: Buffer, end = bytes.length): number {
  let at = end - 1;
  let continuation = 0;
  while (at >= 0 && continuation < 3 && (bytes[at]! & 0xc0) === 0x80) {
    at -= 1;
    continuation += 1;
  }
  if (at < 0) return end;
  const lead = bytes[at]!;
  const length = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return end - at >= length ? end : at;
}

const lossy = new TextDecoder("utf-8");

/** Shared UTF-8 replacement and CR handling for complete or partial lines. */
export function decodeTextLine(bytes: Uint8Array, complete = true): string {
  const end = complete && bytes.at(-1) === 13 ? bytes.length - 1 : bytes.length;
  return lossy.decode(bytes.subarray(0, end));
}

export type RawLineChunk = {
  line: number;
  text: string;
  byteOffset: number;
  nextByteOffset: number;
  complete: boolean;
  /** The first byte of the line when `prefix` was requested. */
  marker?: number;
};

/**
 * Reads whole lines from one byte window. A line longer than the byte budget
 * is returned in UTF-8-safe parts; `next` says where its remainder starts.
 */
export async function readLines(
  handle: FileHandle,
  size: number,
  options: {
    startLine: number;
    /** Where the start line (or its remainder, for a continuation) begins. */
    startOffset: number;
    lineCount: number;
    byteLimit: number;
    totalLines: number;
    /** Each line starts with one marker byte that is not part of its text. */
    prefix?: boolean;
    /** The start offset is inside the start line, after its marker. */
    continuation?: boolean;
    /** The marker of the start line when continuing it. */
    continuationMarker?: number;
  },
): Promise<{
  lines: RawLineChunk[];
  /** Only for a line returned in part: where the rest of that line starts. */
  next?: { line: number; byteOffset: number };
}> {
  const lines: RawLineChunk[] = [];
  let start = options.startOffset;
  if (start >= size || options.startLine > options.totalLines) return { lines };
  if (options.continuation) {
    // A continuation is a position the Host returned; realign it if the file moved under it.
    const probe = await readAt(handle, start, 3);
    let skip = 0;
    while (skip < probe.length && (probe[skip]! & 0xc0) === 0x80) skip += 1;
    start += skip;
  }
  const budget =
    options.byteLimit + 2 + (options.prefix ? options.lineCount : 0);
  const buffer = await readAt(handle, start, Math.min(size - start, budget));
  const reachedEnd = start + buffer.length >= size;
  let cursor = 0;
  let line = options.startLine;
  let first = true;
  while (
    line < options.startLine + options.lineCount &&
    line <= options.totalLines &&
    cursor < buffer.length
  ) {
    let marker: number | undefined;
    if (options.prefix) {
      if (first && options.continuation) marker = options.continuationMarker;
      else {
        marker = buffer[cursor];
        cursor += 1;
      }
    } else if (
      line === 1 &&
      start + cursor === 0 &&
      buffer.subarray(0, 3).equals(BOM)
    )
      cursor = 3;
    first = false;
    const newline = buffer.indexOf(10, cursor);
    let end: number;
    let complete: boolean;
    if (newline >= 0) {
      end = newline;
      complete = true;
    } else if (reachedEnd) {
      end = buffer.length;
      complete = true;
    } else if (lines.length > 0) {
      // The unfinished line starts the next request.
      return { lines };
    } else {
      end = utf8Boundary(
        buffer,
        Math.min(buffer.length, cursor + options.byteLimit),
      );
      if (end > cursor && buffer[end - 1] === 13) end -= 1;
      if (end <= cursor) end = Math.min(buffer.length, cursor + 1);
      complete = false;
    }
    let contentEnd = end;
    if (complete && contentEnd > cursor && buffer[contentEnd - 1] === 13)
      contentEnd -= 1;
    lines.push({
      line,
      text: decodeTextLine(buffer.subarray(cursor, end), complete),
      byteOffset: start + cursor,
      nextByteOffset: start + contentEnd,
      complete,
      ...(marker === undefined ? {} : { marker }),
    });
    if (!complete)
      return { lines, next: { line, byteOffset: start + contentEnd } };
    cursor = newline >= 0 ? newline + 1 : buffer.length;
    line += 1;
  }
  return { lines };
}

export type LineMatch = {
  line: number;
  column: number;
  length: number;
  byteOffset: number;
  byteLength: number;
};

type Folded = { text: string; original?: number[] };

/** Case folding that keeps a map back to the original UTF-16 positions. */
function fold(text: string, caseSensitive: boolean): Folded {
  if (caseSensitive) return { text };
  const lower = text.toLowerCase();
  if (lower.length === text.length) return { text: lower };
  let folded = "";
  const original: number[] = [];
  let at = 0;
  for (const character of text) {
    const value = character.toLowerCase();
    for (let unit = 0; unit < value.length; unit += 1) original.push(at);
    folded += value;
    at += character.length;
  }
  original.push(at);
  return { text: folded, original };
}

function originalIndex(folded: Folded, index: number): number {
  return folded.original ? folded.original[index]! : index;
}

/**
 * Streams the matches of `query` from `startLine` up to (not including)
 * `endLine`, in order. `visit` returns true to stop.
 */
export async function scanMatches(
  handle: FileHandle,
  size: number,
  range: { startLine: number; startOffset: number; endLine: number },
  options: {
    query: string;
    caseSensitive: boolean;
    prefix?: boolean;
    skipMarker?: (marker: number) => boolean;
  },
  visit: (match: LineMatch) => boolean,
  signal?: Signal,
): Promise<boolean> {
  const needle = fold(options.query, options.caseSensitive).text;
  const overlap = Math.max(0, needle.length - 1);
  let position = range.startOffset;
  let line = range.startLine;
  let atLineStart = true;
  let skip = false;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let windowStart = position;
  let columnBase = 0;
  let carry = "";
  let stopped = false;

  const flush = (final: boolean) => {
    let bytes = Buffer.concat(pending, pendingBytes);
    if (final && bytes.at(-1) === 13) bytes = bytes.subarray(0, -1);
    const cut = final ? bytes.length : utf8Boundary(bytes);
    const fresh = lossy.decode(bytes.subarray(0, cut));
    const whole = carry + fresh;
    const wholeByteStart = windowStart - Buffer.byteLength(carry);
    const folded = fold(whole, options.caseSensitive);
    for (
      let found = folded.text.indexOf(needle);
      found >= 0;
      found = folded.text.indexOf(needle, found + Math.max(1, needle.length))
    ) {
      const begin = originalIndex(folded, found);
      const end = originalIndex(folded, found + needle.length);
      const match: LineMatch = {
        line,
        column: columnBase - carry.length + begin,
        length: end - begin,
        byteOffset: wholeByteStart + Buffer.byteLength(whole.slice(0, begin)),
        byteLength: Buffer.byteLength(whole.slice(begin, end)),
      };
      if (visit(match)) {
        stopped = true;
        return;
      }
    }
    if (final) return;
    let keep = Math.min(overlap, whole.length);
    const code = whole.charCodeAt(whole.length - keep);
    if (keep < whole.length && code >= 0xdc00 && code <= 0xdfff) keep += 1;
    carry = keep > 0 ? whole.slice(whole.length - keep) : "";
    columnBase += fresh.length;
    windowStart += cut;
    pending = cut < bytes.length ? [bytes.subarray(cut)] : [];
    pendingBytes = bytes.length - cut;
  };

  while (position < size && line < range.endLine && !stopped) {
    throwIfAborted(signal);
    const block = await readAt(
      handle,
      position,
      Math.min(READ_CHUNK, size - position),
    );
    if (block.length === 0) break;
    let at = 0;
    while (at < block.length && line < range.endLine && !stopped) {
      if (atLineStart) {
        if (options.prefix) {
          skip = options.skipMarker?.(block[at]!) ?? false;
          at += 1;
        } else if (
          line === 1 &&
          position + at === 0 &&
          block.subarray(0, 3).equals(BOM)
        )
          at = 3;
        windowStart = position + at;
        columnBase = 0;
        carry = "";
        atLineStart = false;
      }
      const newline = block.indexOf(10, at);
      const end = newline < 0 ? block.length : newline;
      if (!skip && end > at) {
        pending.push(block.subarray(at, end));
        pendingBytes += end - at;
      }
      if (newline < 0) {
        at = block.length;
        if (!skip && pendingBytes >= SEARCH_WINDOW_BYTES) flush(false);
        break;
      }
      if (!skip) flush(true);
      pending = [];
      pendingBytes = 0;
      line += 1;
      atLineStart = true;
      at = newline + 1;
    }
    position += block.length;
  }
  if (!stopped && !atLineStart && line < range.endLine && !skip) flush(true);
  return stopped;
}

/** Streams the matches from `startLine` up to (not including) `endLine`; `visit` returns true to stop. */
export type MatchScan = (
  startLine: number,
  endLine: number,
  visit: (match: LineMatch) => boolean,
) => Promise<unknown>;

/**
 * Finds the next or previous match from a line and UTF-16 column, wrapping
 * around the lines once.
 */
export async function searchLines(
  scan: MatchScan,
  totalLines: number,
  options: {
    from: { line: number; column: number };
    direction: "forward" | "backward";
  },
): Promise<{ match?: LineMatch; wrapped: boolean }> {
  const fromLine = Math.max(1, Math.min(options.from.line, totalLines || 1));
  const before = (match: LineMatch) =>
    match.line < fromLine ||
    (match.line === fromLine && match.column < options.from.column);
  let found: LineMatch | undefined;
  if (options.direction === "forward") {
    await scan(fromLine, totalLines + 1, (match) => {
      if (before(match)) return false;
      found = match;
      return true;
    });
    if (found) return { match: found, wrapped: false };
    await scan(1, fromLine + 1, (match) => {
      found = match;
      return true;
    });
    return { ...(found ? { match: found } : {}), wrapped: Boolean(found) };
  }
  await scan(1, fromLine + 1, (match) => {
    if (before(match)) found = match;
    return !before(match);
  });
  if (found) return { match: found, wrapped: false };
  await scan(fromLine, totalLines + 1, (match) => {
    found = match;
    return false;
  });
  return { ...(found ? { match: found } : {}), wrapped: Boolean(found) };
}
