import { useEffect, useState, type ReactNode } from "react";
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
import { useRowHeight } from "../reading/rowHeight.ts";
import { ChangeIcon, kindName, parentDirectory } from "./changes.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";

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
}) {
  const ja = locale.startsWith("ja");
  const [commit, setCommit] = useState<Commit>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
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
      <div ref={row.probe} className="reading-row-probe" aria-hidden="true" />
      <div className="reading-header" data-iori-part="commit-header">
        {lead}
        <code className="git-hash" title={hash}>
          {hash.slice(0, 10)}
        </code>
        <span className="reading-truncate git-commit-title">{subject}</span>
      </div>
      {error && (
        <ReadingError
          retryLabel={ja ? "再試行" : "Retry"}
          onRetry={() => setRetry((value) => value + 1)}
        >
          {error}
        </ReadingError>
      )}
      {commit && (
        <div className="git-commit-detail" data-iori-part="commit-detail">
          <div className="git-commit-meta">
            <span>{commit.author}</span>
            <time>{formatDate(commit.authorTimeMs, locale)}</time>
          </div>
          {body.join("\n").trim() && (
            <pre className="git-commit-message" data-iori-part="commit-message">
              {body.join("\n").trim()}
            </pre>
          )}
          <div className="git-commit-parents">
            {commit.parents.length === 0 && (
              <span>
                {ja ? "最初の commit（親なし）" : "Root commit (no parent)"}
              </span>
            )}
            {commit.parents.length === 1 && (
              <span>
                {ja ? "親" : "Parent"}{" "}
                <code>{commit.parents[0]!.slice(0, 10)}</code>
              </span>
            )}
            {merge && (
              <>
                <span>{ja ? "差分を見る親" : "Compare with parent"}</span>
                <Select value={parent ?? ""} onValueChange={onParent}>
                  <SelectTrigger
                    size="sm"
                    aria-label={ja ? "比べる親" : "Parent to compare"}
                    data-iori-action="git-parent-select"
                  >
                    <SelectValue
                      placeholder={ja ? "親を選ぶ" : "Choose a parent"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {commit.parents.map((value, index) => (
                      <SelectItem key={value} value={value}>
                        {ja ? `親 ${index + 1}` : `Parent ${index + 1}`} ·{" "}
                        {value.slice(0, 10)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
        </div>
      )}
      {commit && merge && !compared && (
        <p className="reading-empty">
          {ja
            ? "差分を見る親を選んでください。"
            : "Choose a parent to see the changes."}
        </p>
      )}
      {ready && (
        <div className="git-commit-files">
          <div className="git-section-heading" data-static="true">
            <span>{ja ? "変更したファイル" : "Changed files"}</span>
            {files.total !== undefined && (
              <span className="git-count">{files.total}</span>
            )}
          </div>
          {Boolean(files.error) && (
            <ReadingError
              retryLabel={ja ? "再試行" : "Retry"}
              onRetry={() => files.retry()}
            >
              {readErrorCopy(files.error, locale)}
            </ReadingError>
          )}
          <VirtualRows
            count={files.count}
            rowHeight={row.height}
            dataId="git-commit-files"
            className="git-list-rows"
            label={ja ? "commit 内のファイル" : "Files in the commit"}
            onRange={(first, last) => files.ensure(first, last)}
            renderRow={(index) => {
              const file = files.get(index);
              if (!file) return <div className="git-row" data-loading="true" />;
              const name = file.path.slice(file.path.lastIndexOf("/") + 1);
              return (
                <PathMenu path={file.absolutePath} locale={locale}>
                  <button
                    type="button"
                    className="git-row"
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
                    <span className="git-row-name">{name}</span>
                    <span className="git-row-directory">
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
