import { useFileUploads } from "./FileUploads.tsx";
import { MiddleEllipsis } from "../MiddleEllipsis.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Code,
  Download,
  Eye,
  FileCode,
  History,
  ListFilter,
  PanelLeft,
  Search,
  WrapText,
  X,
} from "lucide-react";
import type { OpenFile, FileOpenRequest } from "../workspace-panel.tsx";
import type { FileInfo } from "@iori/protocol";
import { Button } from "../components/ui/button";
import { SplitPane } from "../reading/SplitPane.tsx";
import { useSavedViewState } from "../reading/savedViewState.ts";
import {
  WorktreePicker,
  type WorktreeChoice,
} from "../reading/WorktreePicker.tsx";
import { PathMenu, type MenuAction } from "../reading/PathMenu.tsx";
import {
  emptyPosition,
  nativeReadingPositions,
  positionKey,
  type FilePosition,
  type ReadingPositions,
} from "../reading/positions.ts";
import {
  ReadConnectionLost,
  ReadError,
  isAbort,
  readErrorCopy,
  type ReadingTransport,
} from "../reading/transport.ts";
import { formatBytes } from "../reading/format.ts";
import { FileTree, type FileTreeHandle } from "./FileTree.tsx";
import { TextSurface } from "./TextSurface.tsx";
import {
  MarkdownSurface,
  MAX_RENDERED_MARKDOWN_BYTES,
} from "./MarkdownSurface.tsx";
import { ImageSurface } from "./ImageSurface.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";

export type FilesPaneProps = {
  standalone?: OpenFile;
  openRequest?: FileOpenRequest;
  onFileOpened?: (id: number) => void;
  onOpenFile?: (file: OpenFile, standalone?: boolean) => void;
  transport: ReadingTransport;
  hostKey: string;
  /** The opened folder or worktree; paths in the View are relative to it. */
  root: string;
  /** The worktree's name or branch shown above the list. */
  label: string;
  /** The opened folder's worktrees, to switch this View between. */
  worktrees?: WorktreeChoice[];
  onSelectWorktree?: (path: string) => void;
  locale?: string;
  visible?: boolean;
  /** The View's state as saved with the workspace layout. */
  viewState?: unknown;
  onViewState?: (state: FilesViewState) => void;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
  positions?: ReadingPositions;
  onFileHistory?: (absolutePath: string) => void;
};

