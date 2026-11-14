import { translator } from "../i18n.ts";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileCode,
  Folder,
  FolderOpen,
  Link,
  Upload,
  X,
} from "lucide-react";
import type { FileEntry } from "@iori/protocol";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { VirtualRows, type ScrollRequest } from "../reading/VirtualRows.tsx";
import { PathMenu } from "../reading/PathMenu.tsx";
import { writePathDrag } from "../path-drag.ts";
import { PagedList } from "../reading/paged.ts";
import { readErrorCopy, type ReadingTransport } from "../reading/transport.ts";
import { useRowHeight } from "../reading/rowHeight.ts";
import { ReadingError } from "../reading/ReadingError.tsx";

const PAGE = 128;

type Located = { directory: string; index: number; depth: number };

export type FileTreeHandle = {
  /** Reads again what a change may have touched; without paths, every open folder. */
  changed(paths?: string[]): void;
  reveal(path: string): void;
  openFilter(): void;
};

const isDirectory = (entry: FileEntry) =>
  entry.kind === "directory" ||
  (entry.kind === "symlink" &&
    entry.targetKind === "directory" &&
    entry.symlinkTarget === "inside_root");

const parentOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

/**
 * The folder tree. Only open folders are read; a change re-reads the folders
 * it touched and keeps every open folder open.
 */
