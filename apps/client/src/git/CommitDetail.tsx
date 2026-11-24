import { translator } from "../i18n.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { GitCommitFile, ReadResultByMethod } from "@iori/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { VirtualRows } from "../reading/VirtualRows.tsx";
import { PathMenu } from "../reading/PathMenu.tsx";
import { writePathDrag } from "../path-drag.ts";
import { usePagedList } from "../reading/paged.ts";
import {
  ReadConnectionLost,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import { formatDate } from "../reading/format.ts";
import { LIST_ROW_PROBE_CLASS, useRowHeight } from "../reading/rowHeight.ts";
import { ChangeIcon, kindName, parentDirectory } from "./changes.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";
import { ReadingEmpty, ReadingLoading } from "../reading/ReadingStates.tsx";

type Commit = ReadResultByMethod["git.commit"];

/** A commit's full message, author, parents and changed files. */
export function CommitDetail({
  transport,
  root,
  repositoryRoot,
  hostKey,
  hash,
  refreshKey,
  parent,
  onParent,
  onOpenFile,
  locale,
  lead,
  detailHeight,
  onDetailHeight,
}: {
  transport: ReadingTransport;
  root: string;
  repositoryRoot: string;
  hostKey: string;
  hash: string;
  /** A new watch subscription reads again after reconnecting or showing the View. */
  refreshKey: number;
  parent?: string;
  onParent: (parent: string) => void;
  onOpenFile: (file: GitCommitFile) => void;
  locale: string;
  lead?: ReactNode;
  detailHeight?: number;
  onDetailHeight?: (height: number | undefined) => void;
}) {
  const ja = locale.startsWith("ja");
  const t = translator(locale);
  const [commit, setCommit] = useState<Commit>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const [dragHeight, setDragHeight] = useState<number>();
  const detailRef = useRef<HTMLDivElement>(null);
  const activeHeight = dragHeight ?? detailHeight;
  useEffect(() => {
    const controller = new AbortController();
    // The parent keys this component by hash. Keep the last body during a
    // reconnect/read retry rather than blanking it and resetting the file list.
    void (async () => {
      const value = await transport.request(
        "git.commit",
        { root, hash },
        controller.signal,
      );
      let message = value.message;
      let next = value.messageNextOffset;
      while (next !== undefined) {
        const more = await transport.request(
          "git.commitMessage",
          { root, hash, offset: next },
          controller.signal,
        );
        message += more.text;
        next = more.nextOffset;
      }
      setCommit({ ...value, message });
      setError(undefined);
    })().catch((cause: unknown) => {
      if (
        controller.signal.aborted ||
        isAbort(cause) ||
        cause instanceof ReadConnectionLost
      )
        return;
      setError(readErrorCopy(cause, locale));
    });
    return () => controller.abort();
  }, [transport, root, hash, retry, refreshKey]);

  const merge = (commit?.parents.length ?? 0) > 1;
  const compared = merge ? parent : undefined;
  const ready = commit && (!merge || compared);
  const files = usePagedList<GitCommitFile>(
    JSON.stringify([root, hash, compared ?? "", Boolean(ready)]),
    async (start, count, signal) => {
      if (!ready) return { items: [], total: 0 };
      const result = await transport.request(
        "git.commitFiles",
        { root, hash, ...(compared ? { parent: compared } : {}), start, count },
        signal,
      );
      return { items: result.files, total: result.total };
    },
  );
  useEffect(() => files.refresh(), [files, refreshKey]);
  const [subject, ...body] = (commit?.message ?? "").split("\n");
  const row = useRowHeight();

  return (
    <>
      <div
        ref={row.probe}
        className={LIST_ROW_PROBE_CLASS}
        aria-hidden="true"
      />
      <div
        className="flex h-9 min-w-0 flex-none items-center gap-1.5 border-b border-border px-1.5 [@media(pointer:coarse)]:h-11"
        data-iori-part="commit-header"
      >
        {lead}
        <code
          className="shrink-0 font-mono text-xs text-muted-foreground"
          title={hash}
        >
          {hash.slice(0, 10)}
        </code>
        <span className="min-w-0 truncate px-1 text-xs font-semibold text-foreground">
          {subject}
        </span>
      </div>
      {error && (
        <ReadingError
          centered={!commit}
          retryLabel={t("Retry")}
          onRetry={() => setRetry((value) => value + 1)}
        >
          {error}
        </ReadingError>
      )}
      {!commit && !error && <ReadingLoading label={t("Loading")} rows={5} />}
      {commit && (
        <div
          ref={detailRef}
          className={
            activeHeight === undefined
              ? "max-h-[45%] flex-none overflow-auto px-3 py-2.5"
              : "max-h-[75%] flex-none overflow-auto px-3 py-2.5"
          }
          style={
            activeHeight !== undefined
              ? { height: `${activeHeight}px` }
              : undefined
          }
          data-iori-part="commit-detail"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{commit.author}</span>
            <time>{formatDate(commit.authorTimeMs, locale)}</time>
          </div>
          {body.join("\n").trim() && (
            <pre
              className="my-2 font-sans text-xs leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]"
              data-iori-part="commit-message"
            >
              {body.join("\n").trim()}
            </pre>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground [&_code]:font-mono">
            {commit.parents.length === 0 && (
              <span>{t("Root commit (no parent)")}</span>
            )}
            {commit.parents.length === 1 && (
              <span>
                {t("Parent")} <code>{commit.parents[0]!.slice(0, 10)}</code>
              </span>
            )}
            {merge && (
              <>
                <span>{t("Compare with parent")}</span>
                <Select value={parent ?? ""} onValueChange={onParent}>
                  <SelectTrigger
                    size="sm"
                    className="[@media(pointer:coarse)]:min-h-11"
                    aria-label={t("Parent to compare")}
                    data-iori-action="git-parent-select"
                  >
                    <SelectValue placeholder={t("Choose a parent")} />
                  </SelectTrigger>
                  <SelectContent>
                    {commit.parents.map((value, index) => (
                      <SelectItem key={value} value={value}>
                        {t("Parent {value1}").replace("{value1}", () =>
                          String(index + 1),
                        )}{" "}
                        · {value.slice(0, 10)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        </div>
      )}
      {commit && !ready && (
        <div className="h-px flex-none bg-border" aria-hidden="true" />
      )}
      {commit && ready && (
        <div
          role="separator"
          aria-orientation="horizontal"
          tabIndex={0}
          aria-label={ja ? "コミット詳細の高さ" : "Commit details height"}
          aria-valuenow={
            activeHeight !== undefined ? Math.round(activeHeight) : undefined
          }
          data-iori-action="git-commit-detail-resize"
          className="relative h-px flex-none cursor-row-resize touch-none bg-border transition-colors before:absolute before:inset-x-0 before:-inset-y-[3px] before:z-[2] before:content-[''] hover:bg-primary/50 focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:before:-inset-y-2"
          onDoubleClick={() => {
            setDragHeight(undefined);
            onDetailHeight?.(undefined);
          }}
          onPointerDown={(event) => {
            const box = detailRef.current;
            if (!box) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const startY = event.clientY;
            const startHeight = box.getBoundingClientRect().height;
            const parentHeight =
              box.parentElement?.getBoundingClientRect().height ??
              window.innerHeight;
            const maxHeight = Math.max(120, Math.round(parentHeight * 0.75));
            let latest = startHeight;
            const clamp = (value: number) =>
              Math.round(Math.min(maxHeight, Math.max(56, value)));
            const move = (moved: PointerEvent) => {
              latest = clamp(startHeight + (moved.clientY - startY));
              setDragHeight(latest);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", up);
              setDragHeight(undefined);
              onDetailHeight?.(latest);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", up);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            const box = detailRef.current;
            const current =
              activeHeight ?? box?.getBoundingClientRect().height ?? 160;
            const parentHeight =
              box?.parentElement?.getBoundingClientRect().height ??
              window.innerHeight;
            const maxHeight = Math.max(120, Math.round(parentHeight * 0.75));
            const next = Math.round(
              Math.min(
                maxHeight,
                Math.max(56, current + (event.key === "ArrowUp" ? -24 : 24)),
              ),
            );
            onDetailHeight?.(next);
          }}
        />
      )}
      {commit && merge && !compared && (
        <ReadingEmpty title={t("Choose a parent to see the changes.")} />
      )}
      {ready && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="git-section-heading flex h-7 flex-none items-center gap-1.5 border-b border-border-subtle px-2.5 text-xs font-semibold text-muted-foreground [@media(pointer:coarse)]:h-10"
            data-static="true"
          >
            <span>{t("Changed files")}</span>
            {files.total !== undefined && (
              <span className="git-count ml-auto rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular-nums">
                {files.total}
              </span>
            )}
          </div>
          {Boolean(files.error) && (
            <ReadingError retryLabel={t("Retry")} onRetry={() => files.retry()}>
              {readErrorCopy(files.error, locale)}
            </ReadingError>
          )}
          <VirtualRows
            count={files.count}
            rowHeight={row.height}
            dataId="git-commit-files"
            className="py-0.5 [&_.reading-virtual-row]:w-full"
            label={t("Files in the commit")}
            onRange={(first, last) => files.ensure(first, last)}
            renderRow={(index) => {
              const file = files.get(index);
              if (!file) return <div className="h-full" data-loading="true" />;
              const name = file.path.slice(file.path.lastIndexOf("/") + 1);
              return (
                <PathMenu path={file.absolutePath} locale={locale}>
                  <button
                    type="button"
                    className="flex h-full w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent pr-2.5 pl-5 text-left text-xs whitespace-nowrap text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset [@media(hover:hover)]:hover:bg-muted/70"
                    data-iori-action="git-commit-file-select"
                    data-path={file.path}
                    title={`${file.oldPath ? `${file.oldPath} → ` : ""}${file.path} · ${kindName(file.kind, ja)}`}
                    draggable
                    onDragStart={(event) =>
                      writePathDrag(event.dataTransfer, {
                        hostKey,
                        root: repositoryRoot,
                        path: file.path,
                        absolutePath: file.absolutePath,
                      })
                    }
                    onClick={() => onOpenFile(file)}
                  >
                    <ChangeIcon kind={file.kind} ja={ja} />
                    <span className="min-w-0 flex-[0_1_auto] truncate">
                      {name}
                    </span>
                    <span className="min-w-0 flex-[0_1000_auto] truncate text-xs text-muted-foreground">
                      {parentDirectory(file.path)}
                    </span>
                  </button>
                </PathMenu>
              );
            }}
          />
        </div>
      )}
    </>
  );
}
