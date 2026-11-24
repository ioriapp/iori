import type {
  GitDiffInfo,
  GitDiffRow,
  GitDiffSource,
  ReadResultByMethod,
  SyntaxSpan,
} from "@iori/protocol";
import type { TextRow, TextSource } from "../reading/TextRows.tsx";
import {
  ReadConnectionLost,
  decodeBytes,
  isAbort,
  type ReadingTransport,
} from "../reading/transport.ts";

const PAGE_ROWS = 128;
const CACHE_PAGES = 4;
const PAGE_BYTES = 524_288;

type Page = {
  revision: string;
  rows: GitDiffRow[];
  syntax: Map<number, SyntaxSpan[]>;
  syntaxDone: boolean;
};
type Shown = { row: number } | { run: number };

/**
 * A diff read from the Host by row. Unchanged rows far from any change are
 * shown as one omission row until the user expands them.
 */
export class DiffDocument implements TextSource {
  #transport: ReadingTransport;
  #root: string;
  #source: GitDiffSource;
  #changed: () => void;
  #pages = new Map<number, Page>();
  #wanted = { first: 0, last: 0 };
  /** Pages holding the rows on screen; rows hidden in omissions are not read. */
  #wantedPages: number[] = [];
  #running?: AbortController;
  #opening?: AbortController;
  #syntaxRunning = new Map<number, AbortController>();
  #plainRevision?: string;
  #failed?: number;
  #refreshFailed = false;
  #paused = false;
  #expanded = new Set<number>();
  revision: string | undefined;
  totalRows = 0;
  collapsed: Array<[number, number]> = [];
  hunks: number[] = [];
  patchHunks: Array<{ row: number; fingerprint: string }> = [];
  info?: GitDiffInfo;
  count = 0;
  error: unknown;
  readonly twoColumns: boolean;

  constructor(
    transport: ReadingTransport,
    root: string,
    source: GitDiffSource,
    changed: () => void,
  ) {
    this.#transport = transport;
    this.#root = root;
    this.#source = source;
    this.#changed = changed;
    this.twoColumns = source.kind !== "stage";
  }

