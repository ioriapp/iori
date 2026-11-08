import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronsUpDown,
  ClipboardCopy,
  CornerDownLeft,
  Search,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { native } from "../native.ts";
import { VirtualRows, type ScrollRequest } from "./VirtualRows.tsx";
import { LongLine, type LongLineRead } from "./LongLine.tsx";
import { FindBar, GoToLineBar } from "./FindBar.tsx";
import { PathMenu, type MenuAction } from "./PathMenu.tsx";
import { ReadConnectionLost, isAbort, readErrorCopy } from "./transport.ts";
import { ReadingError } from "./ReadingError.tsx";
import type { SyntaxSpan } from "@iori/protocol";

export type TextRowKind = "context" | "added" | "deleted" | "note" | "omission";

export type TextRow = {
  text: string;
  complete: boolean;
  /** Where this row's text starts in the source the Host reads. */
  byteOffset: number;
  syntax?: SyntaxSpan[];
  kind?: TextRowKind;
  oldLine?: number;
  newLine?: number;
  /** For an omission row: how many unchanged rows it stands for. */
  omitted?: number;
};

export type TextMatch = {
  row: number;
  column: number;
  length: number;
  byteOffset: number;
  byteLength: number;
};

export interface TextSource {
  readonly revision: string | undefined;
  count: number;
  row(index: number): TextRow | undefined;
  ensure(first: number, last: number): void;
  error: unknown;
  retry(): void;
  search(
    query: string,
    from: { row: number; column: number },
    direction: "forward" | "backward",
    signal: AbortSignal,
  ): Promise<{ match?: TextMatch; wrapped: boolean }>;
  read: LongLineRead;
  /** Where the text of row `index` ends (exclusive). */
  rowEnd(index: number, signal: AbortSignal): Promise<number>;
  /** The full text of rows `first`..`last`, one line per row. */
  copy(first: number, last: number, signal: AbortSignal): Promise<string>;
  /** Two line-number columns (old and new) instead of one. */
  twoColumns?: boolean;
}

type TextPoint = {
  row: number;
  /** Byte offset from the start of the logical row. */
  column: number;
  rowStart: number;
  window: number;
  windowCharacters: number;
  windowEncodedBytes: number;
};
type CharacterSelection = { anchor: TextPoint; focus: TextPoint };

export type TextPosition = {
  top: number;
  selection?: { start: number; end: number };
  query: string;
  match?: TextMatch;
};

// Rows longer than this are drawn by LongLine, which reads only what is in view.
const INLINE_ROW_CHARS = 16_384;
// Wrapping is turned off above this many rows; measured rows would not scroll smoothly.
export const MAX_WRAPPED_ROWS = 200_000;

function highlights(
  text: string,
  query: string,
  current?: { column: number; length: number },
  syntax?: SyntaxSpan[],
): ReactNode {
  const colored = (start: number, end: number): ReactNode => {
    if (!syntax?.length) return text.slice(start, end);
    const parts: ReactNode[] = [];
    let at = start;
    for (const [column, length, kind] of syntax) {
      const from = Math.max(start, column);
      const to = Math.min(end, column + length);
      if (to <= from) continue;
      if (from > at) parts.push(text.slice(at, from));
      parts.push(
        <span key={from} data-syntax={kind}>
          {text.slice(from, to)}
        </span>,
      );
      at = to;
    }
    parts.push(text.slice(at, end));
    return parts;
  };
  if (!query) return colored(0, text.length);
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  if (lower.length !== text.length) {
    if (!current) return colored(0, text.length);
    return (
      <>
        {colored(0, current.column)}
        <mark data-iori-part="search-current">
          {colored(current.column, current.column + current.length)}
        </mark>
        {colored(current.column + current.length, text.length)}
      </>
    );
  }
  const parts: ReactNode[] = [];
  let at = 0;
  for (
    let found = lower.indexOf(needle);
    found >= 0 && needle;
    found = lower.indexOf(needle, found + needle.length)
  ) {
    parts.push(colored(at, found));
    const isCurrent = current?.column === found;
    parts.push(
      <mark
        key={found}
        data-iori-part={isCurrent ? "search-current" : "search-match"}
      >
        {colored(found, found + needle.length)}
      </mark>,
    );
    at = found + needle.length;
  }
  parts.push(colored(at, text.length));
  return parts;
}

/**
 * Rows of text with line numbers: Files' text and Git's diffs. Lines are
 * selected with the numbers (Shift+click extends), found with Ctrl+F and
 * reached with Ctrl+G; nothing sits permanently above the text.
 */
