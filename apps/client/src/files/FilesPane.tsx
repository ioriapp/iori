import { translator } from "../i18n.ts";
import { useNarrowBack } from "../reading/useNarrowBack.ts";
import { useFileUploads } from "./FileUploads.tsx";
import { MiddleEllipsis } from "../MiddleEllipsis.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronsDownUp,
  Code,
  Download,
  Eye,
  FileCode,
  FilePlus,
  FolderPlus,
  FolderOpen,
  History,
  ListFilter,
  PanelLeft,
  Pencil,
  RotateCw,
  Search,
  WrapText,
  X,
} from "lucide-react";
import type {
  OpenFile,
  FileOpenRequest,
  WorkspaceSearchRequest,
} from "../workspace-panel.tsx";
import type { FileEntry, FileInfo } from "@iori/protocol";
import { cn } from "cn";
import { Button } from "../components/ui/button";
import { SplitPane } from "../reading/SplitPane.tsx";
import {
  useSaveOnPageHide,
  useSavedViewState,
} from "../reading/savedViewState.ts";
import {
  WorktreePicker,
  type WorktreeChoice,
} from "../reading/WorktreePicker.tsx";
import {
  joinHostPath,
  type RevealInFileManager,
} from "../reading/local-file-manager.ts";
import { PathMenu, type MenuAction } from "../reading/PathMenu.tsx";
import { BreadcrumbPath } from "../reading/PathEllipsis.tsx";
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
import {
  FileCreateDialog,
  FileDeleteDialog,
  FileRenameDialog,
  fileManageErrorCopy,
} from "./FileManageDialogs.tsx";
import { TextSurface } from "./TextSurface.tsx";
import {
  CodeEditorSurface,
  MAX_EDIT_BYTES,
  type CodeEditorHandle,
  type CodeEditorStatus,
} from "./CodeEditorSurface.tsx";
import { WorkspaceSearchPane } from "./WorkspaceSearchPane.tsx";
import { UnsavedChangesDialog } from "../components/UnsavedChangesDialog.tsx";
import {
  MarkdownSurface,
  MAX_RENDERED_MARKDOWN_BYTES,
} from "./MarkdownSurface.tsx";
import { ImageSurface } from "./ImageSurface.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";
import { ReadingEmpty, ReadingLoading } from "../reading/ReadingStates.tsx";

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
  onOpenDiff?: (path: string) => void;
  onSendPathToTerminal?: (absolutePath: string) => void;
  onOpenTerminalInFolder?: (absolutePath: string) => void;
  revealInFileManager?: RevealInFileManager;
  searchRequest?: WorkspaceSearchRequest;
  onSearchRequestShown?: (id: number) => void;
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
  onOpenDiff,
  onSendPathToTerminal,
  onOpenTerminalInFolder,
  revealInFileManager,
  searchRequest,
  onSearchRequestShown,
}: FilesPaneProps) {
  const t = translator(locale);
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
  const [readRefresh, setReadRefresh] = useState(0);
  const [changedPaths, setChangedPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [gitStatusRequest, setGitStatusRequest] = useState(0);
  const [createTarget, setCreateTarget] = useState<{
    parentFolder: string;
    kind: "file" | "directory";
  }>();
  const [renameTarget, setRenameTarget] = useState<{
    path: string;
    name: string;
    isDirectory: boolean;
  }>();
  const [deleteTarget, setDeleteTarget] = useState<{
    path: string;
    name: string;
    isDirectory: boolean;
    isSymlink: boolean;
  }>();
  const [manageError, setManageError] = useState<string>();
  const [coarsePointer, setCoarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches,
  );
  const [mobileEditing, setMobileEditing] = useState(false);
  const [editorStatus, setEditorStatus] = useState<CodeEditorStatus>();
  const [fallbackReadOnly, setFallbackReadOnly] = useState<{
    path: string;
    revision?: string;
  }>();
  const [pendingLeave, setPendingLeave] = useState<() => void>();
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFolder, setSearchFolder] = useState<string>();
  const [searchFocus, setSearchFocus] = useState(0);
  const [jumpRequest, setJumpRequest] = useState<{
    id: number;
    path: string;
    line: number;
  }>();
  const tree = useRef<FileTreeHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarsePointer(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const uploads = useFileUploads(transport, hostKey, root, locale);
  const save = uploads.save;
  const revealAction = (path: string): MenuAction[] =>
    revealInFileManager
      ? [
          {
            label: t(revealInFileManager.labelKey),
            icon: <FolderOpen aria-hidden="true" />,
            action: "files-reveal-in-file-manager",
            run: () => revealInFileManager.open(path, false),
          },
        ]
      : [];
  const saveAction = (path: string): MenuAction => ({
    label: t("Download…"),
    icon: <Download aria-hidden="true" />,
    action: "files-save",
    run: () => save(path),
  });
  const strip = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingFocusTab = useRef<string | undefined>(undefined);
  const active = view.active;
  useEffect(() => {
    const target = pendingFocusTab.current;
    if (!target) return;
    pendingFocusTab.current = undefined;
    tabRefs.current.get(target)?.focus({ preventScroll: true });
  }, [view.tabs, active]);
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
  // Find, replace and go-to requests belong to the file they were made for.
  const [requests, setRequests] = useState({
    path: "",
    find: 0,
    replace: 0,
    goTo: 0,
  });
  const request = (kind: "find" | "replace" | "goTo") =>
    setRequests((value) => ({
      path: active ?? "",
      find:
        (value.path === active ? value.find : 0) + (kind === "find" ? 1 : 0),
      replace:
        (value.path === active ? value.replace : 0) +
        (kind === "replace" ? 1 : 0),
      goTo:
        (value.path === active ? value.goTo : 0) + (kind === "goTo" ? 1 : 0),
    }));
  const findRequest = requests.path === active ? requests.find : 0;
  const replaceRequest = requests.path === active ? requests.replace : 0;
  const goToRequest = requests.path === active ? requests.goTo : 0;

  const appliedSearch = useRef<number>(undefined);
  useEffect(() => {
    if (!searchRequest || appliedSearch.current === searchRequest.id) return;
    appliedSearch.current = searchRequest.id;
    setSearchFolder(searchRequest.folder);
    setSearchOpen(true);
    setSearchFocus((value) => value + 1);
    setView((value) => ({
      ...value,
      listOpen: true,
      detailOpen: false,
    }));
    onSearchRequestShown?.(searchRequest.id);
  }, [searchRequest, onSearchRequestShown]);

  const guardLeave = useCallback((action: () => void) => {
    const editor = editorRef.current;
    if (!editor || !editor.isDirty()) {
      action();
      return;
    }
    if (editor.hasConflict() || editor.hasSaveError()) {
      setPendingLeave(() => action);
      return;
    }
    void editor.save(false).then((ok) => {
      if (ok) action();
      else setPendingLeave(() => action);
    });
  }, []);

  useEffect(() => {
    if (!openRequest) return;
    const path = openRequest.path;
    const apply = () => {
      tree.current?.reveal(path);
      setView((value) => ({
        ...value,
        active: path,
        detailOpen: true,
        tabs: value.tabs.includes(path) ? value.tabs : [...value.tabs, path],
      }));
    };
    if (path === activeRef.current) apply();
    else guardLeave(apply);
  }, [openRequest, guardLeave]);

  // The View's tabs, open folders and list width are saved with the
  // workspace layout shortly after they change, and at once when it closes.
  const changeRatio = useSavedViewState(view, onViewState);

  // On a narrow screen, going back closes the file and shows the list.
  const showsDetail = !standalone && narrow && view.detailOpen;
  useNarrowBack(onBackHandler, showsDetail, () => {
    setView((value) => ({ ...value, detailOpen: false }));
    return true;
  });

  // Reading positions are kept per file.
  const latest = useRef<{ key: string; value: FilePosition } | undefined>(
    undefined,
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current);
    const value = latest.current;
    if (!value) return;
    void positions.save(value.key, value.value).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  }, [positions]);
  useSaveOnPageHide(persist);
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
      setJumpRequest({
        id: openRequest.id,
        path: openRequest.path,
        line: openRequest.line,
      });
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
        if (!paths) setReadRefresh((value) => value + 1);
        tree.current?.changed(paths);
        const shown = activeRef.current;
        if (!paths || (shown && paths.includes(shown)))
          setInfoRequest((value) => value + 1);
        setGitStatusRequest((value) => value + 1);
      },
      (error) => setWatchError(readErrorCopy(error, locale)),
    );
  }, [transport, root, visible, watchRetry, locale, standalone]);
  useEffect(() => {
    if (standalone || !visible || !onOpenDiff) return;
    const controller = new AbortController();
    void transport
      .request("git.status", { root, start: 0, count: 512 }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setChangedPaths(
          result.isRepository
            ? new Set(result.entries.map((entry) => entry.path))
            : new Set(),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setChangedPaths(new Set());
      });
    return () => controller.abort();
  }, [transport, root, visible, standalone, onOpenDiff, gitStatusRequest]);
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
            message: t("File not found"),
            missing: true,
          });
        } else {
          const message = readErrorCopy(cause, locale);
          setInfoError(message ? { message, missing: false } : undefined);
        }
      });
    return () => controller.abort();
  }, [transport, root, active, visible, infoRequest, locale, standalone]);
  useEffect(() => {
    setInfo((current) => (current?.path === active ? current : undefined));
    setInfoError(undefined);
    setMobileEditing(false);
    setEditorStatus(undefined);
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

  const openDirect = (path: string) => {
    setView((current) => ({
      ...current,
      tabs: current.tabs.includes(path)
        ? current.tabs
        : [...current.tabs, path],
      active: path,
      detailOpen: true,
    }));
  };
  const open = (path: string) => {
    if (path === active) {
      openDirect(path);
      return;
    }
    guardLeave(() => openDirect(path));
  };
  const selectTab = (path: string, focus = false) => {
    const run = () => {
      setView((value) => ({
        ...value,
        active: path,
        detailOpen: true,
      }));
      if (focus) tabRefs.current.get(path)?.focus({ preventScroll: true });
    };
    if (path === active) run();
    else guardLeave(run);
  };
  const close = (path: string, restoreFocus = false) => {
    const run = () => {
      setView((current) => {
        const tabs = current.tabs.filter((item) => item !== path);
        const index = current.tabs.indexOf(path);
        const nextActive =
          current.active === path
            ? (tabs[Math.min(index, tabs.length - 1)] ?? undefined)
            : current.active;
        if (restoreFocus && nextActive) pendingFocusTab.current = nextActive;
        return {
          ...current,
          tabs,
          active: nextActive,
          detailOpen: current.detailOpen && Boolean(nextActive),
        };
      });
    };
    if (path === active) guardLeave(run);
    else run();
  };
  const closeTabs = (
    path: string,
    mode: "others" | "right" | "left" | "all",
  ) => {
    const run = () => {
      setView((current) => {
        const index = current.tabs.indexOf(path);
        const tabs = current.tabs.filter((item, itemIndex) => {
          if (mode === "all") return false;
          if (mode === "others") return item === path;
          return mode === "right" ? itemIndex <= index : itemIndex >= index;
        });
        const nextActive =
          current.active && tabs.includes(current.active)
            ? current.active
            : tabs.includes(path)
              ? path
              : undefined;
        return {
          ...current,
          tabs,
          active: nextActive,
          detailOpen: current.detailOpen && Boolean(nextActive),
        };
      });
    };
    const index = view.tabs.indexOf(path);
    const activeIndex = active ? view.tabs.indexOf(active) : -1;
    const closesActive =
      active !== undefined &&
      (mode === "all" ||
        (mode === "others" && active !== path) ||
        (mode === "right" && activeIndex > index) ||
        (mode === "left" && activeIndex < index));
    if (closesActive) guardLeave(run);
    else run();
  };

  const current = info?.path === active ? info : undefined;
  const markdown = isMarkdown(active) && current?.kind === "text";
  const tooLarge =
    markdown && (current?.sizeBytes ?? 0) > MAX_RENDERED_MARKDOWN_BYTES;
  const rendered = markdown && !tooLarge && position && !position.source;
  const isFallbackReadOnly = Boolean(
    current &&
    fallbackReadOnly &&
    fallbackReadOnly.path === current.path &&
    fallbackReadOnly.revision === current.revision,
  );
  const canEditText = Boolean(
    current &&
    current.kind === "text" &&
    !rendered &&
    !current.symlinkTarget &&
    (current.sizeBytes ?? 0) <= MAX_EDIT_BYTES &&
    !isFallbackReadOnly,
  );
  const readOnlyFallback = Boolean(
    current &&
    current.kind === "text" &&
    !rendered &&
    !canEditText &&
    (current.lineCount ?? 0) > 0,
  );
  const textual =
    current?.kind === "text" && (canEditText || (current.lineCount ?? 0) > 0);
  const menuActions: MenuAction[] = [
    ...(active ? [saveAction(active)] : []),
    ...(onFileHistory && current
      ? [
          {
            label: t("File history"),
            icon: <History />,
            action: "file-history",
            run: () => onFileHistory(current.absolutePath),
          },
        ]
      : []),
  ];

  const rewritePath = (value: string, from: string, to: string) =>
    value === from
      ? to
      : value.startsWith(`${from}/`)
        ? `${to}${value.slice(from.length)}`
        : value;
  const matchesPath = (value: string, removed: string) =>
    value === removed || value.startsWith(`${removed}/`);
  const createEntry = async (
    relativePath: string,
    kind: "file" | "directory",
  ) => {
    try {
      const created = await transport.request("files.create", {
        root,
        path: relativePath,
        kind,
      });
      setManageError(undefined);
      tree.current?.changed();
      tree.current?.reveal(created.path);
      if (kind === "file") open(created.path);
      return undefined;
    } catch (error) {
      return fileManageErrorCopy(error, locale);
    }
  };
  const renameEntry = async (from: string, to: string) => {
    try {
      const renamed = await transport.request("files.rename", {
        root,
        from,
        to,
      });
      setManageError(undefined);
      persist();
      const storedPosition =
        latest.current?.key === positionKey(hostKey, root, from)
          ? latest.current.value
          : await positions
              .load(positionKey(hostKey, root, from))
              .catch(() => null);
      if (storedPosition) {
        await positions
          .save(positionKey(hostKey, root, renamed.path), storedPosition)
          .catch(() => undefined);
      }
      setView((current) => {
        const tabs = current.tabs.map((tab) =>
          rewritePath(tab, from, renamed.path),
        );
        const nextActive = current.active
          ? rewritePath(current.active, from, renamed.path)
          : undefined;
        const expanded = current.expanded.map((folder) =>
          rewritePath(folder, from, renamed.path),
        );
        return { ...current, tabs, active: nextActive, expanded };
      });
      tree.current?.renamed(from, renamed.path);
      tree.current?.reveal(renamed.path);
      return undefined;
    } catch (error) {
      return fileManageErrorCopy(error, locale);
    }
  };
  const duplicateEntry = async (entry: FileEntry) => {
    try {
      const copied = await transport.request("files.duplicate", {
        root,
        path: entry.path,
      });
      setManageError(undefined);
      tree.current?.changed();
      tree.current?.reveal(copied.path);
    } catch (error) {
      setManageError(fileManageErrorCopy(error, locale));
    }
  };
  const deleteEntry = async (path: string) => {
    try {
      await transport.request("files.delete", { root, path });
      setManageError(undefined);
      setView((current) => {
        const tabs = current.tabs.filter((tab) => !matchesPath(tab, path));
        const activeRemoved = current.active
          ? matchesPath(current.active, path)
          : false;
        const nextActive = activeRemoved ? tabs.at(-1) : current.active;
        const expanded = current.expanded.filter(
          (folder) => !matchesPath(folder, path),
        );
        return {
          ...current,
          tabs,
          active: nextActive,
          detailOpen: current.detailOpen && Boolean(nextActive),
          expanded,
        };
      });
      tree.current?.changed();
      return undefined;
    } catch (error) {
      return fileManageErrorCopy(error, locale);
    }
  };
  const moveEntry = (from: string, targetFolder: string) => {
    const name = from.slice(from.lastIndexOf("/") + 1);
    const to = targetFolder ? `${targetFolder}/${name}` : name;
    void renameEntry(from, to).then((error) => {
      if (error) setManageError(error);
    });
  };
  const isEntryDirectory = (entry: FileEntry) =>
    entry.kind === "directory" ||
    (entry.kind === "symlink" &&
      entry.targetKind === "directory" &&
      entry.symlinkTarget === "inside_root");

  const list = (
    <>
      <div
        className="flex h-9 min-w-0 flex-none items-center gap-0.5 px-1.5 [@media(pointer:coarse)]:h-11"
        data-iori-part="files-list-header"
      >
        <WorktreePicker
          label={label}
          root={root}
          worktrees={worktrees}
          onSelect={
            onSelectWorktree
              ? (path) => guardLeave(() => onSelectWorktree(path))
              : undefined
          }
          field="files-worktree"
        />
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          aria-label={t("New file…")}
          title={t("New file…")}
          data-iori-action="files-toolbar-new-file"
          onClick={() => setCreateTarget({ parentFolder: "", kind: "file" })}
        >
          <FilePlus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          aria-label={t("New folder…")}
          title={t("New folder…")}
          data-iori-action="files-toolbar-new-folder"
          onClick={() =>
            setCreateTarget({ parentFolder: "", kind: "directory" })
          }
        >
          <FolderPlus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          aria-label={t("Reload")}
          title={t("Reload")}
          data-iori-action="files-toolbar-reload"
          onClick={() => {
            tree.current?.refresh();
            setInfoRequest((value) => value + 1);
            setGitStatusRequest((value) => value + 1);
          }}
        >
          <RotateCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          aria-label={t("Collapse all")}
          title={t("Collapse all")}
          data-iori-action="files-toolbar-collapse-all"
          onClick={() => tree.current?.collapseAll()}
        >
          <ChevronsDownUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          aria-label={t("Filter by file name")}
          title={t("Filter by file name")}
          data-iori-action="open-file-filter"
          onClick={() => {
            setSearchOpen(false);
            tree.current?.openFilter();
          }}
        >
          <ListFilter />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11"
          aria-label={t("Search in workspace")}
          aria-pressed={searchOpen}
          title={t("Search in workspace")}
          data-iori-action="open-workspace-search"
          onClick={() => {
            setSearchOpen((currentOpen) => {
              const next = !currentOpen;
              if (next) setSearchFocus((value) => value + 1);
              return next;
            });
          }}
        >
          <Search />
        </Button>
      </div>
      {manageError && (
        <ReadingError
          retryLabel={t("Close")}
          action="files-manage-error-dismiss"
          onRetry={() => setManageError(undefined)}
        >
          {manageError}
        </ReadingError>
      )}
      {searchOpen && (
        <WorkspaceSearchPane
          folder={searchFolder}
          onClearFolder={() => setSearchFolder(undefined)}
          locale={locale}
          focusRequest={searchFocus}
          searchWorkspace={(params, signal) =>
            transport.request(
              "files.searchWorkspace",
              { root, ...params },
              signal,
            )
          }
          onSelectMatch={(path, line) => {
            const navigate = () => {
              openDirect(path);
              tree.current?.reveal(path);
              setJumpRequest((prev) => ({
                id: (prev?.id ?? 0) + 1,
                path,
                line,
              }));
            };
            if (path === active) navigate();
            else guardLeave(navigate);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      <div
        className={
          searchOpen ? "hidden" : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
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
          onExpanded={(expanded) =>
            setView((value) => ({ ...value, expanded }))
          }
          changedPaths={changedPaths}
          onCreate={(parentFolder, kind) =>
            setCreateTarget({ parentFolder, kind })
          }
          onRename={(entry) =>
            setRenameTarget({
              path: entry.path,
              name: entry.name,
              isDirectory: isEntryDirectory(entry),
            })
          }
          onDuplicate={(entry) => void duplicateEntry(entry)}
          onDelete={(entry) =>
            setDeleteTarget({
              path: entry.path,
              name: entry.name,
              isDirectory: isEntryDirectory(entry),
              isSymlink: entry.kind === "symlink",
            })
          }
          onMove={moveEntry}
          onOpenDiff={onOpenDiff}
          onFileHistory={onFileHistory}
          onSendPathToTerminal={onSendPathToTerminal}
          onOpenTerminalInFolder={onOpenTerminalInFolder}
          revealInFileManager={revealInFileManager}
          onFindInFolder={(folder) => {
            setSearchFolder(folder);
            setSearchOpen(true);
            setSearchFocus((value) => value + 1);
            setView((value) => ({
              ...value,
              listOpen: true,
              detailOpen: false,
            }));
          }}
        />
      </div>
    </>
  );

  const header = active && (
    <div
      className="flex h-9 min-w-0 flex-none items-center gap-1 border-b border-border px-1.5 [@media(pointer:coarse)]:h-11"
      data-iori-part="file-header"
    >
      <PathMenu
        path={current?.absolutePath ?? active}
        relativePath={standalone ? undefined : active}
        locale={locale}
        actions={[
          ...revealAction(
            current?.absolutePath ??
              standalone?.absolutePath ??
              joinHostPath(root, active),
          ),
          saveAction(active),
        ]}
      >
        <nav
          className={cn(
            "grid min-w-0 grid-cols-[minmax(0,1fr)] px-1 text-xs whitespace-nowrap text-muted-foreground",
            standalone ? "flex-1" : "flex-[0_1_auto]",
          )}
          title={standalone?.absolutePath ?? active}
          aria-label={t("Path")}
        >
          {standalone ? (
            <MiddleEllipsis
              text={standalone.displayPath}
              className="min-w-0 overflow-hidden text-xs text-muted-foreground"
            />
          ) : (
            <BreadcrumbPath path={active} />
          )}
        </nav>
      </PathMenu>
      <span className="flex-1" />
      {canEditText && editorStatus?.saving && (
        <span
          className="px-1.5 text-2xs text-muted-foreground"
          data-iori-part="file-edit-status"
        >
          {t("Saving")}
        </span>
      )}
      {canEditText && coarsePointer && (
        <Button
          variant={mobileEditing ? "secondary" : "ghost"}
          size="sm"
          className="h-7 gap-1 px-2 text-xs [@media(pointer:coarse)]:min-h-11"
          data-iori-action="file-toggle-edit"
          aria-pressed={mobileEditing}
          onClick={() => {
            if (mobileEditing) {
              void editorRef.current?.save(false);
              setMobileEditing(false);
            } else {
              setMobileEditing(true);
            }
          }}
        >
          {mobileEditing ? (
            <>
              <Check className="size-3.5" aria-hidden="true" />
              {t("Done")}
            </>
          ) : (
            <>
              <Pencil className="size-3.5" aria-hidden="true" />
              {t("Edit")}
            </>
          )}
        </Button>
      )}
      {markdown && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11"
          data-iori-action="markdown-source"
          aria-pressed={Boolean(position?.source) || tooLarge}
          disabled={tooLarge || !position}
          title={
            tooLarge
              ? t("Large documents are shown as source")
              : position?.source
                ? t("Show rendered")
                : t("Show source")
          }
          aria-label={position?.source ? t("Show rendered") : t("Show source")}
          onClick={() => {
            const toggle = () =>
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
            if (position?.source) guardLeave(toggle);
            else toggle();
          }}
        >
          {position?.source || tooLarge ? <Eye /> : <Code />}
        </Button>
      )}
      {textual && !rendered && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11"
          data-iori-action="file-wrap"
          aria-pressed={Boolean(position?.wrap)}
          aria-label={t("Wrap lines")}
          title={t("Wrap lines")}
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
          className="[@media(pointer:coarse)]:size-11"
          data-iori-action="file-history"
          aria-label={t("File history")}
          title={t("File history")}
          onClick={() => onFileHistory(current.absolutePath)}
        >
          <History />
        </Button>
      )}
      {textual && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          data-iori-action="open-find"
          aria-label={t("Find")}
          title={t("Find (Ctrl+F)")}
          onClick={() => request("find")}
        >
          <Search />
        </Button>
      )}
    </div>
  );

  const fileError = infoError && (
    <ReadingError
      centered={!current}
      retryLabel={
        infoError.missing || (standalone && !current) ? t("Reload") : t("Retry")
      }
      action="file-retry"
      onRetry={() => setInfoRequest((value) => value + 1)}
    >
      {infoError.message}
    </ReadingError>
  );
  let body: React.ReactNode = null;
  if (!active) body = <ReadingEmpty title={t("Choose a file from the list")} />;
  else if (infoError && !current) body = fileError;
  else if (!current || !position)
    body = <ReadingLoading label={t("Loading")} rows={6} />;
  else if (rendered)
    body = (
      <MarkdownSurface
        transport={transport}
        root={root}
        info={current}
        refresh={readRefresh}
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
  else if (canEditText)
    body = (
      <CodeEditorSurface
        key={active}
        handle={editorRef}
        transport={transport}
        root={root}
        info={current}
        refresh={readRefresh}
        position={position}
        onPosition={(value) =>
          updatePosition((current) => ({ ...current, ...value }))
        }
        wrap={position.wrap}
        locale={locale}
        editing={!coarsePointer || mobileEditing}
        onEditingChange={(next) => {
          if (coarsePointer) setMobileEditing(next);
        }}
        findRequest={findRequest}
        replaceRequest={replaceRequest}
        goToRequest={goToRequest}
        jumpRequest={
          jumpRequest && jumpRequest.path === active
            ? { id: jumpRequest.id, line: jumpRequest.line }
            : undefined
        }
        extraActions={menuActions}
        saveFile={(params) =>
          transport.request("files.write", {
            root,
            path: current.path,
            ...params,
          })
        }
        onSaved={(result) => {
          setInfo((prev) =>
            prev && prev.path === current.path
              ? {
                  ...prev,
                  revision: result.revision,
                  sizeBytes: result.sizeBytes,
                  modifiedAtMs: result.modifiedAtMs,
                }
              : prev,
          );
          setGitStatusRequest((value) => value + 1);
        }}
        onStatusChange={setEditorStatus}
        onFallbackReadOnly={() =>
          setFallbackReadOnly({
            path: current.path,
            revision: current.revision,
          })
        }
      />
    );
  else if (current.kind === "text" && current.lineCount === 0)
    body = <ReadingEmpty title={t("This file is empty")} state="empty-file" />;
  else if (current.kind === "text")
    body = (
      <>
        {readOnlyFallback && (
          <div
            className="flex flex-none items-center gap-2 border-b border-border-subtle bg-muted/40 px-3 py-1 text-2xs text-muted-foreground"
            data-iori-part="file-readonly-notice"
          >
            <span className="font-medium text-foreground">
              {t("Read-only")}
            </span>
            {!current.symlinkTarget && (
              <span>
                {t("Large or unsupported text files open read-only.")}
              </span>
            )}
          </div>
        )}
        <TextSurface
          key={`${active}:${openRevision}`}
          transport={transport}
          root={root}
          info={current}
          refresh={readRefresh}
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
      </>
    );
  else if (current.kind === "image")
    body = (
      <ImageSurface
        transport={transport}
        root={root}
        info={current}
        refresh={readRefresh}
        locale={locale}
      />
    );
  else if (current.kind === "symlink")
    body = (
      <ReadingEmpty
        state={`link-${current.symlinkTarget ?? "unknown"}`}
        title={
          current.symlinkTarget === "outside_root"
            ? t("This link points outside the open folder.")
            : t("This link's target no longer exists.")
        }
      />
    );
  else if (current.kind === "directory")
    body = <ReadingEmpty title={t("This is a folder")} />;
  else
    body = (
      <ReadingEmpty
        state={current.kind === "binary" ? "binary-file" : "unsupported-file"}
        title={
          current.kind === "binary"
            ? t("This file cannot be shown as text")
            : t("This format cannot be displayed")
        }
        description={[
          current.mimeType,
          current.sizeBytes === undefined
            ? undefined
            : formatBytes(current.sizeBytes, locale),
        ]
          .filter(Boolean)
          .join(" · ")}
      />
    );

  const detail = (
    <>
      {header}
      {current && fileError}
      <div
        className="reading-body relative flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if (event.defaultPrevented || !(event.ctrlKey || event.metaKey))
            return;
          const key = event.key.toLowerCase();
          if (key === "g" && textual && !rendered) {
            event.preventDefault();
            request("goTo");
          } else if (key === "h" && canEditText) {
            event.preventDefault();
            request("replace");
          } else if (key === "f" && !event.shiftKey && textual) {
            event.preventDefault();
            request("find");
          }
        }}
      >
        {body}
      </div>
    </>
  );

  const activeTabIndex = active ? view.tabs.indexOf(active) : -1;
  const focusableTabIndex = activeTabIndex >= 0 ? activeTabIndex : 0;

  return (
    <div
      className="files-pane flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-sm [&[hidden]]:hidden"
      aria-label={standalone ? t("File") : undefined}
      data-iori-view={standalone ? "file" : "files"}
      hidden={!visible}
    >
      {(watchError || saveFailed) && (
        <ReadingError
          retryLabel={t("Retry")}
          action={watchError ? "files-watch-retry" : "files-save-retry"}
          onRetry={() => {
            if (watchError) setWatchRetry((value) => value + 1);
            else persist();
          }}
        >
          {watchError ?? t("Could not save the reading position.")}
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
          <div
            className="flex h-9 flex-none items-center border-b border-border bg-sidebar [@media(pointer:coarse)]:h-11"
            data-iori-part="file-tabs"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "mx-0.5 ml-1 aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11",
                narrow && "[.mobile-retained-view_&]:hidden",
              )}
              data-iori-action={narrow ? "reading-back" : "toggle-file-list"}
              aria-label={
                narrow
                  ? t("Back to list")
                  : view.listOpen
                    ? t("Hide list")
                    : t("Show list")
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
            <div
              ref={strip}
              role="tablist"
              className="flex h-full min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [--tab-fade-left:0px] [--tab-fade-right:0px] [mask-image:linear-gradient(to_right,transparent,var(--foreground)_var(--tab-fade-left),var(--foreground)_calc(100%-var(--tab-fade-right)),transparent)] data-[left=true]:[--tab-fade-left:1rem] data-[right=true]:[--tab-fade-right:1rem]"
            >
              {view.tabs.map((path, index) => {
                const isSelected = path === active;
                return (
                  <PathMenu
                    key={path}
                    path={
                      info?.path === path
                        ? info.absolutePath
                        : joinHostPath(root, path)
                    }
                    relativePath={path}
                    locale={locale}
                    showIcons={false}
                    leadingActions={[
                      {
                        label: t("Close"),
                        action: "file-tab-close",
                        run: () => close(path),
                      },
                      {
                        label: t("Close Others"),
                        action: "file-tab-close-others",
                        disabled: view.tabs.length === 1,
                        run: () => closeTabs(path, "others"),
                      },
                      {
                        label: t("Close to the Right"),
                        action: "file-tab-close-right",
                        disabled: index === view.tabs.length - 1,
                        run: () => closeTabs(path, "right"),
                      },
                      {
                        label: t("Close to the Left"),
                        action: "file-tab-close-left",
                        disabled: index === 0,
                        run: () => closeTabs(path, "left"),
                      },
                      {
                        label: t("Close All"),
                        action: "file-tab-close-all",
                        run: () => closeTabs(path, "all"),
                      },
                    ]}
                    actions={[
                      {
                        label: t("Reveal in list"),
                        action: "file-tab-reveal",
                        run: () => {
                          setView((current) => ({
                            ...current,
                            listOpen: true,
                            detailOpen: false,
                          }));
                          tree.current?.reveal(path);
                        },
                      },
                      ...revealAction(
                        info?.path === path
                          ? info.absolutePath
                          : joinHostPath(root, path),
                      ),
                      ...(onFileHistory
                        ? [
                            {
                              label: t("File history"),
                              action: "file-tab-history",
                              run: () =>
                                onFileHistory(
                                  info?.path === path
                                    ? info.absolutePath
                                    : joinHostPath(root, path),
                                ),
                            },
                          ]
                        : []),
                      saveAction(path),
                    ]}
                    separateActions={false}
                  >
                    <div
                      className={cn(
                        "group/tab flex h-full max-w-[15.5rem] flex-none items-center border-b-2 transition-colors select-none",
                        isSelected
                          ? "border-primary bg-background text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )}
                      title={path}
                      onAuxClick={(event) => {
                        if (event.button === 1) close(path);
                      }}
                    >
                      <button
                        ref={(element) => {
                          if (element) tabRefs.current.set(path, element);
                          else tabRefs.current.delete(path);
                        }}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        tabIndex={index === focusableTabIndex ? 0 : -1}
                        data-iori-tab={path}
                        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 pr-1 pl-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                        onClick={() => selectTab(path)}
                        onKeyDown={(event) => {
                          const count = view.tabs.length;
                          if (!count) return;
                          if (event.key === "ArrowRight") {
                            event.preventDefault();
                            selectTab(view.tabs[(index + 1) % count]!, true);
                          } else if (event.key === "ArrowLeft") {
                            event.preventDefault();
                            selectTab(
                              view.tabs[(index - 1 + count) % count]!,
                              true,
                            );
                          } else if (event.key === "Home") {
                            event.preventDefault();
                            selectTab(view.tabs[0]!, true);
                          } else if (event.key === "End") {
                            event.preventDefault();
                            selectTab(view.tabs[count - 1]!, true);
                          } else if (event.key === "Delete") {
                            event.preventDefault();
                            close(path, true);
                          }
                        }}
                      >
                        <FileCode
                          className="size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate">
                          {path.split("/").at(-1)}
                        </span>
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={cn(
                          "mr-1 inline-flex size-[1.125rem] flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-current transition-opacity outline-none hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50",
                          "[@media(pointer:coarse)]:mr-0 [@media(pointer:coarse)]:size-11",
                          isSelected
                            ? "opacity-100"
                            : "opacity-0 group-hover/tab:opacity-100 [@media(pointer:coarse)]:pointer-events-none",
                        )}
                        aria-label={t("Close {value1}").replace(
                          "{value1}",
                          () => String(path),
                        )}
                        onClick={(event) => {
                          event.stopPropagation();
                          close(path);
                        }}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </div>
                  </PathMenu>
                );
              })}
            </div>
          </div>
          {detail}
        </SplitPane>
      )}
      {!standalone && (
        <>
          <FileCreateDialog
            open={Boolean(createTarget)}
            kind={createTarget?.kind ?? "file"}
            parentFolder={createTarget?.parentFolder ?? ""}
            locale={locale}
            onOpenChange={(open) => {
              if (!open) setCreateTarget(undefined);
            }}
            onSubmit={(relativePath) =>
              createEntry(relativePath, createTarget?.kind ?? "file")
            }
          />
          <FileRenameDialog
            target={renameTarget}
            locale={locale}
            onOpenChange={(open) => {
              if (!open) setRenameTarget(undefined);
            }}
            onSubmit={renameEntry}
          />
          <FileDeleteDialog
            target={deleteTarget}
            locale={locale}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(undefined);
            }}
            onConfirm={deleteEntry}
          />
        </>
      )}
      <UnsavedChangesDialog
        open={Boolean(pendingLeave)}
        saving={leaveSaving}
        t={t}
        saveLabel={editorStatus?.conflict ? t("Overwrite") : undefined}
        view="file-unsaved-changes"
        onCancel={() => setPendingLeave(undefined)}
        onDiscard={() => {
          const action = pendingLeave;
          setPendingLeave(undefined);
          action?.();
        }}
        onSave={() => {
          const action = pendingLeave;
          const editor = editorRef.current;
          if (!action || !editor) {
            setPendingLeave(undefined);
            action?.();
            return;
          }
          setLeaveSaving(true);
          void editor
            .save(editor.hasConflict())
            .then((ok) => {
              setLeaveSaving(false);
              if (ok) {
                setPendingLeave(undefined);
                action();
              } else {
                setPendingLeave(undefined);
              }
            })
            .catch(() => {
              setLeaveSaving(false);
              setPendingLeave(undefined);
            });
        }}
      />
    </div>
  );
}