  /** Reads the diff again from Git (`refresh`) or takes the Host's current one. */
  open(refresh: boolean) {
    this.#paused = false;
    this.#opening?.abort();
    this.#running?.abort();
    const controller = new AbortController();
    this.#opening = controller;
    void this.#transport
      .request(
        "git.diffOpen",
        { root: this.#root, source: this.#source, refresh },
        controller.signal,
      )
      .then(async (result) => {
        if (controller.signal.aborted) return;
        if (result.revision !== this.revision) {
          const pages = new Map<number, Page>();
          // Recalculate after each read: the user may scroll while refreshing.
          for (;;) {
            const wanted = this.#pagesFor(result.totalRows, result.collapsed);
            const page = wanted.find((key) => !pages.has(key));
            if (page === undefined) break;
            const data = await this.#readPage(page, controller.signal);
            if (controller.signal.aborted) return;
            if (data.revision !== result.revision) {
              this.open(false);
              return;
            }
            pages.set(page, data);
          }
          this.#pages = pages;
        }
        this.#apply(result);
        this.error = undefined;
        this.#failed = undefined;
        this.#refreshFailed = false;
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          isAbort(error) ||
          error instanceof ReadConnectionLost
        )
          return;
        this.error = error;
        this.#refreshFailed = true;
      })
      .finally(() => {
        if (this.#opening === controller) this.#opening = undefined;
        if (controller.signal.aborted) return;
        this.#changed();
        this.#kick();
      });
  }

  #apply(result: ReadResultByMethod["git.diffOpen"]) {
    if (result.revision !== this.revision) {
      this.#expanded.clear();
      for (const controller of this.#syntaxRunning.values()) controller.abort();
      this.#syntaxRunning.clear();
    }
    this.revision = result.revision;
    this.totalRows = result.totalRows;
    this.info = result.info;
    this.collapsed = result.collapsed;
    this.hunks = result.hunks ?? [];
    this.patchHunks = result.patchHunks ?? [];
    this.#layout();
  }

  /** Visible row indices of each hunk start, mapped across collapsed omissions. */
  shownHunks(): number[] {
    return this.hunks.map((row) => this.#shownIndex(row));
  }

  /** Visible row indices of each Git `@@` patch hunk, in `git.applyHunk` index order. */
  shownPatchHunks(): Array<{
    shownRow: number;
    hunkIndex: number;
    fingerprint: string;
  }> {
    return this.patchHunks.map((hunk, hunkIndex) => ({
      shownRow: this.#shownIndex(hunk.row),
      hunkIndex,
      fingerprint: hunk.fingerprint,
    }));
  }

  /** First loaded changed line number on the new side (for "Open in Files"). */
  firstChangedLine(): number | undefined {
    for (const rawRow of this.hunks) {
      const data = this.#rowData(rawRow);
      if (data?.newLine !== undefined) return data.newLine;
      if (data?.oldLine !== undefined) return data.oldLine;
    }
    return undefined;
  }

  /** Best visible row index for a given file line number among loaded pages. */
  rowIndexForLine(side: "old" | "new", line: number): number | undefined {
    for (const page of this.#pages.values()) {
      if (page.revision !== this.revision) continue;
      for (const item of page.rows) {
        const candidate = side === "old" ? item.oldLine : item.newLine;
        if (candidate === line) return this.#shownIndex(item.row);
      }
    }
    return undefined;
  }

  /** Each collapsed run that is not expanded takes one shown row. */
  #layout() {
    let hidden = 0;
    this.collapsed.forEach(([, length], run) => {
      if (!this.#expanded.has(run)) hidden += length - 1;
    });
    this.count = this.totalRows - hidden;
  }

  /** Maps a shown index to a row of the Host's diff or an omission. */
  #shown(index: number): Shown {
    let row = index;
    for (let run = 0; run < this.collapsed.length; run += 1) {
      const [start, length] = this.collapsed[run]!;
      if (row < start) break;
      if (this.#expanded.has(run)) continue;
      if (row === start) return { run };
      row += length - 1;
    }
    return { row };
  }

  #shownIndex(row: number): number {
    let index = row;
    for (let run = 0; run < this.collapsed.length; run += 1) {
      const [start, length] = this.collapsed[run]!;
      if (row < start) break;
      if (this.#expanded.has(run)) continue;
      if (row < start + length) return index - (row - start);
      index -= length - 1;
    }
    return index;
  }

  expand(index: number) {
    const shown = this.#shown(index);
    if (!("run" in shown)) return;
    this.#expanded.add(shown.run);
    this.#layout();
    this.#changed();
    this.#kick();
  }

  #runOf(row: number): number | undefined {
    for (let run = 0; run < this.collapsed.length; run += 1) {
      const [start, length] = this.collapsed[run]!;
      if (row < start) return undefined;
      if (row < start + length)
        return this.#expanded.has(run) ? undefined : run;
    }
    return undefined;
  }

  #rowData(row: number): GitDiffRow | undefined {
    const page = this.#pages.get(Math.floor(row / PAGE_ROWS));
    return page && page.revision === this.revision
      ? page.rows[row % PAGE_ROWS]
      : undefined;
  }

  row(index: number): TextRow | undefined {
    const shown = this.#shown(index);
    if ("run" in shown)
      return {
        kind: "omission",
        text: "",
        complete: true,
        byteOffset: 0,
        omitted: this.collapsed[shown.run]![1],
      };
    const data = this.#rowData(shown.row);
    const page = this.#pages.get(Math.floor(shown.row / PAGE_ROWS));
    return (
      data && {
        kind: data.kind,
        text: data.text,
        complete: data.complete,
        byteOffset: data.byteOffset,
        syntax:
          page && page.revision === this.revision
            ? page.syntax.get(data.row)
            : undefined,
        ...(data.oldLine === undefined ? {} : { oldLine: data.oldLine }),
        ...(data.newLine === undefined ? {} : { newLine: data.newLine }),
      }
    );
  }

  /** The file line a shown row stands for (the new side when it exists). */
  lineOf(index: number): number | undefined {
    const shown = this.#shown(index);
    if ("run" in shown) return undefined;
    const data = this.#rowData(shown.row);
    return data?.newLine ?? data?.oldLine;
  }

