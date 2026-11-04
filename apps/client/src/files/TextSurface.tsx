import { useEffect, useMemo, useReducer, useState } from "react";
import type {
  FileInfo,
  FileLineChunk,
  ReadResultByMethod,
  SyntaxSpan,
} from "@iori/protocol";
import {
  TextRows,
  type TextPosition,
  type TextRow,
  type TextSource,
} from "../reading/TextRows.tsx";
import {
  decodeBytes,
  isAbort,
  type ReadingTransport,
} from "../reading/transport.ts";
import type { MenuAction } from "../reading/PathMenu.tsx";

const PAGE_LINES = 128;
const CACHE_PAGES = 3;
const PAGE_BYTES = 524_288;

type Page = {
  revision: string;
  lines: FileLineChunk[];
  syntax: Map<number, SyntaxSpan[]>;
  syntaxDone: boolean;
};

/**
 * Reads a text file a page of lines at a time. When the Host reports a new
 * revision, the shown pages stay until each is read again.
 */
class FileLines implements TextSource {
  #transport: ReadingTransport;
  #root: string;
  #path: string;
  #pages = new Map<number, Page>();
  #revision: string | undefined;
  #wanted = { first: 0, last: 0 };
  #running?: AbortController;
  #syntaxRunning = new Map<number, AbortController>();
  #plainRevision?: string;
  #failed?: number;
  #paused = false;
  #changed: () => void;
  #onRevision: (value: ReadResultByMethod["files.lineRange"]) => void;
  count: number;
  error: unknown;

  constructor(
    transport: ReadingTransport,
    root: string,
    info: FileInfo,
    changed: () => void,
    onRevision: (value: ReadResultByMethod["files.lineRange"]) => void,
  ) {
    this.#transport = transport;
    this.#root = root;
    this.#path = info.path;
    this.#revision = info.revision;
    this.count = info.lineCount ?? 0;
    this.#changed = changed;
    this.#onRevision = onRevision;
  }