export function FileTree({
  transport,
  root,
  hostKey,
  selected,
  onOpen,
  locale,
  expanded,
  onExpanded,
  handle,
  onPut,
  onChoose,
  onFolderDrop,
  onSave,
  footer,
}: {
  onSave: (path: string) => void;
  onPut: (files: File[], folder: string) => void;
  onChoose: (folder: string) => void;
  onFolderDrop: () => void;
  footer: React.ReactNode;
  transport: ReadingTransport;
  root: string;
  hostKey: string;
  selected?: string;
  onOpen: (path: string) => void;
  locale: string;
  expanded: string[];
  onExpanded: (paths: string[]) => void;
  handle: Ref<FileTreeHandle>;
}) {
  const ja = locale.startsWith("ja");
  const t = translator(locale);
  const [dropFolder, setDropFolder] = useState<string>();
  const destination = (target: EventTarget | null) =>
    (target instanceof Element
      ? target.closest<HTMLElement>("[data-iori-put-folder]")?.dataset
          .ioriPutFolder
      : undefined) ?? "";
  const putAction = (folder: string) => [
    {
      label: t("Upload files…"),
      icon: <Upload aria-hidden="true" />,
      action: "files-put",
      run: () => onChoose(folder),
    },
  ];
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [scroll, setScroll] = useState<ScrollRequest>();
  const lists = useRef(new Map<string, PagedList<FileEntry>>());
  // Where each open folder sits in its parent; found again after its parent changes.
  const positions = useRef(new Map<string, number>());
  const open = useRef(new Set(expanded));
  const filterInput = useRef<HTMLInputElement>(null);
  const row = useRowHeight();
  const pendingReveal = useRef<string | undefined>(undefined);

  const listFor = useCallback(
    (path: string) => {
      let list = lists.current.get(path);
      if (!list) {
        list = new PagedList<FileEntry>(async (start, count, signal) => {
          const result = await transport.request(
            "files.list",
            { root, path, start, count },
            signal,
          );
          return { items: result.entries, total: result.total };
        }, PAGE);
        list.subscribe(render);
        lists.current.set(path, list);
      }
      return list;
    },
    [transport, root],
  );
  useEffect(
    () => () => {
      for (const list of lists.current.values()) list.pause();
    },
    [listFor],
  );

  const locateChild = useCallback(
    async (path: string) => {
      const parent = parentOf(path);
      const result = await transport.request("files.list", {
        root,
        path: parent,
        start: 0,
        count: 1,
        locate: path.slice(path.lastIndexOf("/") + 1),
      });
      return result.located;
    },
    [transport, root],
  );

  const setOpen = (paths: Set<string>) => {
    open.current = paths;
    onExpanded([...paths]);
    render();
  };

  // Open folders restored from the saved view find their places first.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      for (const path of [...open.current].sort(
        (a, b) => a.split("/").length - b.split("/").length,
      )) {
        let index: number | undefined;
        try {
          index = await locateChild(path);
        } catch {
          if (disposed) return;
          continue;
        }
        if (disposed) return;
        if (!open.current.has(path)) continue;
        if (index === undefined) open.current.delete(path);
        else positions.current.set(path, index);
      }
      render();
    })();
    return () => {
      disposed = true;
    };
  }, [locateChild]);

  const findList = useRef<PagedList<FileEntry> | undefined>(undefined);
  useEffect(() => {
    findList.current?.pause();
    findList.current = undefined;
    if (!query) return render();
    const list = new PagedList<FileEntry>(async (start, count, signal) => {
      const result = await transport.request(
        "files.find",
        { root, query, start, count },
        signal,
      );
      return { items: result.entries, hasMore: result.hasMore };
    }, PAGE);
    list.subscribe(render);
    findList.current = list;
    render();
    return () => list.pause();
  }, [transport, root, query]);

  const childrenOf = (path: string) =>
    [...open.current]
      .filter(
        (child) => parentOf(child) === path && positions.current.has(child),
      )
      .map((child) => [positions.current.get(child)!, child] as const)
      .sort((a, b) => a[0] - b[0]);
  const size = (path: string): number => {
    let count = listFor(path).count;
    for (const [, child] of childrenOf(path)) count += size(child);
    return count;
  };
  const locate = (row: number, path = "", depth = 0): Located => {
    let index = row;
    for (const [position, child] of childrenOf(path)) {
      if (index <= position) break;
      const childSize = size(child);
      if (index <= position + childSize)
        return locate(index - position - 1, child, depth + 1);
      index -= childSize;
    }
    return { directory: path, index, depth };
  };
  const rowOf = (path: string): number | undefined => {
    let row = 0;
    let parent = "";
    for (const part of path.split("/")) {
      const child = parent ? `${parent}/${part}` : part;
      const position = positions.current.get(child);
      if (position === undefined) return undefined;
      row += position;
      for (const [index, sibling] of childrenOf(parent))
        if (index < position) row += size(sibling);
      if (child === path) return row;
      row += 1;
      parent = child;
    }
    return undefined;
  };

  // A scroll request is consumed once. Wait for the ancestor lists to supply
  // their counts, so VirtualRows cannot clamp it to a temporary one-row list.
  useEffect(() => {
    const path = pendingReveal.current;
    if (!path) return;
    const parts = path.split("/");
    for (let depth = 0; depth < parts.length; depth++)
      if (!listFor(parts.slice(0, depth).join("/")).loaded) return;
    const row = rowOf(path);
    if (row === undefined) return;
    pendingReveal.current = undefined;
    setFocus(row);
    setScroll({ index: row, align: "center", key: Date.now() });
  });

  const toggle = (entry: FileEntry, index: number) => {
    const next = new Set(open.current);
    if (next.has(entry.path)) {
      for (const path of next)
        if (path === entry.path || path.startsWith(`${entry.path}/`)) {
          next.delete(path);
          lists.current.get(path)?.pause();
          lists.current.delete(path);
        }
    } else {
      next.add(entry.path);
      positions.current.set(entry.path, index);
    }
    setOpen(next);
  };

  useImperativeHandle(
    handle,
    () => ({
      changed(paths) {
        findList.current?.refresh();
        const folders = paths
          ? new Set(paths.flatMap((path) => [parentOf(path), path]))
          : undefined;
        for (const [path, list] of lists.current) {
          if (folders && !folders.has(path)) continue;
          list.refresh();
        }
        // Also retry restored folders whose parent list has not loaded yet.
        for (const child of open.current) {
          if (folders && !folders.has(parentOf(child))) continue;
          void locateChild(child).then(
            (index) => {
              if (!open.current.has(child)) return;
              if (index === undefined) {
                const next = new Set(open.current);
                next.delete(child);
                setOpen(next);
              } else if (positions.current.get(child) !== index) {
                positions.current.set(child, index);
                render();
              }
            },
            () => undefined,
          );
        }
      },
      openFilter() {
        setFilterOpen(true);
        filterInput.current?.focus({ preventScroll: true });
      },
      reveal(path) {
        void (async () => {
          const parts = path.split("/");
          const next = new Set(open.current);
          for (let depth = 1; depth <= parts.length; depth += 1) {
            const current = parts.slice(0, depth).join("/");
            const index = await locateChild(current);
            if (index === undefined) return;
            positions.current.set(current, index);
            listFor(parentOf(current)).ensure(index, index);
            if (depth < parts.length) next.add(current);
          }
          pendingReveal.current = path;
          setOpen(next);
        })().catch(() => undefined);
      },
    }),
    [locateChild, listFor],
  );

  const onRange = useCallback(
    (first: number, last: number) => {
      if (findList.current) return findList.current.ensure(first, last);
      const wanted = new Map<string, { first: number; last: number }>();
      for (let row = first; row <= last; row += 1) {
        const at = locate(row);
        const range = wanted.get(at.directory);
        if (range) range.last = at.index;
        else wanted.set(at.directory, { first: at.index, last: at.index });
      }
      for (const [path, range] of wanted)
        listFor(path).ensure(range.first, range.last);
    },
    [listFor, query],
  );

  const searching = Boolean(findList.current);
  const total = findList.current ? findList.current.count : size("");
  const entryAt = (row: number) => {
    if (findList.current)
      return { entry: findList.current.get(row), depth: 0, index: row };
    const at = locate(row);
    return {
      entry: listFor(at.directory).get(at.index),
      depth: at.depth,
      index: at.index,
      directory: at.directory,
    };
  };
  const failed =
    findList.current?.error ??
    [...lists.current.values()].find((list) => list.error)?.error;

  const activate = (entry: FileEntry, index: number) => {
    if (searching) {
      onOpen(entry.path);
      return;
    }
    if (isDirectory(entry)) toggle(entry, index);
    else onOpen(entry.path);
  };

  return (
    <PathMenu path={root} locale={locale} actions={putAction("")}>
      <div
        className="files-tree"
        data-drop-root={dropFolder === "" || undefined}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropFolder(destination(event.target));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropFolder(undefined);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDropFolder(undefined);
          const items = Array.from(event.dataTransfer.items);
          if (items.some((item) => item.webkitGetAsEntry()?.isDirectory)) {
            onFolderDrop();
            return;
          }
          onPut(
            Array.from(event.dataTransfer.files),
            destination(event.target),
          );
        }}
      >
        <div ref={row.probe} className="reading-row-probe" aria-hidden="true" />
        {(filterOpen || query) && (
          <div className="files-filter">
            <Input
              ref={filterInput}
              autoFocus
              aria-label={t("Filter by file name")}
              data-iori-field="file-filter"
              placeholder={t("Filter by file name")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setQuery("");
                  setFilterOpen(false);
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Clear filter")}
              data-iori-action="file-filter-clear"
              onClick={() => {
                setQuery("");
                setFilterOpen(false);
              }}
            >
              <X />
            </Button>
          </div>
        )}
        {Boolean(failed) && (
          <ReadingError
            retryLabel={t("Retry")}
            onRetry={() => {
              findList.current?.retry();
              for (const list of lists.current.values())
                if (list.error) list.retry();
            }}
          >
            {readErrorCopy(failed, locale)}
          </ReadingError>
        )}
        <VirtualRows
          count={total}
          rowHeight={row.height}
          dataId={searching ? "file-find" : "file-tree"}
          role="tree"
          label={ja ? "ファイル" : "Files"}
          className="files-tree-rows"
          scrollRequest={scroll}
          onRange={onRange}
          onKeyDown={(event) => {
            const current = entryAt(focus);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next = Math.max(
                0,
                Math.min(
                  total - 1,
                  focus + (event.key === "ArrowDown" ? 1 : -1),
                ),
              );
              setFocus(next);
              setScroll({ index: next, key: Date.now() });
            } else if (
              event.key === "ArrowRight" &&
              current.entry &&
              isDirectory(current.entry) &&
              !open.current.has(current.entry.path) &&
              !searching
            ) {
              event.preventDefault();
              toggle(current.entry, current.index);
            } else if (
              event.key === "ArrowLeft" &&
              !searching &&
              current.entry
            ) {
              event.preventDefault();
              if (open.current.has(current.entry.path))
                toggle(current.entry, current.index);
              else {
                const parent = rowOf(parentOf(current.entry.path));
                if (parent !== undefined && parentOf(current.entry.path)) {
                  setFocus(parent);
                  setScroll({ index: parent, key: Date.now() });
                }
              }
            } else if (event.key === "Enter" && current.entry) {
              event.preventDefault();
              activate(current.entry, current.index);
            } else if (
              event.key.length === 1 &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              setFilterOpen(true);
              setQuery((value) => value + event.key);
              event.preventDefault();
            }
          }}
          renderRow={(rowIndex) => {
            const { entry, depth, index } = entryAt(rowIndex);
            if (!entry)
              return <div className="files-tree-row" data-loading="true" />;
            const directory = isDirectory(entry);
            const opened = open.current.has(entry.path);
            const outside =
              entry.kind === "symlink" && entry.symlinkTarget !== "inside_root";
            return (
              <PathMenu
                path={entry.absolutePath}
                locale={locale}
                actions={
                  directory
                    ? putAction(entry.path)
                    : entry.kind === "file" ||
                        (entry.kind === "symlink" &&
                          entry.targetKind === "file" &&
                          entry.symlinkTarget === "inside_root")
                      ? [
                          {
                            label: t("Download…"),
                            icon: <Download aria-hidden="true" />,
                            action: "files-save",
                            run: () => onSave(entry.path),
                          },
                        ]
                      : []
                }
              >
                <div
                  className="files-tree-row"
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-selected={selected === entry.path}
                  aria-expanded={directory && !searching ? opened : undefined}
                  data-active={selected === entry.path || undefined}
                  data-focused={focus === rowIndex || undefined}
                  data-iori-file={entry.path}
                  data-iori-put-folder={
                    directory ? entry.path : parentOf(entry.path)
                  }
                  data-drop-target={
                    (directory && dropFolder === entry.path) || undefined
                  }
                  style={{ "--level": depth } as CSSProperties}
                  title={searching ? entry.path : entry.name}
                  draggable
                  onDragStart={(event) =>
                    writePathDrag(event.dataTransfer, {
                      hostKey,
                      root,
                      path: entry.path,
                      absolutePath: entry.absolutePath,
                    })
                  }
                  onClick={() => {
                    setFocus(rowIndex);
                    activate(entry, index);
                  }}
                >
                  <span className="files-tree-chevron" aria-hidden="true">
                    {directory &&
                      !searching &&
                      (opened ? <ChevronDown /> : <ChevronRight />)}
                  </span>
                  {directory ? (
                    opened ? (
                      <FolderOpen />
                    ) : (
                      <Folder />
                    )
                  ) : entry.kind === "symlink" ? (
                    <Link />
                  ) : (
                    <FileCode />
                  )}
                  <span className="files-tree-name">{entry.name}</span>
                  {searching && parentOf(entry.path) && (
                    <span className="files-tree-parent">
                      {parentOf(entry.path)}
                    </span>
                  )}
                  {outside && (
                    <span className="files-tree-note">
                      {entry.symlinkTarget === "broken"
                        ? t("broken link")
                        : t("outside")}
                    </span>
                  )}
                </div>
              </PathMenu>
            );
          }}
        />
        {footer}
      </div>
    </PathMenu>
  );
}
