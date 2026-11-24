import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "cn";
import type { SyntaxSpan } from "@iori/protocol";
import { translator } from "../i18n.ts";
import { Button } from "../components/ui/button";
import { PathMenu, type MenuAction } from "../reading/PathMenu.tsx";
import type { TextRow, TextSource } from "../reading/TextRows.tsx";
import { CODE_ROW_PROBE_CLASS, useRowHeight } from "../reading/rowHeight.ts";
import {
  DiffCommentCard,
  DiffCommentComposer,
  type DiffComment,
} from "./DiffComments.tsx";
import { pairDiffRows, type SplitPair } from "./diff-review.ts";

export { pairDiffRows, type SplitPair };

const OVERSCAN = 10;

const SYNTAX_CLASS: Record<string, string> = {
  comment: "text-(--syntax-comment)",
  keyword: "text-(--syntax-keyword)",
  string: "text-(--syntax-string)",
  number: "text-(--syntax-number)",
  constant: "text-(--syntax-constant)",
  type: "text-(--syntax-type)",
  function: "text-(--syntax-function)",
  variable: "text-(--syntax-variable)",
  property: "text-(--syntax-property)",
  tag: "text-(--syntax-tag)",
  attribute: "text-(--syntax-attribute)",
  operator: "text-(--syntax-operator)",
  regexp: "text-(--syntax-regexp)",
  escape: "text-(--syntax-escape)",
  heading: "font-bold text-(--syntax-heading)",
  emphasis: "italic text-(--syntax-emphasis)",
  strong: "font-bold text-(--syntax-strong)",
  link: "text-(--syntax-link)",
  inserted: "text-(--syntax-inserted)",
  deleted: "text-(--syntax-deleted)",
};

const EMPTY_CELL_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent, transparent 4px, color-mix(in oklch, var(--border) 35%, transparent) 4px, color-mix(in oklch, var(--border) 35%, transparent) 5px)",
};

