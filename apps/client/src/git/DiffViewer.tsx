import { translator } from "../i18n.ts";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  FileCode2,
  History,
  Minus,
  Plus,
  Rows2,
  Search,
  Undo2,
  WrapText,
} from "lucide-react";
import type { GitDiffSource } from "@iori/protocol";
import { Button } from "../components/ui/button";
import { TextRows, type TextPosition } from "../reading/TextRows.tsx";
import { readErrorCopy, type ReadingTransport } from "../reading/transport.ts";
import type { MenuAction } from "../reading/PathMenu.tsx";
import { DiffDocument } from "./DiffDocument.ts";
import { ReadingError } from "../reading/ReadingError.tsx";
import { ReadingLoading } from "../reading/ReadingStates.tsx";
import { useGitImages } from "./image-source.ts";
import { GitImageDiff } from "./GitImageDiff.tsx";
import { SplitDiffView } from "./SplitDiffView.tsx";
import {
  DiffCommentCard,
  DiffCommentComposer,
  type DiffComment,
} from "./DiffComments.tsx";

export type DiffPosition = TextPosition & { wrap: boolean };
export const emptyDiffPosition = (): DiffPosition => ({
  top: 0,
  query: "",
  wrap: false,
});

/** One file's diff: a header line, short notes when needed, and the rows. */
export function DiffViewer({
  transport,
  root,
  source,
  absolutePath,
  relativePath,
  refreshKey,
  position,
  onPosition,
  locale,
  lead,
  title,
  onFileHistory,
  onOpenInFiles,
  notes = [],
  active = true,
  narrow = false,
  split = false,
  onSplitChange,
  viewed,
  onToggleViewed,
  comments = [],
  onAddComment,
  onEditComment,
  onDeleteComment,
  commentJump,
  onRevision,
  onHunkAction,
  hunkBusy = false,
  onBackHandler,
}: {
  transport: ReadingTransport;
  root: string;
  source: GitDiffSource;
  absolutePath: string;
  relativePath?: string;
  /** Increments when the Host may have a different diff for this source. */
  refreshKey: number;
  position: DiffPosition;
  onPosition: (value: DiffPosition) => void;
  locale: string;
  lead?: ReactNode;
  title: ReactNode;
  onFileHistory?: () => void;
  onOpenInFiles?: (line?: number) => void;
  notes?: string[];
  active?: boolean;
  narrow?: boolean;
  split?: boolean;
  onSplitChange?: (split: boolean) => void;
  viewed?: boolean;
  onToggleViewed?: () => void;
  comments?: DiffComment[];
  onAddComment?: (
    comment: Omit<DiffComment, "id" | "path" | "absolutePath">,
  ) => void;
  onEditComment?: (id: string, body: string) => void;
  onDeleteComment?: (id: string) => void;
  commentJump?: { id: number; side: "old" | "new"; line: number };
  onRevision?: (revision: string) => void;
  onHunkAction?: (
    action: "stage" | "unstage" | "discard",
    hunkIndex: number,
    fingerprint: string,
  ) => void;
  hunkBusy?: boolean;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
}) {
  const t = translator(locale);
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [findRequest, setFindRequest] = useState(0);
  const [scrollToRow, setScrollToRow] = useState<{ id: number; row: number }>();
  const lastManualTopRef = useRef(position.top);
  const lastHunkRowRef = useRef<number | undefined>(undefined);
  if (position.top !== lastManualTopRef.current) {
    lastManualTopRef.current = position.top;
    lastHunkRowRef.current = undefined;
  }
  const [composing, setComposing] = useState<{
    side: "old" | "new";
    line: number;
    codeExcerpt: string;
  }>();
  const key = JSON.stringify(source);
  const document = useMemo(
    () => new DiffDocument(transport, root, source, render),
    [transport, root, key],
  );
  useEffect(() => {
    // Changes in the worktree are diffed again; a commit's diff never changes.
    document.open(source.kind !== "commit" || refreshKey !== 0);
    return () => document.dispose();
  }, [document, refreshKey]);
  useEffect(() => {
    if (document.revision) onRevision?.(document.revision);
  }, [document.revision, onRevision]);
  useEffect(() => {
    if (!commentJump || !document.revision) return;
    const row = document.rowIndexForLine(commentJump.side, commentJump.line);
    if (row !== undefined) setScrollToRow({ id: commentJump.id, row });
  }, [commentJump, document, document.revision]);

  const info = document.info;
  const singleImage = Boolean(
    document.revision &&
    document.totalRows === 0 &&
    !info?.binary &&
    "oldPath" in source &&
    source.oldPath,
  );
  const imageCandidate =
    source.kind !== "stage" && Boolean(info?.binary || singleImage);
  const { images, retry: retryImage } = useGitImages(
    transport,
    root,
    source,
    imageCandidate && active,
    singleImage,
    refreshKey,
    locale,
  );
  const isImage =
    imageCandidate &&
    Object.values(images).some(
      (image) => image.info?.present && image.mimeType?.startsWith("image/"),
    );
  const probingImage =
    imageCandidate &&
    !Object.values(images).every((image) => image.info || image.error);
  const shown: string[] = [...notes];
  if (info?.binary && !isImage && !probingImage)
    shown.push(t("Binary file: there is no line diff."));
  if (info?.directory)
    shown.push(
      t(
        "This is a folder (such as a nested repository); there is no line diff.",
      ),
    );
  if (
    info?.newFile &&
    !(source.kind === "change" && source.area === "untracked")
  )
    shown.push(t("This file was added."));
  if (info?.deletedFile) shown.push(t("This file was deleted."));
  if (info?.oldMode && info.newMode && info.oldMode !== info.newMode)
    shown.push(
      t("Mode changed: {value1} → {value2}")
        .replace("{value1}", () => String(info.oldMode))
        .replace("{value2}", () => String(info.newMode)),
    );
  if (
    document.revision &&
    document.totalRows === 0 &&
    !info?.binary &&
    !info?.directory
  )
    shown.push(t("There are no content changes."));
  const shownHunks = document.shownHunks();
  const jumpHunk = (direction: "prev" | "next") => {
    if (shownHunks.length === 0) return;
    const currentRow = lastHunkRowRef.current ?? position.top;
    let target: number | undefined;
    if (direction === "next") {
      target = shownHunks.find((row) => row > currentRow) ?? shownHunks[0];
    } else {
      for (let i = shownHunks.length - 1; i >= 0; i -= 1) {
        if (shownHunks[i]! < currentRow) {
          target = shownHunks[i];
          break;
        }
      }
      target ??= shownHunks.at(-1);
    }
    if (target !== undefined) {
      lastHunkRowRef.current = target;
      setScrollToRow((prev) => ({ id: (prev?.id ?? 0) + 1, row: target! }));
    }
  };
  const openLine =
    position.selection !== undefined
      ? document.lineOf(position.selection.start)
      : document.firstChangedLine();
  const actions: MenuAction[] = [
    ...(onOpenInFiles
      ? [
          {
            label: t("Open in Files"),
            icon: <FileCode2 />,
            action: "git-open-in-files",
            run: () => onOpenInFiles(openLine),
          },
        ]
      : []),
    ...(onFileHistory
      ? [
          {
            label: t("File history"),
            icon: <History />,
            action: "file-history",
            run: onFileHistory,
          },
        ]
      : []),
  ];
  const effectiveSplit = Boolean(split && !narrow && !isImage);
  const displayPath = relativePath ?? source.path;
  const hunkArea =
    source.kind === "change" &&
    (source.area === "staged" || source.area === "unstaged")
      ? source.area
      : undefined;
  const patchHunksByShownRow = new Map<
    number,
    { hunkIndex: number; fingerprint: string }
  >();
  if (onHunkAction && hunkArea) {
    for (const item of document.shownPatchHunks()) {
      patchHunksByShownRow.set(item.shownRow, {
        hunkIndex: item.hunkIndex,
        fingerprint: item.fingerprint,
      });
    }
  }
  const renderHunkBar = (shownRow: number) => {
    if (!onHunkAction || !hunkArea) return null;
    const hunk = patchHunksByShownRow.get(shownRow);
    if (!hunk) return null;
    return (
      <div
        className="flex items-center justify-end gap-1 border-y border-border-subtle bg-muted/50 px-2 py-0.5 font-sans text-2xs"
        data-iori-part="git-hunk-actions"
        data-hunk-index={hunk.hunkIndex}
      >
        {hunkArea === "unstaged" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={hunkBusy}
              className="h-5 gap-1 px-1.5 text-2xs [@media(pointer:coarse)]:min-h-8"
              data-iori-action="git-hunk-stage"
              data-hunk-index={hunk.hunkIndex}
              onClick={() =>
                onHunkAction("stage", hunk.hunkIndex, hunk.fingerprint)
              }
            >
              <Plus className="size-3" aria-hidden="true" />
              <span>{t("Stage hunk")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={hunkBusy}
              className="h-5 gap-1 px-1.5 text-2xs text-destructive hover:text-destructive [@media(pointer:coarse)]:min-h-8"
              data-iori-action="git-hunk-discard"
              data-hunk-index={hunk.hunkIndex}
              onClick={() =>
                onHunkAction("discard", hunk.hunkIndex, hunk.fingerprint)
              }
            >
              <Undo2 className="size-3" aria-hidden="true" />
              <span>{t("Discard hunk")}</span>
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={hunkBusy}
            className="h-5 gap-1 px-1.5 text-2xs [@media(pointer:coarse)]:min-h-8"
            data-iori-action="git-hunk-unstage"
            data-hunk-index={hunk.hunkIndex}
            onClick={() =>
              onHunkAction("unstage", hunk.hunkIndex, hunk.fingerprint)
            }
          >
            <Minus className="size-3" aria-hidden="true" />
            <span>{t("Unstage hunk")}</span>
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className="flex h-9 min-w-0 flex-none items-center gap-1 border-b border-border px-1.5 [@media(pointer:coarse)]:h-11"
        data-iori-part="diff-header"
      >
        {lead}
        {title}
        <span className="flex-1" />
        {!isImage && shownHunks.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="[@media(pointer:coarse)]:size-11"
              data-iori-action="git-diff-prev-hunk"
              aria-label={t("Previous change")}
              title={t("Previous change")}
              onClick={() => jumpHunk("prev")}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="[@media(pointer:coarse)]:size-11"
              data-iori-action="git-diff-next-hunk"
              aria-label={t("Next change")}
              title={t("Next change")}
              onClick={() => jumpHunk("next")}
            >
              <ChevronDown />
            </Button>
          </>
        )}
        {!isImage && !narrow && onSplitChange && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11"
            data-iori-action="git-diff-split"
            aria-pressed={effectiveSplit}
            aria-label={effectiveSplit ? t("Inline diff") : t("Side by side")}
            title={effectiveSplit ? t("Inline diff") : t("Side by side")}
            onClick={() => onSplitChange(!split)}
          >
            {effectiveSplit ? <Rows2 /> : <Columns2 />}
          </Button>
        )}
        {onToggleViewed && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:min-h-11"
            data-iori-action="git-diff-viewed"
            aria-pressed={Boolean(viewed)}
            onClick={onToggleViewed}
          >
            <Check className="size-3.5" aria-hidden="true" />
            <span>{t("Viewed")}</span>
          </Button>
        )}
        {onOpenInFiles && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="[@media(pointer:coarse)]:size-11"
            data-iori-action="git-open-in-files"
            aria-label={t("Open in Files")}
            title={t("Open in Files")}
            onClick={() => onOpenInFiles(openLine)}
          >
            <FileCode2 />
          </Button>
        )}
        {!isImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11"
            data-iori-action="git-diff-wrap"
            aria-pressed={position.wrap}
            aria-label={t("Wrap lines")}
            title={t("Wrap lines")}
            onClick={() => onPosition({ ...position, wrap: !position.wrap })}
          >
            <WrapText />
          </Button>
        )}
        {onFileHistory && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="[@media(pointer:coarse)]:size-11"
            data-iori-action="git-file-history"
            aria-label={t("File history")}
            title={t("File history")}
            onClick={onFileHistory}
          >
            <History />
          </Button>
        )}
        {!isImage && !effectiveSplit && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="[@media(pointer:coarse)]:size-11"
            data-iori-action="open-find"
            aria-label={t("Find in diff")}
            title={t("Find in diff (Ctrl+F)")}
            onClick={() => setFindRequest((value) => value + 1)}
          >
            <Search />
          </Button>
        )}
      </div>
      {shown.length > 0 && (
        <div
          className="flex-none border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground [&_p]:my-0.5"
          data-iori-part="diff-notes"
        >
          {shown.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
      {!document.revision && document.error ? (
        <ReadingError
          centered
          retryLabel={t("Retry")}
          onRetry={() => document.retry()}
        >
          {readErrorCopy(document.error, locale)}
        </ReadingError>
      ) : isImage || (probingImage && !singleImage) ? (
        <GitImageDiff
          images={images}
          active={active}
          single={singleImage}
          locale={locale}
          retry={retryImage}
          onBackHandler={onBackHandler}
        />
      ) : (
        <div
          className="reading-body relative flex min-h-0 flex-1 flex-col"
          onKeyDown={(event) => {
            if (event.altKey && !event.ctrlKey && !event.metaKey) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                jumpHunk("next");
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                jumpHunk("prev");
              }
            }
          }}
        >
          {!document.revision ? (
            <ReadingLoading label={t("Loading")} rows={6} />
          ) : (
            document.totalRows > 0 &&
            (effectiveSplit ? (
              <SplitDiffView
                key={key}
                source={document}
                path={absolutePath}
                relativePath={displayPath}
                locale={locale}
                wrap={position.wrap}
                scrollToRow={scrollToRow}
                comments={comments}
                onAddComment={onAddComment}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                onExpand={(index) => document.expand(index)}
                renderRowBefore={
                  patchHunksByShownRow.size > 0 ? renderHunkBar : undefined
                }
                extraActions={actions}
              />
            ) : (
              <TextRows
                key={key}
                source={document}
                path={absolutePath}
                lineOf={(index) => document.lineOf(index)}
                position={position}
                onPosition={(value) => onPosition({ ...position, ...value })}
                wrap={position.wrap}
                locale={locale}
                dataId="git-diff"
                findRequest={findRequest}
                scrollToRow={scrollToRow}
                onExpand={(index) => document.expand(index)}
                extraActions={actions}
                onAddRowComment={
                  onAddComment
                    ? ({ side, line, text }) =>
                        setComposing({ side, line, codeExcerpt: text })
                    : undefined
                }
                hasInlineSlots={
                  Boolean(composing) ||
                  comments.length > 0 ||
                  patchHunksByShownRow.size > 0
                }
                renderRowBefore={
                  patchHunksByShownRow.size > 0
                    ? ({ rowIndex }) => renderHunkBar(rowIndex)
                    : undefined
                }
                renderRowAfter={
                  onAddComment || comments.length > 0
                    ? ({ row }) => {
                        const rowComments = comments.filter(
                          (comment) =>
                            (comment.side === "old" &&
                              row.oldLine === comment.endLine) ||
                            (comment.side === "new" &&
                              row.newLine === comment.endLine),
                        );
                        const showComposer =
                          composing &&
                          ((composing.side === "old" &&
                            row.oldLine === composing.line) ||
                            (composing.side === "new" &&
                              row.newLine === composing.line));
                        if (!showComposer && rowComments.length === 0)
                          return null;
                        return (
                          <div className="flex flex-col gap-1.5">
                            {rowComments.map((comment) => (
                              <DiffCommentCard
                                key={comment.id}
                                comment={comment}
                                locale={locale}
                                onEdit={(id, body) => onEditComment?.(id, body)}
                                onDelete={(id) => onDeleteComment?.(id)}
                              />
                            ))}
                            {showComposer && (
                              <DiffCommentComposer
                                path={displayPath}
                                side={composing.side}
                                startLine={composing.line}
                                endLine={composing.line}
                                locale={locale}
                                onSubmit={(body) => {
                                  onAddComment?.({
                                    side: composing.side,
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
                        );
                      }
                    : undefined
                }
              />
            ))
          )}
        </div>
      )}
    </>
  );
}