  /** The file changed: keep showing the pages, read them again, and use the new length. */
  update(info: FileInfo) {
    if (info.revision === this.#revision) return;
    this.#revision = info.revision;
    for (const controller of this.#syntaxRunning.values()) controller.abort();
    this.#syntaxRunning.clear();
    this.count = info.lineCount ?? this.count;
    this.#failed = undefined;
    this.error = undefined;
    this.#kick();
  }

  row(index: number): TextRow | undefined {
    const page = this.#pages.get(Math.floor(index / PAGE_LINES));
    const line = page?.lines[index % PAGE_LINES];
    return (
      line && {
        text: line.text,
        complete: line.complete,
        byteOffset: line.byteOffset,
        syntax: page.syntax.get(line.line),
      }
    );
  }

  ensure(first: number, last: number) {
    this.#paused = false;
    this.#wanted = { first, last };
    const firstPage = Math.floor(first / PAGE_LINES);
    const lastPage = Math.floor(last / PAGE_LINES);
    for (const [page, controller] of this.#syntaxRunning) {
      if (page < firstPage || page > lastPage) {
        controller.abort();
        this.#syntaxRunning.delete(page);
      }
    }
    for (let page = firstPage; page <= lastPage; page += 1) {
      const stored = this.#pages.get(page);
      if (stored && stored.revision === this.#revision)
        this.#readSyntax(page, stored);
    }
    this.#kick();
  }

  retry() {
    this.#failed = undefined;
    this.error = undefined;
    this.#changed();
    this.#kick();
  }

  /** Stops reading until rows are wanted again. */
  dispose() {
    this.#paused = true;
    this.#running?.abort();
    for (const controller of this.#syntaxRunning.values()) controller.abort();
    this.#syntaxRunning.clear();
  }

  #kick() {
    if (this.#running || this.#paused) return;
    const firstPage = Math.floor(this.#wanted.first / PAGE_LINES);
    const lastPage = Math.floor(
      Math.min(this.#wanted.last, this.count - 1) / PAGE_LINES,
    );
    let target: number | undefined;
    for (let page = firstPage; page <= lastPage; page += 1) {
      const stored = this.#pages.get(page);
      if (stored && stored.revision === this.#revision) continue;
      if (page === this.#failed) return;
      target = page;
      break;
    }
    if (target === undefined) return;
    const page = target;
    const controller = new AbortController();
    this.#running = controller;
    void this.#readPage(page, controller.signal)
      .then((result) => {
        const stored: Page = {
          revision: result.revision,
          lines: result.lines,
          syntax: new Map(),
          syntaxDone: false,
        };
        this.#syntaxRunning.get(page)?.abort();
        this.#syntaxRunning.delete(page);
        this.#pages.set(page, stored);
        if (
          result.revision !== this.#revision ||
          result.totalLines !== this.count
        ) {
          // The Host read a newer version than the one shown: refresh the rest.
          this.#revision = result.revision;
          this.count = result.totalLines;
          this.#onRevision(result);
        }
        for (const key of this.#pages.keys())
          if (
            Math.abs(key - page) >= CACHE_PAGES &&
            (key < firstPage || key > lastPage)
          )
            this.#pages.delete(key);
        const wantedFirst = Math.floor(this.#wanted.first / PAGE_LINES);
        const wantedLast = Math.floor(this.#wanted.last / PAGE_LINES);
        if (page >= wantedFirst && page <= wantedLast)
          this.#readSyntax(page, stored);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbort(error)) return;
        this.error = error;
        this.#failed = page;
      })
      .finally(() => {
        if (this.#running === controller) this.#running = undefined;
        if (!controller.signal.aborted) this.#changed();
        if (!this.error) this.#kick();
      });
  }

  #readSyntax(page: number, stored: Page) {
    if (
      stored.syntaxDone ||
      this.#syntaxRunning.has(page) ||
      this.#plainRevision === stored.revision
    )
      return;
    const controller = new AbortController();
    this.#syntaxRunning.set(page, controller);
    const end = page * PAGE_LINES + stored.lines.length + 1;
    const read = async () => {
      let startLine = page * PAGE_LINES + 1;
      while (startLine < end) {
        const result = await this.#transport.request(
          "files.syntax",
          {
            root: this.#root,
            path: this.#path,
            startLine,
            lineCount: end - startLine,
          },
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          this.#pages.get(page) !== stored ||
          result.revision !== stored.revision ||
          this.#plainRevision === stored.revision
        )
          return;
        if (!result.language) {
          this.#plainRevision = stored.revision;
          for (const other of this.#syntaxRunning.values()) other.abort();
          this.#syntaxRunning.clear();
          return;
        }
        for (const line of result.lines)
          stored.syntax.set(line.line, line.spans);
        this.#changed();
        if (result.endLine <= startLine) break;
        startLine = result.endLine;
      }
      stored.syntaxDone = true;
    };
    void read()
      .catch(() => {
        stored.syntaxDone = !controller.signal.aborted;
      })
      .finally(() => {
        if (this.#syntaxRunning.get(page) === controller)
          this.#syntaxRunning.delete(page);
      });
  }

  async #readPage(page: number, signal: AbortSignal) {
    const start = page * PAGE_LINES + 1;
    const read = (startLine: number) =>
      this.#transport.request(
        "files.lineRange",
        {
          root: this.#root,
          path: this.#path,
          startLine,
          lineCount: start + PAGE_LINES - startLine,
          byteLimit: PAGE_BYTES,
        },
        signal,
      );
    const result = await read(start);
    const lines = [...result.lines];
    // Lines that did not fit come next; a huge line keeps only its start here.
    while (
      lines.length < PAGE_LINES &&
      start + lines.length <= result.totalLines
    ) {
      const more = await read(lines.at(-1)!.line + 1);
      if (!more.lines.length) break;
      lines.push(...more.lines);
    }
    return { ...result, lines };
  }

  search: TextSource["search"] = async (query, from, direction, signal) => {
    const result = await this.#transport.request(
      "files.search",
      {
        root: this.#root,
        path: this.#path,
        query,
        from: { line: from.row + 1, column: from.column },
        direction,
        caseSensitive: false,
      },
      signal,
    );
    return {
      wrapped: result.wrapped,
      ...(result.match
        ? { match: { ...result.match, row: result.match.line - 1 } }
        : {}),
    };
  };

  read: TextSource["read"] = async (offset, length, signal) => {
    const result = await this.#transport.request(
      "files.read",
      { root: this.#root, path: this.#path, offset, length },
      signal,
    );
    return decodeBytes(result.bytesBase64);
  };

  rowEnd: TextSource["rowEnd"] = async (index, signal) => {
    if (index + 1 >= this.count) {
      const info = await this.#transport.request(
        "files.info",
        { root: this.#root, path: this.#path },
        signal,
      );
      return info.sizeBytes ?? 0;
    }
    const next = await this.#transport.request(
      "files.lineRange",
      {
        root: this.#root,
        path: this.#path,
        startLine: index + 2,
        lineCount: 1,
        byteLimit: 1,
      },
      signal,
    );
    return Math.max(0, (next.lines[0]?.byteOffset ?? 1) - 1);
  };

  copy: TextSource["copy"] = async (first, last, signal) => {
    const parts: string[] = [];
    let line = first + 1;
    let continuation: { line: number; byteOffset: number } | undefined;
    while (line <= last + 1) {
      const result = await this.#transport.request(
        "files.lineRange",
        {
          root: this.#root,
          path: this.#path,
          startLine: line,
          lineCount: last + 2 - line,
          byteLimit: PAGE_BYTES,
          ...(continuation ? { continuation } : {}),
        },
        signal,
      );
      if (!result.lines.length) break;
      for (const chunk of result.lines) {
        if (continuation && chunk.line === continuation.line)
          parts[parts.length - 1] += chunk.text;
        else parts.push(chunk.text);
      }
      const tail = result.lines.at(-1)!;
      continuation = tail.complete
        ? undefined
        : { line: tail.line, byteOffset: tail.nextByteOffset };
      line = tail.complete ? tail.line + 1 : tail.line;
    }
    return parts.join("\n");
  };
}

export function TextSurface({
  transport,
  root,
  info,
  position,
  onPosition,
  wrap,
  locale,
  findRequest,
  goToRequest,
  extraActions,
}: {
  transport: ReadingTransport;
  root: string;
  info: FileInfo;
  position: TextPosition;
  onPosition: (value: TextPosition) => void;
  wrap: boolean;
  locale: string;
  findRequest?: number;
  goToRequest?: number;
  extraActions?: MenuAction[];
}) {
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [, setLatest] = useState<string>();
  const source = useMemo(
    () =>
      new FileLines(transport, root, info, render, (result) =>
        setLatest(result.revision),
      ),
    // A different file is a different source; a new revision updates this one.
    [transport, root, info.path],
  );
  useEffect(() => () => source.dispose(), [source]);
  useEffect(() => source.update(info), [source, info]);
  return (
    <TextRows
      source={source}
      path={info.absolutePath}
      lineOf={(index) => index + 1}
      goTo={{
        max: Math.max(1, source.count),
        row: (line) => Math.min(line, source.count) - 1,
      }}
      position={position}
      onPosition={onPosition}
      wrap={wrap}
      locale={locale}
      dataId="file-text"
      findRequest={findRequest}
      goToRequest={goToRequest}
      extraActions={extraActions}
    />
  );
}