function renderSyntax(text: string, syntax?: SyntaxSpan[]): ReactNode {
  if (!syntax?.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [column, length, kind] of syntax) {
    const from = Math.max(0, column);
    const to = Math.min(text.length, column + length);
    if (to <= from) continue;
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <span key={from} data-syntax={kind} className={SYNTAX_CLASS[kind]}>
        {text.slice(from, to)}
      </span>,
    );
    at = to;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

type DisplayItem = SplitPair | { kind: "loading"; sourceIndex: number };

type ComposingTarget = {
  side: "old" | "new";
  line: number;
  codeExcerpt: string;
};

function itemSourceRange(item: DisplayItem): [number, number] {
  if (item.kind === "omission" || item.kind === "loading") {
    return [item.sourceIndex, item.sourceIndex];
  }
  const indices: number[] = [];
  if (item.left) indices.push(item.left.sourceIndex);
  if (item.right) indices.push(item.right.sourceIndex);
  if (indices.length === 0) return [0, 0];
  return [Math.min(...indices), Math.max(...indices)];
}

function itemHasSourceIndex(item: DisplayItem, target: number): boolean {
  if (item.kind === "omission" || item.kind === "loading") {
    return item.sourceIndex === target;
  }
  return (
    item.left?.sourceIndex === target || item.right?.sourceIndex === target
  );
}

function cellLineNumber(side: "old" | "new", row: TextRow): number | undefined {
  return side === "old" ? row.oldLine : row.newLine;
}

const MIN_SPLIT_RATIO = 20;
const MAX_SPLIT_RATIO = 80;
const DEFAULT_SPLIT_RATIO = 50;

export function SplitDiffView({
  source,
  path,
  relativePath,
  locale,
  wrap,
  scrollToRow,
  splitRatio,
  onSplitRatio,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  onExpand,
  renderRowBefore,
  extraActions = [],
}: {
  source: TextSource;
  path: string;
  relativePath?: string;
  locale: string;
  wrap: boolean;
  scrollToRow?: { id: number; row: number };
  splitRatio?: number;
  onSplitRatio?: (ratio: number | undefined) => void;
  comments?: DiffComment[];
  onAddComment?: (comment: Omit<DiffComment, "id">) => void;
  onEditComment?: (id: string, body: string) => void;
  onDeleteComment?: (id: string) => void;
  onExpand?: (sourceIndex: number) => void;
  renderRowBefore?: (sourceIndex: number) => ReactNode;
  extraActions?: MenuAction[];
}) {
  const ja = locale.startsWith("ja");
  const t = translator(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const codeRow = useRowHeight(22);
  const [composing, setComposing] = useState<ComposingTarget>();
  const [activeLine, setActiveLine] = useState<number>();
  const [dragRatio, setDragRatio] = useState<number>();
  const clampRatio = (value: number) =>
    Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
  const activeSplitRatio = clampRatio(
    dragRatio ?? splitRatio ?? DEFAULT_SPLIT_RATIO,
  );
  const displayPath = relativePath ?? path;

  // Build display items from loaded rows while preserving unloaded slots so
  // scrolling fetches only the visible range.
  const displayItems: DisplayItem[] = [];
  let loadedBatch: Array<{ sourceIndex: number; row: TextRow }> = [];
  const flushBatch = () => {
    if (loadedBatch.length === 0) return;
    displayItems.push(...pairDiffRows(loadedBatch));
    loadedBatch = [];
  };
  for (let index = 0; index < source.count; index += 1) {
    const row = source.row(index);
    if (row) {
      loadedBatch.push({ sourceIndex: index, row });
    } else {
      flushBatch();
      displayItems.push({ kind: "loading", sourceIndex: index });
    }
  }
  flushBatch();

  const commentsByKey = useMemo(() => {
    const map = new Map<string, DiffComment[]>();
    for (const comment of comments) {
      if (comment.path !== displayPath && comment.absolutePath !== path) {
        continue;
      }
      const key = `${comment.side}:${comment.endLine}`;
      const list = map.get(key);
      if (list) list.push(comment);
      else map.set(key, [comment]);
    }
    return map;
  }, [comments, displayPath, path]);

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => codeRow.height,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const visibleFirst = virtualItems[0]?.index ?? 0;
  const visibleLast =
    virtualItems[virtualItems.length - 1]?.index ??
    Math.min(displayItems.length - 1, 63);

  useEffect(() => {
    if (displayItems.length === 0) return;
    const firstItem = displayItems[Math.max(0, visibleFirst)];
    const lastItem =
      displayItems[Math.min(displayItems.length - 1, visibleLast)];
    if (!firstItem || !lastItem) return;
    const [firstSource] = itemSourceRange(firstItem);
    const [, lastSource] = itemSourceRange(lastItem);
    source.ensure(firstSource, lastSource);
  }, [source, source.revision, source.count, visibleFirst, visibleLast]);

  const scrollTargetRow = scrollToRow?.row;
  const scrollTargetId = scrollToRow?.id;
  useEffect(() => {
    if (scrollTargetRow === undefined || scrollTargetId === undefined) return;
    if (source.count > 0) {
      source.ensure(
        Math.max(0, scrollTargetRow - 20),
        Math.min(source.count - 1, scrollTargetRow + 20),
      );
    }
    const targetIndex = displayItems.findIndex((item) =>
      itemHasSourceIndex(item, scrollTargetRow),
    );
    if (targetIndex >= 0) {
      virtualizer.scrollToIndex(targetIndex, { align: "center" });
    }
  }, [scrollTargetId, scrollTargetRow]);

  const gutterDigits = Math.max(3, String(source.count + 1).length);
  const menuLines =
    activeLine === undefined
      ? undefined
      : { start: activeLine, end: activeLine };

  const renderCell = (
    side: "old" | "new",
    entry?: { sourceIndex: number; row: TextRow },
  ) => {
    if (!entry) {
      return (
        <div
          className="min-w-0 flex-1 bg-muted/40 select-none"
          style={EMPTY_CELL_STYLE}
          data-side={side}
          data-empty="true"
          aria-hidden="true"
        />
      );
    }
    const { row, sourceIndex } = entry;
    const lineNum = cellLineNumber(side, row);
    const tone =
      row.kind === "added"
        ? "bg-diff-add-bg"
        : row.kind === "deleted"
          ? "bg-diff-del-bg"
          : "bg-background";
    const marker =
      row.kind === "added"
        ? "+"
        : row.kind === "deleted"
          ? "−"
          : row.kind === "note"
            ? ""
            : " ";
    const markerTone =
      row.kind === "added"
        ? "text-diff-add-text"
        : row.kind === "deleted"
          ? "text-diff-del-text"
          : "text-muted-foreground";

    return (
      <div
        className={cn(
          "group/cell flex min-h-[1.375rem] min-w-0 flex-1",
          wrap
            ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
            : "overflow-x-auto whitespace-pre",
          tone,
          row.kind === "note" && "italic text-muted-foreground",
        )}
        data-side={side}
        data-kind={row.kind}
        data-iori-row={sourceIndex}
        data-iori-old-line={side === "old" ? lineNum : undefined}
        data-iori-new-line={side === "new" ? lineNum : undefined}
        onMouseEnter={() => {
          if (lineNum !== undefined) setActiveLine(lineNum);
        }}
      >
        <span className="relative flex flex-none items-start text-xs text-muted-foreground select-none">
          {onAddComment && lineNum !== undefined && (
            <button
              type="button"
              className="flex size-[1.375rem] flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-primary opacity-0 transition-opacity outline-none group-hover/cell:opacity-100 hover:bg-primary/15 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:opacity-100"
              data-iori-action="diff-add-comment"
              data-side={side}
              data-line={lineNum}
              aria-label={ja ? "コメントを追加" : "Add comment"}
              title={ja ? "コメントを追加" : "Add comment"}
              onClick={() =>
                setComposing({
                  side,
                  line: lineNum,
                  codeExcerpt: row.text,
                })
              }
            >
              <Plus className="size-3.5" />
            </button>
          )}
          <span className="inline-block box-content w-[calc(var(--gutter-digits,4)*0.6em)] pr-2.5 pl-1.5 text-right tabular-nums">
            {lineNum ?? ""}
          </span>
        </span>
        <span
          className={cn("w-4 flex-none text-center select-none", markerTone)}
          aria-hidden="true"
        >
          {marker}
        </span>
        <span className="reading-line-text min-w-0 flex-1 pr-3">
          {renderSyntax(row.text, row.syntax)}
        </span>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 flex-col"
      data-iori-view="git-diff-split"
      style={
        {
          "--split-left": `${activeSplitRatio}%`,
        } as CSSProperties
      }
    >
      <div
        ref={codeRow.probe}
        className={CODE_ROW_PROBE_CLASS}
        aria-hidden="true"
      />
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-valuemin={MIN_SPLIT_RATIO}
        aria-valuemax={MAX_SPLIT_RATIO}
        aria-valuenow={Math.round(activeSplitRatio)}
        aria-label={ja ? "左右の差分の幅" : "Split diff width"}
        data-iori-action="git-split-diff-resize"
        className="absolute inset-y-0 z-10 w-px -translate-x-1/2 cursor-col-resize touch-none bg-transparent transition-colors before:absolute before:inset-y-0 before:-inset-x-[4px] before:content-[''] hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none [@media(pointer:coarse)]:before:-inset-x-2"
        style={{ left: `${activeSplitRatio}%` }}
        onDoubleClick={() => {
          setDragRatio(undefined);
          onSplitRatio?.(undefined);
        }}
        onPointerDown={(event) => {
          const box = containerRef.current;
          if (!box) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          const bounds = box.getBoundingClientRect();
          if (bounds.width <= 0) return;
          let latest = activeSplitRatio;
          const move = (moved: PointerEvent) => {
            latest = Math.round(
              clampRatio(((moved.clientX - bounds.left) / bounds.width) * 100),
            );
            setDragRatio(latest);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
            setDragRatio(undefined);
            onSplitRatio?.(latest);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
          window.addEventListener("pointercancel", up);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = Math.round(
            clampRatio(activeSplitRatio + (event.key === "ArrowLeft" ? -2 : 2)),
          );
          onSplitRatio?.(next);
        }}
      />
      <PathMenu
        selectable
        path={path}
        relativePath={relativePath}
        lines={menuLines}
        actions={extraActions}
        locale={locale}
      >
        <div
          ref={scrollerRef}
          className="reading-virtual min-h-0 min-w-0 flex-1 overflow-auto bg-background font-mono text-[0.8125rem] leading-[1.375rem] [overflow-anchor:none] outline-none"
          data-iori-scroll="git-diff-split"
          data-iori-row-count={displayItems.length}
          tabIndex={0}
          style={
            {
              "--gutter-digits": String(gutterDigits),
            } as CSSProperties
          }
        >
          <div
            className="relative min-w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualItem) => {
              const item = displayItems[virtualItem.index];
              if (!item) return null;

              if (item.kind === "loading") {
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 w-full min-h-[1.375rem] opacity-0"
                    style={{ top: virtualItem.start }}
                    data-loading="true"
                  />
                );
              }

              if (item.kind === "omission") {
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 w-full"
                    style={{ top: virtualItem.start }}
                    data-kind="omission"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-[1.375rem] w-full justify-start rounded-none border-y border-border-subtle bg-muted/60 font-sans text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      data-iori-action="git-expand-context"
                      onClick={() => onExpand?.(item.sourceIndex)}
                    >
                      <ChevronsUpDown />
                      {t("{value1} unchanged lines").replace("{value1}", () =>
                        String(item.omitted),
                      )}
                    </Button>
                  </div>
                );
              }

              const leftLine = item.left
                ? cellLineNumber("old", item.left.row)
                : undefined;
              const rightLine = item.right
                ? cellLineNumber("new", item.right.row)
                : undefined;
              const leftComments =
                leftLine === undefined
                  ? []
                  : (commentsByKey.get(`old:${leftLine}`) ?? []);
              const rightComments =
                rightLine === undefined
                  ? []
                  : (commentsByKey.get(`new:${rightLine}`) ?? []);
              const composingLeft =
                composing &&
                composing.side === "old" &&
                leftLine !== undefined &&
                composing.line === leftLine;
              const composingRight =
                composing &&
                composing.side === "new" &&
                rightLine !== undefined &&
                composing.line === rightLine;
              const hasThread =
                leftComments.length > 0 ||
                rightComments.length > 0 ||
                Boolean(composingLeft) ||
                Boolean(composingRight);

              const beforeSlot =
                (item.left ? renderRowBefore?.(item.left.sourceIndex) : null) ||
                (item.right ? renderRowBefore?.(item.right.sourceIndex) : null);

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 w-full"
                  style={{ top: virtualItem.start }}
                >
                  {beforeSlot}
                  <div
                    className="grid divide-x divide-border-subtle"
                    style={{
                      gridTemplateColumns:
                        "minmax(0, var(--split-left, 50%)) minmax(0, calc(100% - var(--split-left, 50%)))",
                    }}
                  >
                    {renderCell("old", item.left)}
                    {renderCell("new", item.right)}
                  </div>
                  {hasThread && (
                    <div
                      className="grid divide-x divide-border-subtle border-y border-border-subtle bg-muted/20"
                      style={{
                        gridTemplateColumns:
                          "minmax(0, var(--split-left, 50%)) minmax(0, calc(100% - var(--split-left, 50%)))",
                      }}
                    >
                      <div className="min-w-0 px-3 py-1">
                        {leftComments.map((comment) => (
                          <DiffCommentCard
                            key={comment.id}
                            comment={comment}
                            locale={locale}
                            onEdit={(id, body) => onEditComment?.(id, body)}
                            onDelete={(id) => onDeleteComment?.(id)}
                          />
                        ))}
                        {composingLeft && composing && (
                          <DiffCommentComposer
                            path={displayPath}
                            side="old"
                            startLine={composing.line}
                            endLine={composing.line}
                            locale={locale}
                            onSubmit={(body) => {
                              onAddComment?.({
                                path: displayPath,
                                absolutePath: path,
                                side: "old",
                                startLine: composing.line,
                                endLine: composing.line,
                                codeExcerpt: composing.codeExcerpt,
                                body,
                              });
                              setComposing(undefined);
                            }}
                            onCancel={() => setComposing(undefined)}
                          />
                        )}
                      </div>
                      <div className="min-w-0 px-3 py-1">
                        {rightComments.map((comment) => (
                          <DiffCommentCard
                            key={comment.id}
                            comment={comment}
                            locale={locale}
                            onEdit={(id, body) => onEditComment?.(id, body)}
                            onDelete={(id) => onDeleteComment?.(id)}
                          />
                        ))}
                        {composingRight && composing && (
                          <DiffCommentComposer
                            path={displayPath}
                            side="new"
                            startLine={composing.line}
                            endLine={composing.line}
                            locale={locale}
                            onSubmit={(body) => {
                              onAddComment?.({
                                path: displayPath,
                                absolutePath: path,
                                side: "new",
                                startLine: composing.line,
                                endLine: composing.line,
                                codeExcerpt: composing.codeExcerpt,
                                body,
                              });
                              setComposing(undefined);
                            }}
                            onCancel={() => setComposing(undefined)}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </PathMenu>
    </div>
  );
}
