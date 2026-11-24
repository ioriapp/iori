import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  History,
  Minus,
  Plus,
  Undo2,
} from "lucide-react";
import { cn } from "cn";
import type { GitChangeEntry } from "@iori/protocol";
import { translator } from "../i18n.ts";
import { Checkbox } from "../components/ui/checkbox";
import { PathMenu, type MenuAction } from "../reading/PathMenu.tsx";
import { VirtualRows } from "../reading/VirtualRows.tsx";
import { LIST_ROW_PROBE_CLASS, useRowHeight } from "../reading/rowHeight.ts";
import { writePathDrag } from "../path-drag.ts";
import { ChangeIcon, kindName, parentDirectory } from "./changes.tsx";
import { buildChangesTreeRows, type ChangesTreeNode } from "./diff-review.ts";

export { buildChangesTreeRows, type ChangesTreeNode };

function defaultEntryKey(entry: GitChangeEntry): string {
  return `${entry.area}:${entry.path}`;
}

export function ChangesTreeList({
  entries,
  mode,
  filter,
  selectedKey,
  viewedPaths,
  locale,
  hostKey,
  repositoryRoot,
  onSelect,
  onToggleViewed,
  onOpenInFiles,
  onFileHistory,
  onStageEntry,
  onUnstageEntry,
  onDiscardEntry,
  writeBusy = false,
  getEntryKey = defaultEntryKey,
}: {
  entries: GitChangeEntry[];
  mode: "tree" | "flat";
  filter: string;
  selectedKey?: string;
  viewedPaths: ReadonlySet<string>;
  locale: string;
  hostKey: string;
  repositoryRoot: string;
  onSelect: (entry: GitChangeEntry) => void;
  onToggleViewed: (path: string) => void;
  onOpenInFiles?: (entry: GitChangeEntry) => void;
  onFileHistory?: (entry: GitChangeEntry) => void;
  onStageEntry?: (entry: GitChangeEntry) => void;
  onUnstageEntry?: (entry: GitChangeEntry) => void;
  onDiscardEntry?: (entry: GitChangeEntry) => void;
  writeBusy?: boolean;
  getEntryKey?: (entry: GitChangeEntry) => string;
}) {
  const ja = locale.startsWith("ja");
  const t = translator(locale);
  const row = useRowHeight();
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleFolder = (folderPath: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const rows: ChangesTreeNode[] = useMemo(() => {
    if (mode === "tree") {
      return buildChangesTreeRows(entries, collapsedFolders, filter);
    }
    const needle = filter.trim().toLowerCase();
    return entries
      .filter(
        (entry) =>
          !needle ||
          entry.path.toLowerCase().includes(needle) ||
          Boolean(entry.oldPath?.toLowerCase().includes(needle)),
      )
      .map((entry) => {
        const slash = entry.path.lastIndexOf("/");
        return {
          kind: "file" as const,
          entry,
          depth: 0,
          name: slash < 0 ? entry.path : entry.path.slice(slash + 1),
        };
      });
  }, [entries, mode, collapsedFolders, filter]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={row.probe}
        className={LIST_ROW_PROBE_CLASS}
        aria-hidden="true"
      />
      <VirtualRows
        count={rows.length}
        rowHeight={row.height}
        dataId="git-changes-tree"
        className="py-0.5 [&_.reading-virtual-row]:w-full"
        label={t("Changed files")}
        renderRow={(index) => {
          const node = rows[index];
          if (!node) return null;

          if (node.kind === "folder") {
            const collapsed = collapsedFolders.has(node.path);
            return (
              <button
                type="button"
                className="flex h-full w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent pr-2 text-left text-xs whitespace-nowrap text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset [@media(hover:hover)]:hover:bg-muted/70"
                style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
                aria-expanded={!collapsed}
                data-iori-action="git-tree-folder"
                data-path={node.path}
                title={node.path}
                onClick={() => toggleFolder(node.path)}
              >
                {collapsed ? (
                  <ChevronRight className="size-3.5 flex-none text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 flex-none text-muted-foreground" />
                )}
                {collapsed ? (
                  <Folder className="size-3.5 flex-none text-muted-foreground" />
                ) : (
                  <FolderOpen className="size-3.5 flex-none text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {node.label}
                </span>
                <span className="flex-none text-2xs text-muted-foreground tabular-nums">
                  {node.count}
                </span>
              </button>
            );
          }

          const { entry } = node;
          const entryKey = getEntryKey(entry);
          const active = selectedKey === entryKey;
          const viewed = viewedPaths.has(entry.path);
          const issue = entry.error ? t("Unreadable") : undefined;
          const canStage = entry.area !== "staged" && Boolean(onStageEntry);
          const canUnstage = entry.area === "staged" && Boolean(onUnstageEntry);
          const canDiscard =
            (entry.area === "unstaged" || entry.area === "untracked") &&
            Boolean(onDiscardEntry);
          const actions: MenuAction[] = [
            ...(canStage
              ? [
                  {
                    label: t("Stage changes"),
                    icon: <Plus />,
                    action: "git-stage-file",
                    disabled: writeBusy,
                    run: () => onStageEntry!(entry),
                  },
                ]
              : []),
            ...(canUnstage
              ? [
                  {
                    label: t("Unstage changes"),
                    icon: <Minus />,
                    action: "git-unstage-file",
                    disabled: writeBusy,
                    run: () => onUnstageEntry!(entry),
                  },
                ]
              : []),
            ...(canDiscard
              ? [
                  {
                    label: t("Discard changes"),
                    icon: <Undo2 />,
                    action: "git-discard-file",
                    disabled: writeBusy,
                    destructive: true,
                    run: () => onDiscardEntry!(entry),
                  },
                ]
              : []),
            ...(onOpenInFiles
              ? [
                  {
                    label: t("Open in Files"),
                    icon: <FileCode2 />,
                    action: "git-open-in-files",
                    run: () => onOpenInFiles(entry),
                  },
                ]
              : []),
            ...(onFileHistory
              ? [
                  {
                    label: t("File history"),
                    icon: <History />,
                    action: "git-file-history",
                    run: () => onFileHistory(entry),
                  },
                ]
              : []),
          ];

          return (
            <PathMenu
              path={entry.absolutePath}
              relativePath={entry.path}
              leadingActions={actions}
              locale={locale}
            >
              <div
                className={cn(
                  "group/row flex h-full w-full items-center pr-2 text-xs whitespace-nowrap text-foreground [@media(hover:hover)]:hover:bg-muted/70",
                  active &&
                    "bg-accent text-accent-foreground shadow-[inset_2px_0_0_var(--primary)]",
                )}
                style={{
                  paddingLeft: `${mode === "tree" ? node.depth * 14 + 8 : 8}px`,
                }}
                data-area={entry.area}
                data-kind={entry.kind}
                data-path={entry.path}
                data-viewed={viewed ? "true" : undefined}
              >
                <Checkbox
                  checked={viewed}
                  onCheckedChange={() => onToggleViewed(entry.path)}
                  data-iori-action="git-toggle-viewed"
                  data-path={entry.path}
                  aria-label={t("Viewed")}
                  title={t("Viewed")}
                  className="mr-1.5 size-3.5 flex-none"
                />
                <button
                  type="button"
                  className={cn(
                    "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs whitespace-nowrap text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
                    viewed && "opacity-60",
                  )}
                  aria-current={active || undefined}
                  data-iori-action="git-change-select"
                  data-area={entry.area}
                  data-kind={entry.kind}
                  data-path={entry.path}
                  title={`${entry.oldPath ? `${entry.oldPath} → ` : ""}${entry.path} · ${kindName(entry.kind, ja)}${issue ? ` · ${issue}` : ""}`}
                  draggable
                  onDragStart={(event) =>
                    writePathDrag(event.dataTransfer, {
                      hostKey,
                      root: repositoryRoot,
                      path: entry.path,
                      absolutePath: entry.absolutePath,
                    })
                  }
                  onClick={() => onSelect(entry)}
                >
                  <ChangeIcon kind={entry.kind} ja={ja} />
                  <span className="min-w-0 flex-[0_1_auto] truncate">
                    {node.name}
                  </span>
                  {mode === "flat" && (
                    <span className="min-w-0 flex-[0_1000_auto] truncate text-xs text-muted-foreground">
                      {parentDirectory(entry.path)}
                    </span>
                  )}
                  {issue && (
                    <span className="flex-none text-xs text-status-failed-text">
                      {issue}
                    </span>
                  )}
                  {(entry.addedLines !== undefined ||
                    entry.removedLines !== undefined) && (
                    <span className="ml-auto flex flex-none gap-1 pl-1.5 text-xs tabular-nums">
                      {entry.addedLines ? (
                        <span className="text-diff-add-text">
                          +{entry.addedLines}
                        </span>
                      ) : null}
                      {entry.removedLines ? (
                        <span className="text-diff-del-text">
                          −{entry.removedLines}
                        </span>
                      ) : null}
                    </span>
                  )}
                </button>
                {(canStage || canUnstage || canDiscard) && (
                  <span className="ml-1 flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
                    {canDiscard && (
                      <button
                        type="button"
                        disabled={writeBusy}
                        aria-label={t("Discard changes")}
                        title={t("Discard changes")}
                        data-iori-action="git-discard-file"
                        data-path={entry.path}
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-40 [@media(pointer:coarse)]:size-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDiscardEntry!(entry);
                        }}
                      >
                        <Undo2 className="size-3" aria-hidden="true" />
                      </button>
                    )}
                    {canStage && (
                      <button
                        type="button"
                        disabled={writeBusy}
                        aria-label={t("Stage changes")}
                        title={t("Stage changes")}
                        data-iori-action="git-stage-file"
                        data-path={entry.path}
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:size-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          onStageEntry!(entry);
                        }}
                      >
                        <Plus className="size-3" aria-hidden="true" />
                      </button>
                    )}
                    {canUnstage && (
                      <button
                        type="button"
                        disabled={writeBusy}
                        aria-label={t("Unstage changes")}
                        title={t("Unstage changes")}
                        data-iori-action="git-unstage-file"
                        data-path={entry.path}
                        className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:size-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUnstageEntry!(entry);
                        }}
                      >
                        <Minus className="size-3" aria-hidden="true" />
                      </button>
                    )}
                  </span>
                )}
              </div>
            </PathMenu>
          );
        }}
      />
    </div>
  );
}