export function TextRows({
  source,
  path,
  lineOf,
  goTo,
  position,
  onPosition,
  wrap,
  locale,
  dataId,
  findRequest = 0,
  goToRequest = 0,
  onExpand,
  extraActions = [],
  rowHeight = 22,
}: {
  source: TextSource;
  /** The absolute path for the menu's copy actions. */
  path: string;
  /** The file line a row stands for, used in "Copy path with line". */
  lineOf: (index: number) => number | undefined;
  /** Row index for a 1-based line number; omitted where Ctrl+G does not apply. */
  goTo?: { max: number; row: (line: number) => number };
  position: TextPosition;
  onPosition: (value: TextPosition) => void;
  wrap: boolean;
  locale: string;
  dataId: string;
  /** Increments to open the find box (header icon, menu). */
  findRequest?: number;
  goToRequest?: number;
  onExpand?: (index: number) => void;
  extraActions?: MenuAction[];
  rowHeight?: number;
}) {
  const ja = locale.startsWith("ja");
  const latest = useRef(position);
  latest.current = position;
  const [findOpen, setFindOpen] = useState(Boolean(position.query));
  const [findFocus, setFindFocus] = useState(0);
  const [goToOpen, setGoToOpen] = useState(false);
  const [status, setStatus] = useState<string>();
  const [scroll, setScroll] = useState<ScrollRequest>();
  const [failure, setFailure] = useState<string>();
  const [startingRow, setStartingRow] = useState<number>();
  const captureSelection = useRef<() => void>(() => {});
  const [characters, setCharacters] = useState<CharacterSelection>();
  const characterRef = useRef<CharacterSelection | undefined>(undefined);
  const heldRows = useRef(new Map<number, TextRow>());
  const heldDocument = useRef({
    source,
    revision: source.revision,
    count: source.count,
  });
  const sameDocument =
    heldDocument.current.source === source &&
    heldDocument.current.revision === source.revision &&
    heldDocument.current.count === source.count;
  const setCharacterSelection = (value: CharacterSelection | undefined) => {
    characterRef.current = value;
    setCharacters(value);
  };
  const searching = useRef<AbortController | undefined>(undefined);
  const copying = useRef<AbortController | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    setCharacterSelection(undefined);
    setStartingRow(undefined);
    heldRows.current.clear();
    heldDocument.current = {
      source,
      revision: source.revision,
      count: source.count,
    };
    const selection = window.getSelection();
    if (
      (selection?.anchorNode &&
        viewport.current?.contains(selection.anchorNode)) ||
      (selection?.focusNode && viewport.current?.contains(selection.focusNode))
    )
      selection?.removeAllRanges();
    copying.current?.abort();
  }, [source, source.revision, source.count]);
  // After a search, the match is also brought into view horizontally once drawn.
  const reveal = useRef(false);
  useLayoutEffect(() => {
    if (!reveal.current) return;
    const mark = viewport.current?.querySelector<HTMLElement>(
      '[data-iori-part="search-current"]',
    );
    if (!mark) return;
    reveal.current = false;
    if (mark.closest('[data-iori-scroll="long-line"]')) return;
    const scroller = mark.closest<HTMLElement>(".reading-virtual");
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const rect = mark.getBoundingClientRect();
    const gutter =
      mark
        .closest(".reading-line")
        ?.querySelector(".reading-gutter")
        ?.getBoundingClientRect().width ?? 0;
    if (rect.right > box.right)
      scroller.scrollLeft += rect.right - box.right + 24;
    else if (rect.left < box.left + gutter)
      scroller.scrollLeft -= box.left + gutter - rect.left + 24;
  });
  const focusRows = () =>
    viewport.current
      ?.querySelector<HTMLElement>(".reading-virtual")
      ?.focus({ preventScroll: true });
  const update = (value: Partial<TextPosition>) =>
    onPosition({ ...latest.current, ...value });

  useEffect(
    () => () => {
      searching.current?.abort();
      copying.current?.abort();
    },
    [],
  );
  // Requests from the header or menu count up from zero for this surface.
  useEffect(() => {
    if (!findRequest) return;
    setGoToOpen(false);
    setFindOpen(true);
    setFindFocus((value) => value + 1);
  }, [findRequest]);
  useEffect(() => {
    if (goToRequest && goTo) {
      setFindOpen(false);
      setGoToOpen(true);
    }
  }, [goToRequest]);
  const report = (error: unknown) => {
    if (isAbort(error) || error instanceof ReadConnectionLost) return;
    setFailure(
      readErrorCopy(error, locale) ??
        (ja ? "読み込めませんでした。" : "Could not read this."),
    );
  };

  const find = async (direction: "forward" | "backward") => {
    const { query, match, top } = latest.current;
    if (!query) return;
    searching.current?.abort();
    const controller = new AbortController();
    searching.current = controller;
    const from = match
      ? {
          row: match.row,
          column: match.column + (direction === "forward" ? 1 : 0),
        }
      : { row: top, column: 0 };
    try {
      const result = await source.search(
        query,
        from,
        direction,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setFailure(undefined);
      if (!result.match) {
        setStatus(ja ? "一致なし" : "No matches");
        update({ match: undefined });
        return;
      }
      setStatus(
        result.wrapped
          ? direction === "forward"
            ? ja
              ? "先頭に戻って検索しました"
              : "Wrapped to the top"
            : ja
              ? "末尾に戻って検索しました"
              : "Wrapped to the end"
          : undefined,
      );
      update({ match: result.match });
      reveal.current = true;
      setScroll({ index: result.match.row, align: "center", key: Date.now() });
    } catch (error) {
      if (!controller.signal.aborted) report(error);
    }
  };

  // Selection is the interaction surface, not the document used for copying.
  // Keep byte coordinates and only the two endpoint rows while the DOM is recycled.
  useEffect(() => {
    const point = (
      node: Node | null,
      offset: number,
    ): TextPoint | undefined => {
      const element = node instanceof Element ? node : node?.parentElement;
      const text = element?.closest<HTMLElement>(".reading-line-text");
      const line = text?.closest<HTMLElement>("[data-iori-row]");
      if (!node || !text || !line || !viewport.current?.contains(text)) return;
      const row = Number(line.dataset.ioriRow);
      const data = heldRows.current.get(row) ?? source.row(row);
      if (!data) return;
      const prefix = document.createRange();
      prefix.selectNodeContents(text);
      prefix.setEnd(node, offset);
      const window = Number(text.dataset.textOffset ?? data.byteOffset);
      const prefixText = prefix.toString();
      const windowEncodedBytes = new TextEncoder().encode(prefixText).length;
      const column = window - data.byteOffset + windowEncodedBytes;
      heldRows.current.set(row, data);
      return {
        row,
        column,
        rowStart: data.byteOffset,
        window,
        windowCharacters: prefixText.length,
        windowEncodedBytes,
      };
    };
    const changed = () => {
      const nativeSelection = window.getSelection();
      if (!nativeSelection || nativeSelection.isCollapsed) {
        if (characterRef.current) {
          setCharacterSelection(undefined);
          heldRows.current.clear();
        }
        return;
      }
      const anchor = point(
        nativeSelection.anchorNode,
        nativeSelection.anchorOffset,
      );
      const focus = point(
        nativeSelection.focusNode,
        nativeSelection.focusOffset,
      );
      if (!anchor || !focus) {
        setCharacterSelection(undefined);
        heldRows.current.clear();
        return;
      }
      setCharacterSelection({ anchor, focus });
      heldRows.current = new Map(
        [...heldRows.current].filter(
          ([index]) => index === anchor.row || index === focus.row,
        ),
      );
      if (latest.current.selection)
        onPosition({ ...latest.current, selection: undefined });
    };
    captureSelection.current = changed;
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [source, onPosition]);

  const copyCharacters = async () => {
    const range = characterRef.current;
    if (!range) return;
    copying.current?.abort();
    const controller = new AbortController();
    copying.current = controller;
    const signal = controller.signal;
    // The displayed replacement character may represent fewer source bytes than
    // its UTF-8 encoding. Recover the source position within each long window.
    const resolve = async (point: TextPoint): Promise<TextPoint> => {
      const row = source.row(point.row) ?? heldRows.current.get(point.row);
      if (row?.complete && row.text.length <= INLINE_ROW_CHARS) return point;
      if (!point.windowCharacters)
        return { ...point, column: point.window - point.rowStart };
      const bytes = await source.read(
        point.window,
        point.windowEncodedBytes + 4,
        signal,
      );
      const decoder = new TextDecoder();
      let characters = 0;
      for (let i = 0; i < bytes.length; i += 1) {
        const text = decoder.decode(bytes.subarray(i, i + 1), { stream: true });
        const before = characters;
        characters += text.length;
        if (characters >= point.windowCharacters) {
          const previous =
            text.length > 1 &&
            text.startsWith("�") &&
            before + 1 === point.windowCharacters;
          return {
            ...point,
            column: point.window - point.rowStart + i + (previous ? 0 : 1),
          };
        }
      }
      return point;
    };
    const [anchor, focus] = await Promise.all([
      resolve(range.anchor),
      resolve(range.focus),
    ]);
    const forward =
      anchor.row < focus.row ||
      (anchor.row === focus.row && anchor.column <= focus.column);
    const first = forward ? anchor : focus;
    const last = forward ? focus : anchor;
    const edge = async (point: TextPoint, from: number, to?: number) => {
      const row = source.row(point.row) ?? heldRows.current.get(point.row);
      if (row?.complete && row.text.length <= INLINE_ROW_CHARS) {
        const text = await source.copy(point.row, point.row, signal);
        return new TextDecoder().decode(
          new TextEncoder().encode(text).subarray(from, to),
        );
      }
      // A huge row is read in windows too: never fetch its unselected prefix.
      const end =
        to === undefined
          ? await source.rowEnd(point.row, signal)
          : point.rowStart + to;
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let offset = point.rowStart + from;
      while (offset < end) {
        const bytes = await source.read(
          offset,
          Math.min(32 * 1024, end - offset),
          signal,
        );
        if (!bytes.length) break;
        parts.push(decoder.decode(bytes, { stream: true }));
        offset += bytes.length;
      }
      parts.push(decoder.decode());
      const text = parts.join("");
      // rowEnd excludes LF; a CRLF row may still end with its carriage return.
      return to === undefined ? text.replace(/\r?\n$|\r$/u, "") : text;
    };
    let text: string;
    const firstRow = heldRows.current.get(first.row) ?? source.row(first.row);
    const lastRow = heldRows.current.get(last.row) ?? source.row(last.row);
    if (
      firstRow?.complete &&
      lastRow?.complete &&
      firstRow.text.length <= INLINE_ROW_CHARS &&
      lastRow.text.length <= INLINE_ROW_CHARS
    ) {
      const bytes = new TextEncoder().encode(
        await source.copy(first.row, last.row, signal),
      );
      const end =
        first.row === last.row
          ? last.column
          : bytes.lastIndexOf(10) + 1 + last.column;
      text = new TextDecoder().decode(bytes.subarray(first.column, end));
    } else if (first.row === last.row)
      text = await edge(first, first.column, last.column);
    else {
      const head = await edge(first, first.column);
      const middle =
        first.row + 1 < last.row
          ? await source.copy(first.row + 1, last.row - 1, signal)
          : undefined;
      const tail = await edge(last, 0, last.column);
      text = [head, ...(middle === undefined ? [] : [middle]), tail].join("\n");
    }
    await native.clipboardWrite(text);
  };

  const selection = position.selection;
  const selected = selection
    ? {
        first: Math.min(selection.start, selection.end),
        last: Math.max(selection.start, selection.end),
      }
    : undefined;
  const copySelection = async () => {
    if (!selected) return;
    copying.current?.abort();
    const controller = new AbortController();
    copying.current = controller;
    const text = await source.copy(
      selected.first,
      selected.last,
      controller.signal,
    );
    await native.clipboardWrite(text);
  };
  const select = (index: number, extend: boolean, first?: number) => {
    setCharacterSelection(undefined);
    setStartingRow(undefined);
    heldRows.current.clear();
    window.getSelection()?.removeAllRanges();
    const start =
      first ?? (extend ? (latest.current.selection?.start ?? index) : index);
    update({ selection: { start, end: index } });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = event.ctrlKey || event.metaKey;
    // Only the rows' scroller receives this; the find and go-to fields sit beside it.
    if (command && event.key.toLowerCase() === "a") {
      event.preventDefault();
      if (source.count) select(source.count - 1, false, 0);
    } else if (command && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setGoToOpen(false);
      setFindOpen(true);
      setFindFocus((value) => value + 1);
    } else if (command && event.key.toLowerCase() === "g" && goTo) {
      event.preventDefault();
      setFindOpen(false);
      setGoToOpen(true);
    } else if (event.key === "F3") {
      event.preventDefault();
      void find(event.shiftKey ? "backward" : "forward");
    } else if (
      command &&
      event.key.toLowerCase() === "c" &&
      selected &&
      !window.getSelection()?.toString()
    ) {
      event.preventDefault();
      void copySelection().catch(report);
    } else if (
      event.shiftKey &&
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      selection
    ) {
      event.preventDefault();
      const end = Math.max(
        0,
        Math.min(
          source.count - 1,
          selection.end + (event.key === "ArrowDown" ? 1 : -1),
        ),
      );
      select(end, true);
      setScroll({ index: end, key: Date.now() });
    } else if (event.key === "Escape" && (findOpen || goToOpen)) {
      setFindOpen(false);
      setGoToOpen(false);
    }
  };

  const onRange = useCallback(
    (first: number, last: number) => source.ensure(first, last),
    [source],
  );
  const onTop = useCallback(
    (top: number) => {
      if (top !== latest.current.top) onPosition({ ...latest.current, top });
    },
    [onPosition],
  );

  const current = position.match;
  const actions: MenuAction[] = [
    ...(characters
      ? [
          {
            label: ja ? "コピー" : "Copy",
            icon: <ClipboardCopy />,
            shortcut: "Ctrl+C",
            action: "copy-text",
            run: copyCharacters,
          },
        ]
      : []),
    ...(selected
      ? [
          {
            label: ja ? "選択行をコピー" : "Copy selected lines",
            icon: <ClipboardCopy />,
            shortcut: "Ctrl+C",
            action: "copy-lines",
            run: copySelection,
          },
        ]
      : []),
    {
      label: ja ? "検索" : "Find",
      icon: <Search />,
      shortcut: "Ctrl+F",
      action: "open-find",
      run: () => {
        setGoToOpen(false);
        setFindOpen(true);
        setFindFocus((value) => value + 1);
      },
    },
    ...(goTo
      ? [
          {
            label: ja ? "行へ移動" : "Go to line",
            icon: <CornerDownLeft />,
            shortcut: "Ctrl+G",
            action: "open-go-to-line",
            run: () => {
              setFindOpen(false);
              setGoToOpen(true);
            },
          },
        ]
      : []),
    ...extraActions,
  ];
  const menuLines = (() => {
    if (selected) {
      const a = lineOf(selected.first);
      const b = lineOf(selected.last);
      if (a !== undefined && b !== undefined) return { start: a, end: b };
    }
    const line = lineOf(position.top);
    return line === undefined ? undefined : { start: line, end: line };
  })();

  const renderRow = (index: number) => {
    const row =
      (sameDocument ? heldRows.current.get(index) : undefined) ??
      source.row(index);
    if (!row)
      return source.error ? null : (
        <div className="reading-line" data-loading="true" />
      );
    const isSelected =
      selected && index >= selected.first && index <= selected.last;
    const marker =
      row.kind === "added"
        ? "+"
        : row.kind === "deleted"
          ? "−"
          : row.kind === "note"
            ? ""
            : " ";
    if (row.kind === "omission")
      return (
        <div className="reading-line" data-kind="omission">
          <Button
            variant="ghost"
            size="sm"
            className="reading-omission"
            data-iori-action="git-expand-context"
            onClick={() => onExpand?.(index)}
          >
            <ChevronsUpDown />
            {ja
              ? `変更のない${row.omitted}行`
              : `${row.omitted} unchanged lines`}
          </Button>
        </div>
      );
    const rowMatch = current?.row === index ? current : undefined;
    return (
      <div
        className="reading-line"
        data-kind={row.kind}
        data-selected={isSelected ? "true" : undefined}
        data-iori-row={index}
        data-iori-line={source.twoColumns ? undefined : index + 1}
        data-iori-old-line={row.oldLine}
        data-iori-new-line={row.newLine}
      >
        <span
          className="reading-gutter"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget
              .closest<HTMLElement>(".reading-virtual")
              ?.focus({ preventScroll: true });
            select(index, event.shiftKey);
          }}
        >
          {source.twoColumns ? (
            <>
              <span>{row.oldLine ?? ""}</span>
              <span>{row.newLine ?? ""}</span>
            </>
          ) : (
            <span>{index + 1}</span>
          )}
        </span>
        {source.twoColumns && (
          <span className="reading-marker" aria-hidden="true">
            {marker}
          </span>
        )}
        {row.complete && row.text.length <= INLINE_ROW_CHARS ? (
          <span className="reading-line-text">
            {highlights(row.text, position.query, rowMatch, row.syntax)}
          </span>
        ) : (
          <LongLine
            key={`${source.revision}:${source.count}`}
            read={source.read}
            start={row.byteOffset}
            locateEnd={(signal) => source.rowEnd(index, signal)}
            focus={rowMatch}
            retainedWindows={
              characters
                ? [characters.anchor, characters.focus]
                    .filter((point) => point.row === index)
                    .map((point) => point.window)
                : []
            }
            onError={report}
          />
        )}
      </div>
    );
  };

  const effectiveWrap = wrap && source.count <= MAX_WRAPPED_ROWS;
  // Line numbers keep one width for the whole file so the text never shifts.
  const gutterMax = source.count + 1;
  return (
    <div
      className="reading-surface"
      ref={viewport}
      data-iori-match-row={position.match?.row}
      data-iori-match-byte={position.match?.byteOffset}
    >
      {findOpen && (
        <FindBar
          query={position.query}
          onQuery={(query) => {
            searching.current?.abort();
            setStatus(undefined);
            update({ query, match: undefined });
          }}
          onNext={() => void find("forward")}
          onPrevious={() => void find("backward")}
          onClose={() => {
            setFindOpen(false);
            focusRows();
          }}
          status={status}
          locale={locale}
          focusKey={findFocus}
        />
      )}
      {goToOpen && goTo && (
        <GoToLineBar
          max={goTo.max}
          locale={locale}
          onClose={() => {
            setGoToOpen(false);
            focusRows();
          }}
          onGo={(line) => {
            const index = goTo.row(line);
            setGoToOpen(false);
            focusRows();
            setCharacterSelection(undefined);
            heldRows.current.clear();
            window.getSelection()?.removeAllRanges();
            update({ top: index, selection: { start: index, end: index } });
            setScroll({ index, align: "center", key: Date.now() });
          }}
        />
      )}
      {(failure || Boolean(source.error)) && (
        <ReadingError
          centered={Boolean(source.error) && !source.row(position.top)}
          retryLabel={ja ? "再試行" : "Retry"}
          action="reading-retry"
          onRetry={() => {
            setFailure(undefined);
            source.retry();
          }}
        >
          {failure ??
            readErrorCopy(source.error, locale) ??
            (ja ? "読み込めませんでした。" : "Could not read this.")}
        </ReadingError>
      )}
      <PathMenu
        selectable
        path={path}
        lines={menuLines}
        actions={actions}
        locale={locale}
      >
        <div
          className="reading-text"
          data-wrap={effectiveWrap}
          onContextMenuCapture={() => captureSelection.current()}
          onPointerDownCapture={(event) => {
            const target = event.target as Element;
            if (
              event.pointerType !== "mouse" ||
              event.button !== 0 ||
              !target.closest(".reading-line-text") ||
              target.closest(".reading-gutter")
            )
              return;
            setCharacterSelection(undefined);
            heldRows.current.clear();
            const row = (event.target as Element).closest<HTMLElement>(
              "[data-iori-row]",
            );
            if (row) {
              const index = Number(row.dataset.ioriRow);
              const data = source.row(index);
              if (data) heldRows.current.set(index, data);
              setStartingRow(index);
            }
            if (latest.current.selection) update({ selection: undefined });
          }}
          onPointerUpCapture={() => {
            captureSelection.current();
            setStartingRow(undefined);
            if (!characterRef.current) heldRows.current.clear();
          }}
          onCopy={(event) => {
            captureSelection.current();
            if (!characterRef.current) return;
            event.preventDefault();
            void copyCharacters().catch(report);
          }}
          style={
            {
              "--gutter-digits": String(Math.max(3, String(gutterMax).length)),
              "--gutter-columns": source.twoColumns ? "2" : "1",
              "--marker-width": source.twoColumns ? "1.2rem" : "0px",
            } as CSSProperties
          }
        >
          <VirtualRows
            key={effectiveWrap ? "wrap" : "fixed"}
            count={source.count}
            retained={[
              ...(characters
                ? [characters.anchor.row, characters.focus.row]
                : []),
              ...(startingRow === undefined ? [] : [startingRow]),
            ].filter((index) => index >= 0 && index < source.count)}
            rowHeight={rowHeight}
            wrap={effectiveWrap}
            dataId={dataId}
            className="reading-lines"
            initialIndex={position.top}
            scrollRequest={scroll}
            onRange={onRange}
            onPosition={onTop}
            onKeyDown={onKeyDown}
            renderRow={renderRow}
          />
        </div>
      </PathMenu>
    </div>
  );
}