export type FilesViewState = {
  tabs: string[];
  active?: string;
  detailOpen: boolean;
  listOpen: boolean;
  expanded: string[];
  /** The list's share of the width, in percent. */
  ratio?: number;
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

// A saved state is read leniently; entries in another shape are dropped.
function readViewState(value: unknown): FilesViewState {
  const saved: Record<string, unknown> =
    value && typeof value === "object" ? { ...value } : {};
  return {
    tabs: strings(saved.tabs),
    active: typeof saved.active === "string" ? saved.active : undefined,
    detailOpen: saved.detailOpen === true,
    listOpen: saved.listOpen !== false,
    expanded: strings(saved.expanded),
    ratio: typeof saved.ratio === "number" ? saved.ratio : undefined,
  };
}

const isMarkdown = (path?: string) => /\.(md|markdown)$/iu.test(path ?? "");

/** A View of the workspace frame: the frame supplies the Host, the folder and the saved state. */
export function FilesPane(props: FilesPaneProps) {
  // A different Host or folder starts from its own state.
  return (
    <FilesWorkspace
      key={JSON.stringify([props.hostKey, props.root])}
      {...props}
    />
  );
}

function FilesWorkspace({
  standalone,
  openRequest,
  onFileOpened,
  onOpenFile,
  transport,
  hostKey,
  root,
  label,
  worktrees = [],
  onSelectWorktree,
  locale = "en",
  visible = true,
  viewState,
  onViewState,
  onBackHandler,
  positions = nativeReadingPositions,
  onFileHistory,
}: FilesPaneProps) {
  const ja = locale.startsWith("ja");
  const [view, setView] = useState(() =>
    standalone
      ? {
          ...readViewState(viewState),
          tabs: [standalone.path],
          active: standalone.path,
          detailOpen: true,
        }
      : readViewState(viewState),
  );
  const [narrow, setNarrow] = useState(false);
  const [info, setInfo] = useState<FileInfo>();
  const [infoError, setInfoError] = useState<{
    message: string;
    missing: boolean;
  }>();
  const [watchError, setWatchError] = useState<string>();
  const [watchRetry, setWatchRetry] = useState(0);
  const [saveFailed, setSaveFailed] = useState(false);
  const [position, setPosition] = useState<FilePosition>();
  const [infoRequest, setInfoRequest] = useState(0);
  const tree = useRef<FileTreeHandle>(null);
  const uploads = useFileUploads(transport, hostKey, root, locale);
  const save = uploads.save;
  const saveAction = (path: string): MenuAction => ({
    label: ja ? "ダウンロード…" : "Download…",
    icon: <Download aria-hidden="true" />,
    action: "files-save",
    run: () => save(path),
  });
  const strip = useRef<HTMLDivElement>(null);
  const active = view.active;
  useEffect(() => {
    const list = strip.current;
    if (!list) return;
    const update = () => {
      list.dataset.left = String(list.scrollLeft > 1);
      list.dataset.right = String(
        list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    for (const tab of list.children) observer.observe(tab);
    list.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", update);
    };
  }, [view.tabs, standalone]);
  const activeRef = useRef(active);
  activeRef.current = active;
  // Find and go-to requests belong to the file they were made for.
  const [requests, setRequests] = useState({ path: "", find: 0, goTo: 0 });
  const request = (kind: "find" | "goTo") =>
    setRequests((value) => ({
      path: active ?? "",
      find:
        (value.path === active ? value.find : 0) + (kind === "find" ? 1 : 0),
      goTo:
        (value.path === active ? value.goTo : 0) + (kind === "goTo" ? 1 : 0),
    }));
  const findRequest = requests.path === active ? requests.find : 0;
  const goToRequest = requests.path === active ? requests.goTo : 0;

  useEffect(() => {
    if (!openRequest) return;
    const path = openRequest.path;
    tree.current?.reveal(path);
    setView((value) => ({
      ...value,
      active: path,
      detailOpen: true,
      tabs: value.tabs.includes(path) ? value.tabs : [...value.tabs, path],
    }));
  }, [openRequest]);

  // The View's tabs, open folders and list width are saved with the
  // workspace layout shortly after they change, and at once when it closes.
  const changeRatio = useSavedViewState(view, onViewState);

  // On a narrow screen, going back closes the file and shows the list.
  const back = useRef(onBackHandler);
  back.current = onBackHandler;
  const showsDetail = !standalone && narrow && view.detailOpen;
  useEffect(() => {
    back.current?.(
      showsDetail
        ? () => {
            setView((value) => ({ ...value, detailOpen: false }));
            return true;
          }
        : undefined,
    );
  }, [showsDetail]);
  useEffect(() => () => back.current?.(undefined), []);

  // Reading positions are kept per file.
  const latest = useRef<{ key: string; value: FilePosition } | undefined>(
    undefined,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const persist = useCallback(() => {
    const value = latest.current;
    if (!value) return;
    void positions.save(value.key, value.value).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  }, [positions]);
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      persist();
    },
    [persist],
  );
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    clearTimeout(saveTimer.current);
    persist();
    const key = positionKey(hostKey, root, active);
    latest.current = undefined;
    setPosition(undefined);
    void positions
      .load(key)
      .catch(() => null)
      .then((stored) => {
        if (disposed) return;
        const value = stored ?? emptyPosition();

        latest.current = { key, value };
        setPosition(value);
      });
    return () => {
      disposed = true;
    };
  }, [positions, hostKey, root, active]);
  // Changes apply to the latest position, which may be newer than the last render.
  const updatePosition = useCallback(
    (change: (current: FilePosition) => FilePosition) => {
      if (!latest.current) return;
      const value = change(latest.current.value);
      latest.current = { key: latest.current.key, value };
      setPosition(value);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(persist, 250);
    },
    [persist],
  );

  const [openRevision, setOpenRevision] = useState(0);
  const appliedOpen = useRef<number>(undefined);
  useEffect(() => {
    if (
      !openRequest ||
      appliedOpen.current === openRequest.id ||
      !position ||
      openRequest.path !== active ||
      latest.current?.key !== positionKey(hostKey, root, active)
    )
      return;
    appliedOpen.current = openRequest.id;
    if (openRequest.line) {
      const top = openRequest.line - 1;
      updatePosition((value) => ({
        ...value,
        top,
        selection: { start: top, end: top },
        source: true,
      }));
      setOpenRevision(openRequest.id);
    }
    onFileOpened?.(openRequest.id);
  }, [
    openRequest,
    position,
    active,
    hostKey,
    root,
    updatePosition,
    onFileOpened,
  ]);

  // The open file follows changes on the Host without a button.
  useEffect(() => {
    if (!visible) return;
    return transport.watch(
      root,
      standalone ? "file" : "files",
      ({ paths }) => {
        setWatchError(undefined);
        tree.current?.changed(paths);
        const shown = activeRef.current;
        if (!paths || (shown && paths.includes(shown)))
          setInfoRequest((value) => value + 1);
      },
      (error) => setWatchError(readErrorCopy(error, locale)),
    );
  }, [transport, root, visible, watchRetry, locale, standalone]);
  useEffect(() => {
    if (!active || !visible) return;
    const controller = new AbortController();
    void transport
      .request("files.info", { root, path: active }, controller.signal)
      .then((value) => {
        setInfo(value);
        setInfoError(undefined);
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          isAbort(cause) ||
          cause instanceof ReadConnectionLost
        )
          return;
        if (cause instanceof ReadError && cause.code === "path_not_found") {
          setInfo(undefined);
          setInfoError({
            message: ja ? "ファイルが見つかりません" : "File not found",
            missing: true,
          });
        } else {
          const message = readErrorCopy(cause, locale);
          setInfoError(message ? { message, missing: false } : undefined);
        }
      });
    return () => controller.abort();
  }, [transport, root, active, visible, infoRequest, locale, standalone, ja]);
  useEffect(() => {
    setInfo((current) => (current?.path === active ? current : undefined));
    setInfoError(undefined);
    // Only the tab strip scrolls; scrollIntoView would also move the
    // workspace's clipped containers.
    const list = strip.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !tab) return;
    const bounds = list.getBoundingClientRect();
    const tabBounds = tab.getBoundingClientRect();
    if (tabBounds.right > bounds.right)
      list.scrollLeft += tabBounds.right - bounds.right;
    else if (tabBounds.left < bounds.left)
      list.scrollLeft -= bounds.left - tabBounds.left;
  }, [active]);

  const open = (path: string) => {
    setView((current) => ({
      ...current,
      tabs: current.tabs.includes(path)
        ? current.tabs
        : [...current.tabs, path],
      active: path,
      detailOpen: true,
    }));
  };
  const close = (path: string) => {
    setView((current) => {
      const tabs = current.tabs.filter((item) => item !== path);
      const index = current.tabs.indexOf(path);
      const active =
        current.active === path
          ? (tabs[Math.min(index, tabs.length - 1)] ?? undefined)
          : current.active;
      return {
        ...current,
        tabs,
        active,
        detailOpen: current.detailOpen && Boolean(active),
      };
    });
  };
  const closeTabs = (
    path: string,
    mode: "others" | "right" | "left" | "all",
  ) => {
    setView((current) => {
      const index = current.tabs.indexOf(path);
      const tabs = current.tabs.filter((item, itemIndex) => {
        if (mode === "all") return false;
        if (mode === "others") return item === path;
        return mode === "right" ? itemIndex <= index : itemIndex >= index;
      });
      const active =
        current.active && tabs.includes(current.active)
          ? current.active
          : tabs.includes(path)
            ? path
            : undefined;
      return {
        ...current,
        tabs,
        active,
        detailOpen: current.detailOpen && Boolean(active),
      };
    });
  };

  const current = info?.path === active ? info : undefined;
  const markdown = isMarkdown(active) && current?.kind === "text";
  const tooLarge =
    markdown && (current?.sizeBytes ?? 0) > MAX_RENDERED_MARKDOWN_BYTES;
  const rendered = markdown && !tooLarge && position && !position.source;
  const textual = current?.kind === "text" && (current.lineCount ?? 0) > 0;
  const menuActions: MenuAction[] = [
    ...(active ? [saveAction(active)] : []),
    ...(onFileHistory && current
      ? [
          {
            label: ja ? "ファイルの履歴" : "File history",
            icon: <History />,
            action: "file-history",
            run: () => onFileHistory(current.absolutePath),
          },
        ]
      : []),
  ];

  const list = (
    <>
      <div className="reading-header" data-iori-part="files-list-header">
        <WorktreePicker
          label={label}
          root={root}
          worktrees={worktrees}
          onSelect={onSelectWorktree}
          field="files-worktree"
        />
        <span className="reading-spacer" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ja ? "ファイル名で絞り込む" : "Filter by file name"}
          data-iori-action="open-file-filter"
          onClick={() => tree.current?.openFilter()}
        >
          <ListFilter />
        </Button>
      </div>
      <FileTree
        onSave={(path) => void save(path)}
        onPut={uploads.put}
        onChoose={uploads.choose}
        onFolderDrop={uploads.folderError}
        footer={uploads.controls}
        handle={tree}
        transport={transport}
        root={root}
        hostKey={hostKey}
        locale={locale}
        selected={active}
        onOpen={open}
        expanded={view.expanded}
        onExpanded={(expanded) => setView((value) => ({ ...value, expanded }))}
      />
    </>
  );

  const header = active && (
    <div
      className="reading-header reading-path-header"
      data-iori-part="file-header"
    >
      <PathMenu
        path={current?.absolutePath ?? active}
        locale={locale}
        actions={[saveAction(active)]}
      >
        <nav
          className={
            standalone
              ? "reading-breadcrumb reading-file-breadcrumb"
              : "reading-breadcrumb"
          }
          title={standalone?.absolutePath ?? active}
          aria-label={ja ? "パス" : "Path"}
        >
          {standalone ? (
            <MiddleEllipsis
              text={standalone.displayPath}
              className="reading-file-path reading-muted"
            />
          ) : (
            active.split("/").map((part, index, parts) => (
              <span
                key={index}
                data-last={index === parts.length - 1 || undefined}
              >
                {part}
              </span>
            ))
          )}
        </nav>
      </PathMenu>
      <span className="reading-spacer" />
      {markdown && (
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="markdown-source"
          aria-pressed={Boolean(position?.source) || tooLarge}
          disabled={tooLarge || !position}
          title={
            tooLarge
              ? ja
                ? "大きいファイルはソースで表示します"
                : "Large documents are shown as source"
              : position?.source
                ? ja
                  ? "プレビューを表示"
                  : "Show rendered"
                : ja
                  ? "ソースを表示"
                  : "Show source"
          }
          aria-label={
            position?.source
              ? ja
                ? "プレビューを表示"
                : "Show rendered"
              : ja
                ? "ソースを表示"
                : "Show source"
          }
          onClick={() => {
            updatePosition((current) =>
              current.source
                ? {
                    ...current,
                    source: false,
                    markdown: { ...current.markdown, line: current.top + 1 },
                  }
                : {
                    ...current,
                    source: true,
                    top: Math.max(0, current.markdown.line - 1),
                    match: undefined,
                  },
            );
          }}
        >
          {position?.source || tooLarge ? <Eye /> : <Code />}
        </Button>
      )}
      {textual && !rendered && (
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="file-wrap"
          aria-pressed={Boolean(position?.wrap)}
          aria-label={ja ? "折り返す" : "Wrap lines"}
          title={ja ? "折り返す" : "Wrap lines"}
          onClick={() =>
            updatePosition((current) => ({ ...current, wrap: !current.wrap }))
          }
        >
          <WrapText />
        </Button>
      )}
      {onFileHistory && current && (
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="file-history"
          aria-label={ja ? "ファイルの履歴" : "File history"}
          title={ja ? "ファイルの履歴" : "File history"}
          onClick={() => onFileHistory(current.absolutePath)}
        >
          <History />
        </Button>
      )}
      {textual && (
        <Button
          variant="ghost"
          size="icon-sm"
          data-iori-action="open-find"
          aria-label={ja ? "検索" : "Find"}
          title={ja ? "検索（Ctrl+F）" : "Find (Ctrl+F)"}
          onClick={() => request("find")}
        >
          <Search />
        </Button>
      )}
    </div>
  );

  let body: React.ReactNode = null;
  if (!active)
    body = (
      <p className="reading-empty">
        {ja
          ? "一覧からファイルを選んでください"
          : "Choose a file from the list"}
      </p>
    );
  else if (infoError && !current)
    body = (
      <ReadingError
        centered
        retryLabel={
          standalone || infoError.missing
            ? ja
              ? "再読み込み"
              : "Reload"
            : ja
              ? "再試行"
              : "Retry"
        }
        action="file-retry"
        onRetry={() => setInfoRequest((value) => value + 1)}
      >
        {infoError.message}
      </ReadingError>
    );
  else if (current && position) {
    if (current.kind === "text" && current.lineCount === 0)
      body = (
        <p className="reading-empty" data-iori-state="empty-file">
          {ja ? "空のファイルです" : "This file is empty"}
        </p>
      );
    else if (rendered)
      body = (
        <MarkdownSurface
          transport={transport}
          root={root}
          info={current}
          position={position.markdown}
          onPosition={(markdownPosition) =>
            updatePosition((current) => ({
              ...current,
              markdown: markdownPosition,
            }))
          }
          onOpen={open}
          standalone={Boolean(standalone)}
          onOpenFile={onOpenFile}
          locale={locale}
          findRequest={findRequest}
          extraActions={menuActions}
        />
      );
    else if (current.kind === "text")
      body = (
        <TextSurface
          key={`${active}:${openRevision}`}
          transport={transport}
          root={root}
          info={current}
          position={position}
          onPosition={(value) =>
            updatePosition((current) => ({ ...current, ...value }))
          }
          wrap={position.wrap}
          locale={locale}
          findRequest={findRequest}
          goToRequest={goToRequest}
          extraActions={menuActions}
        />
      );
    else if (current.kind === "image")
      body = (
        <ImageSurface
          transport={transport}
          root={root}
          info={current}
          locale={locale}
        />
      );
    else if (current.kind === "symlink")
      body = (
        <p
          className="reading-empty"
          data-iori-state={`link-${current.symlinkTarget ?? "unknown"}`}
        >
          {current.symlinkTarget === "outside_root"
            ? ja
              ? "このリンクは開いたフォルダーの外を指しています。"
              : "This link points outside the open folder."
            : ja
              ? "リンク先が見つかりません。"
              : "This link's target no longer exists."}
        </p>
      );
    else if (current.kind === "directory")
      body = (
        <p className="reading-empty">
          {ja ? "フォルダーです" : "This is a folder"}
        </p>
      );
    else
      body = (
        <div
          className="reading-empty"
          data-iori-state={
            current.kind === "binary" ? "binary-file" : "unsupported-file"
          }
        >
          <p>
            {current.kind === "binary"
              ? ja
                ? "テキストとして表示できないファイルです"
                : "This file cannot be shown as text"
              : ja
                ? "この形式は表示できません"
                : "This format cannot be displayed"}
          </p>
          <p className="reading-muted">
            {[
              current.mimeType,
              current.sizeBytes === undefined
                ? undefined
                : formatBytes(current.sizeBytes, locale),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      );
  }

  const detail = (
    <>
      {header}
      <div
        className="reading-body"
        onKeyDown={(event) => {
          if (event.defaultPrevented || !(event.ctrlKey || event.metaKey))
            return;
          const key = event.key.toLowerCase();
          if (key === "g" && textual && !rendered) {
            event.preventDefault();
            request("goTo");
          } else if (key === "f" && textual) {
            event.preventDefault();
            request("find");
          }
        }}
      >
        {body}
      </div>
    </>
  );

  return (
    <div
      className="files-pane"
      aria-label={standalone ? (ja ? "ファイル" : "File") : undefined}
      data-iori-view={standalone ? "file" : "files"}
      hidden={!visible}
    >
      {(watchError || saveFailed) && (
        <ReadingError
          retryLabel={ja ? "再試行" : "Retry"}
          action={watchError ? "files-watch-retry" : "files-save-retry"}
          onRetry={() => {
            if (watchError) setWatchRetry((value) => value + 1);
            else persist();
          }}
        >
          {watchError ??
            (ja
              ? "スクロール位置を保存できませんでした。"
              : "Could not save the reading position.")}
        </ReadingError>
      )}
      {standalone ? (
        <>
          {detail}
          {uploads.controls}
        </>
      ) : (
        <SplitPane
          locale={locale}
          ratio={view.ratio}
          onRatio={changeRatio}
          detailOpen={view.detailOpen}
          listOpen={view.listOpen}
          onNarrow={setNarrow}
          list={list}
        >
          <div className="reading-tabs" data-iori-part="file-tabs">
            <Button
              variant="ghost"
              size="icon-sm"
              className="reading-tabs-lead"
              data-iori-action={narrow ? "reading-back" : "toggle-file-list"}
              aria-label={
                narrow
                  ? ja
                    ? "一覧へ戻る"
                    : "Back to list"
                  : view.listOpen
                    ? ja
                      ? "一覧を非表示"
                      : "Hide list"
                    : ja
                      ? "一覧を表示"
                      : "Show list"
              }
              aria-pressed={narrow ? undefined : view.listOpen}
              onClick={() =>
                setView((value) =>
                  narrow
                    ? { ...value, detailOpen: false }
                    : { ...value, listOpen: !value.listOpen },
                )
              }
            >
              {narrow ? <ArrowLeft /> : <PanelLeft />}
            </Button>
            <div ref={strip} className="reading-tab-strip" role="tablist">
              {view.tabs.map((path, index) => (
                <PathMenu
                  key={path}
                  path={
                    info?.path === path ? info.absolutePath : `${root}/${path}`
                  }
                  locale={locale}
                  leadingActions={[
                    {
                      label: ja ? "閉じる" : "Close",
                      icon: <X />,
                      action: "file-tab-close",
                      run: () => close(path),
                    },
                    {
                      label: ja ? "その他を閉じる" : "Close Others",
                      action: "file-tab-close-others",
                      disabled: view.tabs.length === 1,
                      run: () => closeTabs(path, "others"),
                    },
                    {
                      label: ja ? "右側を閉じる" : "Close to the Right",
                      action: "file-tab-close-right",
                      disabled: index === view.tabs.length - 1,
                      run: () => closeTabs(path, "right"),
                    },
                    {
                      label: ja ? "左側を閉じる" : "Close to the Left",
                      action: "file-tab-close-left",
                      disabled: index === 0,
                      run: () => closeTabs(path, "left"),
                    },
                    {
                      label: ja ? "すべて閉じる" : "Close All",
                      action: "file-tab-close-all",
                      run: () => closeTabs(path, "all"),
                    },
                  ]}
                  actions={[saveAction(path)]}
                  separateActions={false}
                >
                  <div
                    key={path}
                    className="reading-tab"
                    role="tab"
                    aria-selected={path === active}
                    data-iori-tab={path}
                    title={path}
                    onClick={() =>
                      setView((value) => ({
                        ...value,
                        active: path,
                        detailOpen: true,
                      }))
                    }
                    onAuxClick={(event) => {
                      if (event.button === 1) close(path);
                    }}
                  >
                    <FileCode />
                    <span>{path.split("/").at(-1)}</span>
                    <button
                      type="button"
                      className="reading-tab-close"
                      aria-label={ja ? `${path}を閉じる` : `Close ${path}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        close(path);
                      }}
                    >
                      <X />
                    </button>
                  </div>
                </PathMenu>
              ))}
            </div>
          </div>
          {detail}
        </SplitPane>
      )}
    </div>
  );
}
