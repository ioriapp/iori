import {
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import { History, Search, WrapText } from "lucide-react";
import type { GitDiffSource } from "@iori/protocol";
import { Button } from "../components/ui/button";
import { TextRows, type TextPosition } from "../reading/TextRows.tsx";
import { readErrorCopy, type ReadingTransport } from "../reading/transport.ts";
import type { MenuAction } from "../reading/PathMenu.tsx";
import { DiffDocument } from "./DiffDocument.ts";
import { ReadingError } from "../reading/ReadingError.tsx";
import { useGitImages } from "./image-source.ts";
import { GitImageDiff } from "./GitImageDiff.tsx";

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
  refreshKey,
  position,
  onPosition,
  locale,
  lead,
  title,
  onFileHistory,
  notes = [],
  active = true,
  onBackHandler,
}: {
  transport: ReadingTransport;
  root: string;
  source: GitDiffSource;
  absolutePath: string;
  /** Increments when the Host may have a different diff for this source. */
  refreshKey: number;
  position: DiffPosition;
  onPosition: (value: DiffPosition) => void;
  locale: string;
  lead?: ReactNode;
  title: ReactNode;
  onFileHistory?: () => void;
  notes?: string[];
  active?: boolean;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
}) {
  const ja = locale.startsWith("ja");
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [findRequest, setFindRequest] = useState(0);
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
    shown.push(
      ja
        ? "バイナリのため、行の差分はありません。"
        : "Binary file: there is no line diff.",
    );
  if (info?.directory)
    shown.push(
      ja
        ? "フォルダーです（入れ子のリポジトリなど）。行の差分はありません。"
        : "This is a folder (such as a nested repository); there is no line diff.",
    );
  if (
    info?.newFile &&
    !(source.kind === "change" && source.area === "untracked")
  )
    shown.push(ja ? "新しく追加されたファイルです。" : "This file was added.");
  if (info?.deletedFile)
    shown.push(ja ? "削除されたファイルです。" : "This file was deleted.");
  if (info?.oldMode && info.newMode && info.oldMode !== info.newMode)
    shown.push(
      ja
        ? `モードの変更: ${info.oldMode} → ${info.newMode}`
        : `Mode changed: ${info.oldMode} → ${info.newMode}`,
    );
  if (
    document.revision &&
    document.totalRows === 0 &&
    !info?.binary &&
    !info?.directory
  )
    shown.push(
      ja ? "内容の差分はありません。" : "There are no content changes.",
    );
  const actions: MenuAction[] = onFileHistory
    ? [
        {
          label: ja ? "ファイルの履歴" : "File history",
          icon: <History />,
          action: "file-history",
          run: onFileHistory,
        },
      ]
    : [];

  return (
    <>
      <div
        className="reading-header reading-path-header"
        data-iori-part="diff-header"
      >
        {lead}
        {title}
        <span className="reading-spacer" />
        {!isImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            data-iori-action="git-diff-wrap"
            aria-pressed={position.wrap}
            aria-label={ja ? "折り返す" : "Wrap lines"}
            title={ja ? "折り返す" : "Wrap lines"}
            onClick={() => onPosition({ ...position, wrap: !position.wrap })}
          >
            <WrapText />
          </Button>
        )}
        {onFileHistory && (
          <Button
            variant="ghost"
            size="icon-sm"
            data-iori-action="git-file-history"
            aria-label={ja ? "ファイルの履歴" : "File history"}
            title={ja ? "ファイルの履歴" : "File history"}
            onClick={onFileHistory}
          >
            <History />
          </Button>
        )}
        {!isImage && (
          <Button
            variant="ghost"
            size="icon-sm"
            data-iori-action="open-find"
            aria-label={ja ? "差分を検索" : "Find in diff"}
            title={ja ? "差分を検索（Ctrl+F）" : "Find in diff (Ctrl+F)"}
            onClick={() => setFindRequest((value) => value + 1)}
          >
            <Search />
          </Button>
        )}
      </div>
      {shown.length > 0 && (
        <div className="git-notes" data-iori-part="diff-notes">
          {shown.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
      {!document.revision && Boolean(document.error) && (
        <ReadingError
          retryLabel={ja ? "再試行" : "Retry"}
          onRetry={() => document.retry()}
        >
          {readErrorCopy(document.error, locale)}
        </ReadingError>
      )}
      {isImage || (probingImage && !singleImage) ? (
        <GitImageDiff
          images={images}
          active={active}
          single={singleImage}
          locale={locale}
          retry={retryImage}
          onBackHandler={onBackHandler}
        />
      ) : (
        <div className="reading-body">
          {document.revision && document.totalRows > 0 && (
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
              onExpand={(index) => document.expand(index)}
              extraActions={actions}
            />
          )}
        </div>
      )}
    </>
  );
}