  ensure(first: number, last: number) {
    this.#paused = false;
    this.#wanted = { first, last };
    this.#wantPages();
    for (const [page, controller] of this.#syntaxRunning) {
      if (!this.#wantedPages.includes(page)) {
        controller.abort();
        this.#syntaxRunning.delete(page);
      }
    }
    for (const page of this.#wantedPages) {
      const stored = this.#pages.get(page);
      if (stored && stored.revision === this.revision)
        this.#readSyntax(page, stored);
    }
    this.#kick();
  }

  #wantPages() {
    this.#wantedPages = this.#pagesFor(
      this.totalRows,
      this.collapsed,
      this.#expanded,
    );
  }

  #pagesFor(
    totalRows: number,
    collapsed: Array<[number, number]>,
    expanded = new Set<number>(),
  ): number[] {
    let count = totalRows;
    collapsed.forEach(([, length], run) => {
      if (!expanded.has(run)) count -= length - 1;
    });
    const pages = new Set<number>();
    for (
      let index = Math.min(this.#wanted.first, Math.max(0, count - 1));
      index <= this.#wanted.last && index < count;
      index += 1
    ) {
      let row = index;
      let omitted = false;
      for (let run = 0; run < collapsed.length; run += 1) {
        const [start, length] = collapsed[run]!;
        if (row < start) break;
        if (expanded.has(run)) continue;
        if (row === start) {
          omitted = true;
          break;
        }
        row += length - 1;
      }
      if (!omitted) pages.add(Math.floor(row / PAGE_ROWS));
    }
    return [...pages].sort((a, b) => a - b);
  }

  retry() {
    this.error = undefined;
    this.#failed = undefined;
    if (!this.revision || this.#refreshFailed) this.open(false);
    else this.#kick();
    this.#changed();
  }

  /** Stops reading until rows are wanted again. */
  dispose() {
    this.#paused = true;
    this.#running?.abort();
    this.#opening?.abort();
    for (const controller of this.#syntaxRunning.values()) controller.abort();
    this.#syntaxRunning.clear();
  }

  #kick() {
    if (this.#running || this.#opening || this.#paused || !this.revision)
      return;
    this.#wantPages();
    const wanted = this.#wantedPages;
    let target: number | undefined;
    for (const page of wanted) {
      const stored = this.#pages.get(page);
      if (stored?.revision === this.revision) continue;
      if (page === this.#failed) return;
      target = page;
      break;
    }
    if (target === undefined) return;
    const page = target;
    const controller = new AbortController();
    this.#running = controller;
    void this.#readPage(page, controller.signal)
      .then(({ revision, rows }) => {
        if (controller.signal.aborted) return;
        if (revision !== this.revision) {
          // The Host diffed again for another view; take its new shape.
          this.open(false);
          return;
        }
        const stored: Page = {
          revision,
          rows,
          syntax: new Map(),
          syntaxDone: false,
        };
        this.#syntaxRunning.get(page)?.abort();
        this.#syntaxRunning.delete(page);
        this.#pages.set(page, stored);
        if (this.#wantedPages.includes(page)) this.#readSyntax(page, stored);
        for (const key of this.#pages.keys())
          if (
            !wanted.includes(key) &&
            this.#pages.size > wanted.length + CACHE_PAGES
          )
            this.#pages.delete(key);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          isAbort(error) ||
          error instanceof ReadConnectionLost
        )
          return;
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
      this.#plainRevision === stored.revision ||
      stored.rows.length === 0
    )
      return;
    const controller = new AbortController();
    this.#syntaxRunning.set(page, controller);
    const start = page * PAGE_ROWS;
    const end = start + stored.rows.length;
    const read = async () => {
      let startRow = start;
      while (startRow < end) {
        const result = await this.#transport.request(
          "git.diffSyntax",
          {
            root: this.#root,
            source: this.#source,
            startRow,
            rowCount: end - startRow,
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
        for (const item of result.rows) stored.syntax.set(item.row, item.spans);
        this.#changed();
        if (result.endRow <= startRow) break;
        startRow = result.endRow;
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

  async #readPage(page: number, signal: AbortSignal): Promise<Page> {
    const start = page * PAGE_ROWS;
    const read = (startRow: number) =>
      this.#transport.request(
        "git.diffRows",
        {
          root: this.#root,
          source: this.#source,
          startRow,
          rowCount: start + PAGE_ROWS - startRow,
          byteLimit: PAGE_BYTES,
        },
        signal,
      );
    const result = await read(start);
    const rows = [...result.rows];
    while (
      rows.length > 0 &&
      rows.length < PAGE_ROWS &&
      start + rows.length < result.totalRows
    ) {
      const more = await read(rows.at(-1)!.row + 1);
      if (more.revision !== result.revision)
        return {
          revision: more.revision,
          rows: more.rows,
          syntax: new Map(),
          syntaxDone: false,
        };
      if (!more.rows.length) break;
      rows.push(...more.rows);
    }
    return {
      revision: result.revision,
      rows,
      syntax: new Map(),
      syntaxDone: false,
    };
  }

  search: TextSource["search"] = async (query, from, direction, signal) => {
    const shown = this.#shown(from.row);
    const row = "row" in shown ? shown.row : this.collapsed[shown.run]![0];
    const result = await this.#transport.request(
      "git.diffSearch",
      {
        root: this.#root,
        source: this.#source,
        query,
        from: { row, column: from.column },
        direction,
        caseSensitive: false,
      },
      signal,
    );
    if (!result.match) return { wrapped: result.wrapped };
    // A match inside an omission opens it.
    const run = this.#runOf(result.match.row);
    if (run !== undefined) {
      this.#expanded.add(run);
      this.#layout();
      this.#changed();
    }
    return {
      wrapped: result.wrapped,
      match: { ...result.match, row: this.#shownIndex(result.match.row) },
    };
  };

  read: TextSource["read"] = async (offset, length, signal) => {
    const result = await this.#transport.request(
      "git.diffRead",
      { root: this.#root, source: this.#source, offset, length },
      signal,
    );
    return decodeBytes(result.bytesBase64);
  };

  rowEnd: TextSource["rowEnd"] = async (index, signal) => {
    const shown = this.#shown(index);
    const row = "row" in shown ? shown.row : 0;
    const known = this.#rowData(row);
    if (known?.lineEnd !== undefined) return known.lineEnd;
    const result = await this.#transport.request(
      "git.diffRows",
      {
        root: this.#root,
        source: this.#source,
        startRow: row,
        rowCount: 1,
        byteLimit: 1,
      },
      signal,
    );
    const data = result.rows[0];
    return data?.lineEnd ?? data?.nextByteOffset ?? 0;
  };

  copy: TextSource["copy"] = async (first, last, signal) => {
    const from = this.#shown(first);
    const to = this.#shown(last);
    const end = "row" in to ? to.row : this.collapsed[to.run]![0] - 1;
    let row =
      "row" in from
        ? from.row
        : this.collapsed[from.run]![0] + this.collapsed[from.run]![1];
    const lines: string[] = [];
    let continuation: { row: number; byteOffset: number } | undefined;
    while (row <= end) {
      // Rows inside an omission are not on screen and are not copied.
      const run = continuation ? undefined : this.#runOf(row);
      if (run !== undefined) {
        const [start, length] = this.collapsed[run]!;
        row = start + length;
        continue;
      }
      const result = await this.#transport.request(
        "git.diffRows",
        {
          root: this.#root,
          source: this.#source,
          startRow: row,
          rowCount: end - row + 1,
          byteLimit: PAGE_BYTES,
          ...(continuation ? { continuation } : {}),
        },
        signal,
      );
      if (!result.rows.length) break;
      for (const chunk of result.rows) {
        if (this.#runOf(chunk.row) !== undefined) continue;
        if (continuation && chunk.row === continuation.row)
          lines[lines.length - 1] += chunk.text;
        else lines.push(chunk.text);
      }
      const tail = result.rows.at(-1)!;
      continuation = tail.complete
        ? undefined
        : { row: tail.row, byteOffset: tail.nextByteOffset };
      row = tail.complete ? tail.row + 1 : tail.row;
    }
    return lines.join("\n");
  };
}
