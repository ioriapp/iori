import { translator } from "../i18n.ts";
import { useNarrowBack } from "../reading/useNarrowBack.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileCode2,
  FolderTree,
  GitCompareArrows,
  History,
  List,
  Minus,
  PanelLeft,
  Plus,
  Search,
  Undo2,
  X,
} from "lucide-react";
import type {
  GitChangeArea,
  GitChangeEntry,
  GitCommitFile,
  GitDiffSource,
  GitHistoryEntry,
  GitRepositoryStatus,
  GitWriteResult,
  ReadResultByMethod,
} from "@iori/protocol";
import type { OpenFile } from "../workspace-panel.tsx";
import type { AgentTarget } from "../forge/AgentTargetPicker.tsx";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { SplitPane } from "../reading/SplitPane.tsx";
import { useSavedViewState } from "../reading/savedViewState.ts";
import {
  WorktreePicker,
  type WorktreeChoice,
} from "../reading/WorktreePicker.tsx";
import { VirtualRows } from "../reading/VirtualRows.tsx";
import { PathMenu } from "../reading/PathMenu.tsx";
import { PathEllipsis } from "../reading/PathEllipsis.tsx";
import { writePathDrag } from "../path-drag.ts";
import { usePagedList } from "../reading/paged.ts";
import { readErrorCopy, type ReadingTransport } from "../reading/transport.ts";
import { formatDate } from "../reading/format.ts";
import { LIST_ROW_PROBE_CLASS, useRowHeight } from "../reading/rowHeight.ts";
import {
  DiffViewer,
  emptyDiffPosition,
  type DiffPosition,
} from "./DiffViewer.tsx";
import { CommitDetail } from "./CommitDetail.tsx";
import {
  ChangeIcon,
  areaName,
  areaOrder,
  kindName,
  parentDirectory,
} from "./changes.tsx";
import { ReadingError } from "../reading/ReadingError.tsx";
import { ReadingEmpty, ReadingLoading } from "../reading/ReadingStates.tsx";
import { ChangesTreeList } from "./ChangesTree.tsx";
import {
  DiffCommentsBar,
  formatDiffCommentsForAgent,
  type DiffComment,
} from "./DiffComments.tsx";
import {
  GitCommitBox,
  GitDiscardDialog,
  GitRemoteBar,
  type GitDiscardTarget,
  type GitRemoteBarProps,
} from "./GitWriteControls.tsx";

export type GitPaneProps = {
  transport: ReadingTransport;
  hostKey: string;
  /** The worktree or folder; Git reads the repository that contains it. */
  root: string;
  /** The worktree's name, shown until Git reports the branch. */
  label: string;
  /** The opened folder's worktrees, to switch this View between. */
  worktrees?: WorktreeChoice[];
  onSelectWorktree?: (path: string) => void;
  locale?: string;
  visible?: boolean;
  /** The View's state as saved with the workspace layout. */
  viewState?: unknown;
  onViewState?: (state: GitViewState) => void;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
  /** Shows the history of this file (repository-relative or an absolute Host path). */
  fileHistoryRequest?: { path: string; id: number };
  onFileHistoryShown?: (id: number) => void;
  /** Opens the diff of this changed file in the Changes tab (working tree or branch diff). */
  diffOpenRequest?: { path: string; baseBranch?: string; id: number };
  onDiffOpened?: (id: number) => void;
  /** Opens this file in Files View (optionally at a 1-based line). */
  onOpenFile?: (file: OpenFile, standalone?: boolean) => void;
  /** Eligible non-child Agent/Terminal destinations. */
  agentTargets?: AgentTarget[];
  /** Sends formatted diff review comments into an eligible Agent/Terminal input without Enter. */
  onSendTextToTerminal?: (text: string, terminalId?: string) => boolean;
};

type Selected = Pick<
  GitChangeEntry,
  "area" | "path" | "oldPath" | "kind" | "stages" | "absolutePath"
> & { branchScope?: boolean };
export type GitViewState = {
  mode: "changes" | "history";
  scope?: "working" | "branch";
  baseBranch?: string;
  listLayout?: "flat" | "tree";
  splitDiff?: boolean;
  change?: Selected;
  stage?: 1 | 2 | 3;
  commit?: string;
  parent?: string;
  commitFile?: GitCommitFile;
  filter?: string;
  closed: GitChangeArea[];
  listOpen: boolean;
  detailOpen: boolean;
  diff: DiffPosition;
  /** The list's share of the width, in percent. */
  ratio?: number;
};
type ViewState = GitViewState;
type Counts = ReadResultByMethod["git.status"]["counts"];
type Row =
  | { section: GitChangeArea; count: number }
  | { area: GitChangeArea; index: number };

// A saved state is read leniently; the shape is iori's own, so only the types
// the View relies on are kept.
function readViewState(value: unknown): ViewState {
  const saved: Partial<ViewState> =
    value && typeof value === "object" ? { ...value } : {};
  return {
    ...saved,
    mode: saved.mode === "history" ? "history" : "changes",
    scope: saved.scope === "branch" ? "branch" : "working",
    baseBranch:
      typeof saved.baseBranch === "string" ? saved.baseBranch : undefined,
    listLayout: saved.listLayout === "tree" ? "tree" : "flat",
    splitDiff: saved.splitDiff === true,
    closed: Array.isArray(saved.closed) ? saved.closed : [],
    listOpen: saved.listOpen !== false,
    detailOpen: saved.detailOpen === true,
    diff: { ...emptyDiffPosition(), ...saved.diff },
  };
}

/** A View of the workspace frame: the frame supplies the Host, the folder and the saved state. */
export function GitPane(props: GitPaneProps) {
  return (
    <GitWorkspace
      key={JSON.stringify([props.hostKey, props.root])}
      {...props}
    />
  );
}

function GitWorkspace({
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
  fileHistoryRequest,
  onFileHistoryShown,
  diffOpenRequest,
  onDiffOpened,
  onOpenFile,
  agentTargets,
  onSendTextToTerminal,
}: GitPaneProps) {
  const ja = locale.startsWith("ja");
  const t = translator(locale);
  const [view, setView] = useState(() => readViewState(viewState));
  const [narrow, setNarrow] = useState(false);
  const [repository, setRepository] = useState<GitRepositoryStatus>();
  const [isRepository, setIsRepository] = useState<boolean>();
  const [counts, setCounts] = useState<Counts>();
  const [diffRefresh, setDiffRefresh] = useState(0);
  const [commitRefresh, setCommitRefresh] = useState(0);
  const [watchError, setWatchError] = useState<string>();
  const [watchRetry, setWatchRetry] = useState(0);
  const [branchesState, setBranchesState] = useState<{
    current?: string;
    defaultBase?: string;
    branches: string[];
    loaded: boolean;
    error?: unknown;
  }>({ branches: [], loaded: false });
  const [branchRefresh, setBranchRefresh] = useState(0);
  const [branchEntries, setBranchEntries] = useState<GitChangeEntry[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<unknown>();
  const [changesFilter, setChangesFilter] = useState("");
  const [viewedFingerprints, setViewedFingerprints] = useState<
    Record<string, string>
  >({});
  const [comments, setComments] = useState<DiffComment[]>([]);
  const [commentJump, setCommentJump] = useState<{
    id: number;
    path: string;
    side: "old" | "new";
    line: number;
  }>();
  const [writeBusy, setWriteBusy] = useState<NonNullable<
    GitRemoteBarProps["busy"]
  > | null>(null);
  const [writeError, setWriteError] = useState<string>();
  const [discardRequest, setDiscardRequest] = useState<{
    target: GitDiscardTarget;
    run: () => Promise<void>;
  }>();
  const writeBusyRef = useRef(writeBusy);
  writeBusyRef.current = writeBusy;
  const update = (value: Partial<ViewState>) =>
    setView((current) => ({ ...current, ...value }));
  const row = useRowHeight();

  // A file's history asked for by Files is shown once.
  const shown = useRef(onFileHistoryShown);
  shown.current = onFileHistoryShown;
  useEffect(() => {
    if (!fileHistoryRequest) return;
    update({
      mode: "history",
      filter: fileHistoryRequest.path,
      commit: undefined,
      commitFile: undefined,
      detailOpen: false,
    });
    shown.current?.(fileHistoryRequest.id);
  }, [fileHistoryRequest]);

  // A file's diff asked for by Files or PR Changed Files is opened once in the Changes tab.
  const diffOpened = useRef(onDiffOpened);
  diffOpened.current = onDiffOpened;
  useEffect(() => {
    if (!diffOpenRequest) return;
    const targetPath = diffOpenRequest.path;
    const requestedBase = diffOpenRequest.baseBranch;
    const matches = (entry?: GitChangeEntry) =>
      entry && (entry.path === targetPath || entry.absolutePath === targetPath);

    if (requestedBase) {
      const controller = new AbortController();
      const applyBranch = (resolvedBase: string, entry?: GitChangeEntry) => {
        if (entry) {
          update({
            mode: "changes",
            scope: "branch",
            baseBranch: resolvedBase,
            change: {
              area: entry.area,
              path: entry.path,
              oldPath: entry.oldPath,
              kind: entry.kind,
              stages: entry.stages,
              absolutePath: entry.absolutePath,
              branchScope: true,
            },
            stage: undefined,
            detailOpen: true,
            diff: emptyDiffPosition(),
          });
        } else {
          update({
            mode: "changes",
            scope: "branch",
            baseBranch: resolvedBase,
          });
        }
        diffOpened.current?.(diffOpenRequest.id);
      };
      const loadBranchDiff = async () => {
        // Prefer the remote tracking branch (e.g. origin/main) over a potentially stale local base.
        const candidates = requestedBase.includes("/")
          ? [requestedBase]
          : [`origin/${requestedBase}`, requestedBase];
        for (const base of candidates) {
          try {
            const result = await transport.request(
              "git.branchChanges",
              { root, base, start: 0, count: 512 },
              controller.signal,
            );
            if (controller.signal.aborted) return;
            setBranchEntries(result.entries);
            applyBranch(
              base,
              result.entries.find((entry) => matches(entry)),
            );
            return;
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        applyBranch(requestedBase, undefined);
      };
      void loadBranchDiff();
      return () => controller.abort();
    }

    const apply = (entry?: GitChangeEntry) => {
      if (entry) {
        update({
          mode: "changes",
          scope: "working",
          change: {
            area: entry.area,
            path: entry.path,
            oldPath: entry.oldPath,
            kind: entry.kind,
            stages: entry.stages,
            absolutePath: entry.absolutePath,
          },
          stage: entry.stages?.includes(2) ? 2 : entry.stages?.[0],
          detailOpen: true,
          diff: emptyDiffPosition(),
        });
      } else {
        update({ mode: "changes", scope: "working" });
      }
      diffOpened.current?.(diffOpenRequest.id);
    };
    const loadedStatus = lists.current.status;
    for (let index = 0; index < loadedStatus.count; index += 1) {
      const entry = loadedStatus.get(index);
      if (matches(entry)) {
        apply(entry);
        return;
      }
    }
    const controller = new AbortController();
    void transport
      .request("git.status", { root, start: 0, count: 512 }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        apply(result.entries.find((entry) => matches(entry)));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        apply(undefined);
      });
    return () => controller.abort();
  }, [diffOpenRequest, transport, root]);
  // The view is saved with the workspace layout shortly after it changes, and
  // at once when the View closes.
  const changeRatio = useSavedViewState(view, onViewState);

  // On a narrow screen, going back leaves a commit's file for the commit, and
  // the detail for the list.
  const imageBack = useRef<(() => boolean) | undefined>(undefined);
  const setImageBack = useCallback((handler: (() => boolean) | undefined) => {
    imageBack.current = handler;
  }, []);
  const inCommitFile = view.mode === "history" && Boolean(view.commitFile);
  const showsDetail = narrow && view.detailOpen;
  useNarrowBack(
    onBackHandler,
    showsDetail,
    () => {
      if (imageBack.current?.()) return true;
      setView((value) =>
        value.mode === "history" && value.commitFile
          ? { ...value, commitFile: undefined }
          : { ...value, detailOpen: false },
      );
      return true;
    },
    inCommitFile,
  );

  const status = usePagedList<GitChangeEntry>(
    `status:${root}`,
    async (start, count, signal) => {
      const result = await transport.request(
        "git.status",
        { root, start, count },
        signal,
      );
      setIsRepository(result.isRepository);
      setRepository(result.repository);
      setCounts(result.counts);
      const total = areaOrder.reduce(
        (sum, area) => sum + result.counts[area],
        0,
      );
      return { items: result.entries, total };
    },
  );
  const history = usePagedList<GitHistoryEntry>(
    `history:${root}:${view.filter ?? ""}`,
    async (start, count, signal) => {
      const result = await transport.request(
        "git.history",
        { root, start, count, ...(view.filter ? { path: view.filter } : {}) },
        signal,
      );
      return { items: result.commits, hasMore: result.hasMore };
    },
    64,
  );

  const scope = view.scope ?? "working";
  const listLayout = view.listLayout ?? "flat";
  const matchedBase = view.baseBranch
    ? branchesState.branches.includes(view.baseBranch)
      ? view.baseBranch
      : branchesState.branches.find(
          (branch) => branch === `origin/${view.baseBranch}`,
        )
    : undefined;
  const effectiveBase =
    matchedBase ??
    (!branchesState.loaded && view.baseBranch
      ? view.baseBranch
      : branchesState.defaultBase);

  useEffect(() => {
    if (!visible || isRepository === false) return;
    const controller = new AbortController();
    void transport
      .request("git.branches", { root }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setBranchesState({
          current: result.current,
          defaultBase: result.defaultBase,
          branches: result.branches,
          loaded: true,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setBranchesState((prev) => ({
          ...prev,
          loaded: true,
          error,
        }));
      });
    return () => controller.abort();
  }, [transport, root, visible, isRepository, branchRefresh]);

  useEffect(() => {
    if (
      !visible ||
      view.mode !== "changes" ||
      scope !== "branch" ||
      !effectiveBase
    ) {
      setBranchLoading(false);
      return;
    }
    const controller = new AbortController();
    setBranchLoading(true);
    setBranchError(undefined);
    void transport
      .request(
        "git.branchChanges",
        { root, base: effectiveBase, start: 0, count: 512 },
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        setBranchEntries(result.entries);
        setBranchLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setBranchError(error);
        setBranchLoading(false);
      });
    return () => controller.abort();
  }, [
    transport,
    root,
    visible,
    view.mode,
    scope,
    effectiveBase,
    branchRefresh,
  ]);

  // The first page tells how many changes each section has.
  useEffect(() => {
    if (visible && !counts) status.ensure(0, 0);
  }, [status, visible, counts]);

  const totalWorkingChanges = counts
    ? areaOrder.reduce((sum, area) => sum + counts[area], 0)
    : 0;
  const needsAllWorking =
    scope === "working" &&
    (listLayout === "tree" || changesFilter.trim().length > 0);
  useEffect(() => {
    if (visible && needsAllWorking && totalWorkingChanges > 0) {
      status.ensure(0, Math.min(totalWorkingChanges - 1, 511));
    }
  }, [visible, needsAllWorking, totalWorkingChanges, status]);

  // The list and the shown diff follow changes; a hidden view does not watch.
  const selected = useRef(view.change);
  selected.current = view.change;
  const lists = useRef({ status, history });
  lists.current = { status, history };
  useEffect(() => {
    if (!visible) return;
    return transport.watch(
      root,
      "git",
      ({ paths }) => {
        setWatchError(undefined);
        lists.current.status.refresh();
        setBranchRefresh((value) => value + 1);
        if (paths && paths.length > 0) {
          setViewedFingerprints((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const path of paths) {
              if (path in next) {
                delete next[path];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
        if (!paths) {
          lists.current.history.refresh();
          setCommitRefresh((value) => value + 1);
        }
        const change = selected.current;
        if (
          change &&
          (!paths ||
            paths.includes(change.path) ||
            (change.oldPath && paths.includes(change.oldPath)))
        )
          setDiffRefresh((value) => value + 1);
      },
      (error) => setWatchError(readErrorCopy(error, locale)),
    );
  }, [transport, root, visible, watchRetry, locale]);

  // Changes are listed in sections; a closed section shows only its heading.
  const areaStart: Partial<Record<GitChangeArea, number>> = {};
  if (counts) {
    let offset = 0;
    for (const area of areaOrder) {
      areaStart[area] = offset;
      offset += counts[area];
    }
  }
  const rowAt = (index: number): Row | undefined => {
    if (!counts) return undefined;
    let at = index;
    for (const area of areaOrder) {
      const count = counts[area];
      if (!count) continue;
      if (at === 0) return { section: area, count };
      at -= 1;
      const shown = view.closed.includes(area) ? 0 : count;
      if (at < shown) return { area, index: areaStart[area]! + at };
      at -= shown;
    }
    return undefined;
  };
  const changeRows = counts
    ? areaOrder.reduce(
        (sum, area) =>
          sum +
          (counts[area]
            ? 1 + (view.closed.includes(area) ? 0 : counts[area])
            : 0),
        0,
      )
    : 0;

  const entryFingerprint = (entry: GitChangeEntry) =>
    `${entry.area}:${entry.kind}:${entry.oldPath ?? ""}:${entry.addedLines ?? ""}:${entry.removedLines ?? ""}`;

  // `status` is a stable PagedList reference whose items populate via re-renders.
  const workingLoadedEntries: GitChangeEntry[] = [];
  for (let i = 0; i < Math.min(status.count, 512); i += 1) {
    const item = status.get(i);
    if (item) workingLoadedEntries.push(item);
  }

  const activeEntries =
    scope === "branch" ? branchEntries : workingLoadedEntries;
  const fingerprintByPath = new Map<string, string>();
  for (const item of activeEntries) {
    fingerprintByPath.set(item.path, entryFingerprint(item));
  }

  const viewedPaths = new Set<string>();
  for (const [path, fp] of Object.entries(viewedFingerprints)) {
    const currentFp = fingerprintByPath.get(path);
    if (currentFp && currentFp === fp) viewedPaths.add(path);
  }

  const toggleViewed = (path: string) => {
    const currentFp = fingerprintByPath.get(path);
    if (!currentFp) return;
    setViewedFingerprints((prev) => {
      if (prev[path] === currentFp) {
        const next = { ...prev };
        delete next[path];
        return next;
      }
      return { ...prev, [path]: currentFp };
    });
  };

  const openInFiles = useCallback(
    (path: string, absolutePath: string, line?: number) => {
      if (!onOpenFile) return;
      onOpenFile({
        absolutePath,
        root: repository?.root ?? root,
        path,
        displayPath: path,
        ...(line !== undefined ? { line } : {}),
      });
    },
    [onOpenFile, repository?.root, root],
  );

  const selectEntry = useCallback(
    (entry: GitChangeEntry, branchScope: boolean) => {
      update({
        change: {
          area: entry.area,
          path: entry.path,
          oldPath: entry.oldPath,
          kind: entry.kind,
          stages: entry.stages,
          absolutePath: entry.absolutePath,
          branchScope,
        },
        stage: entry.stages?.includes(2) ? 2 : entry.stages?.[0],
        detailOpen: true,
        diff: emptyDiffPosition(),
      });
    },
    [],
  );

  const openHistory = (path: string) =>
    update({
      mode: "history",
      filter: path,
      commit: undefined,
      commitFile: undefined,
      detailOpen: false,
    });

  const runWrite = async (
    kind: NonNullable<GitRemoteBarProps["busy"]>,
    operation: () => Promise<GitWriteResult>,
    options?: {
      clearSelectedAreas?: GitChangeArea[];
      clearSelectedPath?: string;
    },
  ): Promise<boolean> => {
    if (writeBusyRef.current) return false;
    writeBusyRef.current = kind;
    setWriteBusy(kind);
    setWriteError(undefined);
    try {
      const result = await operation();
      if (!result.ok) {
        setWriteError(result.message);
        return false;
      }
      lists.current.status.refresh();
      lists.current.history.refresh();
      setBranchRefresh((value) => value + 1);
      setCommitRefresh((value) => value + 1);
      setDiffRefresh((value) => value + 1);
      const current = selected.current;
      if (current && !current.branchScope && options) {
        const areaMatch = options.clearSelectedAreas?.includes(current.area);
        const pathMatch =
          options.clearSelectedPath === undefined ||
          current.path === options.clearSelectedPath;
        if (areaMatch && pathMatch) {
          update({ change: undefined, detailOpen: false });
        }
      }
      return true;
    } catch (error) {
      setWriteError(
        readErrorCopy(error, locale) ?? t("Could not complete this operation."),
      );
      return false;
    } finally {
      writeBusyRef.current = null;
      setWriteBusy(null);
    }
  };

  const handleStageEntry = (entry: GitChangeEntry) => {
    void runWrite(
      "stage",
      () => transport.request("git.stage", { root, paths: [entry.path] }),
      {
        clearSelectedAreas: ["unstaged", "untracked", "conflict"],
        clearSelectedPath: entry.path,
      },
    );
  };
  const handleStageAll = () => {
    void runWrite(
      "stage",
      () => transport.request("git.stage", { root, all: true }),
      {
        clearSelectedAreas: ["unstaged", "untracked", "conflict"],
      },
    );
  };
  const handleUnstageEntry = (entry: GitChangeEntry) => {
    const paths = entry.oldPath ? [entry.path, entry.oldPath] : [entry.path];
    void runWrite(
      "stage",
      () => transport.request("git.unstage", { root, paths }),
      {
        clearSelectedAreas: ["staged"],
        clearSelectedPath: entry.path,
      },
    );
  };
  const handleUnstageAll = () => {
    void runWrite(
      "stage",
      () => transport.request("git.unstage", { root, all: true }),
      { clearSelectedAreas: ["staged"] },
    );
  };
  const handleDiscardEntry = (entry: GitChangeEntry) => {
    const untracked = entry.area === "untracked";
    setDiscardRequest({
      target: { label: entry.path, untracked },
      run: async () => {
        await runWrite(
          "discard",
          () =>
            transport.request("git.discard", {
              root,
              paths: [entry.path],
              ...(untracked ? { untracked: true } : {}),
            }),
          {
            clearSelectedAreas: ["unstaged", "untracked"],
            clearSelectedPath: entry.path,
          },
        );
        setDiscardRequest(undefined);
      },
    });
  };
  const handleHunkAction = (
    path: string,
    action: "stage" | "unstage" | "discard",
    hunkIndex: number,
    expectedFingerprint: string,
  ) => {
    if (action === "discard") {
      setDiscardRequest({
        target: { label: path, untracked: false, hunk: true },
        run: async () => {
          await runWrite("discard", () =>
            transport.request("git.applyHunk", {
              root,
              action: "discard",
              path,
              hunkIndex,
              expectedFingerprint,
            }),
          );
          setDiscardRequest(undefined);
        },
      });
      return;
    }
    void runWrite("stage", () =>
      transport.request("git.applyHunk", {
        root,
        action,
        path,
        hunkIndex,
        expectedFingerprint,
      }),
    );
  };
  const handleCommit = (message: string, amend: boolean) =>
    runWrite(
      "commit",
      () =>
        transport.request("git.createCommit", {
          root,
          message,
          ...(amend ? { amend: true } : {}),
        }),
      { clearSelectedAreas: ["staged"] },
    );
  const handleFetch = () => {
    void runWrite("fetch", () => transport.request("git.fetch", { root }));
  };
  const handlePull = () => {
    void runWrite("pull", () => transport.request("git.pull", { root }));
  };
  const handlePush = () => {
    void runWrite("push", () => transport.request("git.push", { root }));
  };
  const listToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(
        "aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-11",
        narrow && "[.mobile-retained-view_&]:hidden",
      )}
      data-iori-action={narrow ? "reading-back" : "toggle-git-list"}
      aria-label={
        narrow
          ? t("Back to list")
          : view.listOpen
            ? t("Hide list")
            : t("Show list")
      }
      aria-pressed={narrow ? undefined : view.listOpen}
      onClick={() => {
        if (!narrow) update({ listOpen: !view.listOpen });
        else if (view.mode === "history" && view.commitFile)
          update({ commitFile: undefined });
        else update({ detailOpen: false });
      }}
    >
      {narrow ? <ArrowLeft /> : <PanelLeft />}
    </Button>
  );

  const changesControls = isRepository ? (
    <div className="flex flex-none flex-col gap-1.5 border-b border-border-subtle px-1.5 py-1.5">
      <div className="flex items-center gap-1">
        <div
          className="inline-flex rounded-md border border-border-subtle bg-muted/40 p-0.5"
          role="group"
          aria-label={t("Changes")}
        >
          <button
            type="button"
            data-iori-action="git-scope-working"
            aria-pressed={scope === "working"}
            className={cn(
              "cursor-pointer rounded-sm px-2 py-0.5 text-2xs font-medium transition-colors [@media(pointer:coarse)]:min-h-8",
              scope === "working"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => update({ scope: "working", change: undefined })}
          >
            {t("Working tree")}
          </button>
          <button
            type="button"
            data-iori-action="git-scope-branch"
            aria-pressed={scope === "branch"}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-sm px-2 py-0.5 text-2xs font-medium transition-colors [@media(pointer:coarse)]:min-h-8",
              scope === "branch"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => update({ scope: "branch", change: undefined })}
          >
            <GitCompareArrows className="size-3" aria-hidden="true" />
            {t("Branch diff")}
          </button>
        </div>
        {viewedPaths.size > 0 && (
          <span
            className="ml-auto text-2xs text-muted-foreground tabular-nums"
            data-iori-part="git-viewed-count"
          >
            {viewedPaths.size}/{activeEntries.length}
          </span>
        )}
      </div>
      {scope === "branch" && (
        <div className="flex items-center gap-1.5">
          <label
            htmlFor={`git-base-${root}`}
            className="shrink-0 text-2xs text-muted-foreground"
          >
            {t("Base branch")}
          </label>
          {branchesState.branches.length > 0 ? (
            <select
              id={`git-base-${root}`}
              data-iori-field="git-base-branch"
              value={effectiveBase ?? ""}
              onChange={(event) =>
                update({ baseBranch: event.target.value, change: undefined })
              }
              className="h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:h-9"
            >
              {branchesState.branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
          ) : (
            <span className="truncate text-2xs text-muted-foreground">
              {t("No other branches to compare.")}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-2 size-3 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={changesFilter}
            onChange={(event) => setChangesFilter(event.target.value)}
            placeholder={t("Filter files…")}
            aria-label={t("Filter files…")}
            data-iori-field="git-changes-filter"
            className="h-6 pr-6 pl-6 text-xs [@media(pointer:coarse)]:h-9"
          />
          {changesFilter && (
            <button
              type="button"
              aria-label={t("Clear the file filter")}
              className="absolute right-1 inline-flex size-4 cursor-pointer items-center justify-center rounded-xs text-muted-foreground hover:text-foreground"
              onClick={() => setChangesFilter("")}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="aria-pressed:bg-accent aria-pressed:text-accent-foreground [@media(pointer:coarse)]:size-9"
          data-iori-action="git-changes-layout"
          aria-pressed={listLayout === "tree"}
          aria-label={
            listLayout === "tree" ? t("View as list") : t("View as tree")
          }
          title={listLayout === "tree" ? t("View as list") : t("View as tree")}
          onClick={() =>
            update({ listLayout: listLayout === "tree" ? "flat" : "tree" })
          }
        >
          {listLayout === "tree" ? <List /> : <FolderTree />}
        </Button>
      </div>
    </div>
  ) : null;

  const changesList = (
    <>
      {changesControls}
      {isRepository && scope === "working" && (
        <div className="flex-none border-b border-border-subtle px-1.5 py-1.5">
          <GitCommitBox
            locale={locale}
            stagedCount={counts?.staged ?? 0}
            hasUpstream={Boolean(repository?.upstream)}
            ahead={repository?.ahead}
            busy={Boolean(writeBusy)}
            onCommit={handleCommit}
          />
        </div>
      )}
      {!counts && !status.error && (
        <ReadingLoading compact label={t("Loading")} rows={5} />
      )}
      {isRepository === false && (
        <ReadingEmpty
          compact
          title={t("There is no Git repository in this folder.")}
        />
      )}
      {isRepository && scope === "branch" && (
        <>
          {!branchesState.loaded ? (
            <ReadingLoading compact label={t("Loading")} rows={5} />
          ) : !effectiveBase && !branchesState.error ? (
            <ReadingEmpty compact title={t("No other branches to compare.")} />
          ) : branchLoading && branchEntries.length === 0 ? (
            <ReadingLoading compact label={t("Loading")} rows={5} />
          ) : branchEntries.length === 0 &&
            !branchError &&
            !branchesState.error ? (
            <ReadingEmpty compact title={t("There are no changes.")} />
          ) : (
            <ChangesTreeList
              entries={branchEntries}
              mode={listLayout}
              filter={changesFilter}
              selectedKey={
                view.change?.branchScope
                  ? `${view.change.area}:${view.change.path}`
                  : undefined
              }
              viewedPaths={viewedPaths}
              locale={locale}
              hostKey={hostKey}
              repositoryRoot={repository?.root ?? root}
              onSelect={(entry) => selectEntry(entry, true)}
              onToggleViewed={toggleViewed}
              onOpenInFiles={
                onOpenFile
                  ? (entry) => openInFiles(entry.path, entry.absolutePath)
                  : undefined
              }
              onFileHistory={(entry) => openHistory(entry.path)}
            />
          )}
        </>
      )}
      {isRepository && scope === "working" && counts && changeRows === 0 && (
        <ReadingEmpty compact title={t("There are no changes.")} />
      )}
      {isRepository &&
        scope === "working" &&
        changeRows > 0 &&
        needsAllWorking && (
          <ChangesTreeList
            entries={workingLoadedEntries}
            mode={listLayout}
            filter={changesFilter}
            selectedKey={
              view.change && !view.change.branchScope
                ? `${view.change.area}:${view.change.path}`
                : undefined
            }
            viewedPaths={viewedPaths}
            locale={locale}
            hostKey={hostKey}
            repositoryRoot={repository?.root ?? root}
            onSelect={(entry) => selectEntry(entry, false)}
            onToggleViewed={toggleViewed}
            onOpenInFiles={
              onOpenFile
                ? (entry) => openInFiles(entry.path, entry.absolutePath)
                : undefined
            }
            onFileHistory={(entry) => openHistory(entry.path)}
            onStageEntry={handleStageEntry}
            onUnstageEntry={handleUnstageEntry}
            onDiscardEntry={handleDiscardEntry}
            writeBusy={Boolean(writeBusy)}
          />
        )}
      {isRepository &&
        scope === "working" &&
        changeRows > 0 &&
        !needsAllWorking && (
          <VirtualRows
            count={changeRows}
            rowHeight={row.height}
            dataId="git-changes"
            className="py-0.5 [&_.reading-virtual-row]:w-full"
            label={t("Changes")}
            onRange={(first, last) => {
              const a = rowAt(first);
              const b = rowAt(last);
              const from =
                a && "index" in a ? a.index : a ? areaStart[a.section]! : 0;
              const to =
                b && "index" in b ? b.index : b ? areaStart[b.section]! : 0;
              status.ensure(from, Math.max(from, to));
            }}
            renderRow={(index) => {
              const shown = rowAt(index);
              if (!shown) return null;
              if ("section" in shown) {
                const closed = view.closed.includes(shown.section);
                return (
                  <div
                    className="group/section flex h-full w-full items-center pr-1.5"
                    data-area={shown.section}
                  >
                    <button
                      type="button"
                      className="git-section-heading flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 border-0 bg-transparent px-2 text-left text-xs font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset [@media(hover:hover)]:hover:text-foreground [&_svg]:size-3"
                      data-area={shown.section}
                      aria-expanded={!closed}
                      onClick={() =>
                        update({
                          closed: closed
                            ? view.closed.filter(
                                (area) => area !== shown.section,
                              )
                            : [...view.closed, shown.section],
                        })
                      }
                    >
                      {closed ? <ChevronRight /> : <ChevronDown />}
                      <span>{areaName(shown.section, ja)}</span>
                      <span className="git-count ml-auto rounded-full bg-muted px-1.5 text-2xs font-medium text-muted-foreground tabular-nums">
                        {shown.count}
                      </span>
                    </button>
                    {shown.section === "staged" && (
                      <button
                        type="button"
                        disabled={Boolean(writeBusy)}
                        aria-label={t("Unstage all changes")}
                        title={t("Unstage all changes")}
                        data-iori-action="git-unstage-all"
                        className="inline-flex size-5 flex-none cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-40 [@media(pointer:coarse)]:size-8 [@media(pointer:coarse)]:opacity-100"
                        onClick={handleUnstageAll}
                      >
                        <Minus className="size-3" aria-hidden="true" />
                      </button>
                    )}
                    {(shown.section === "unstaged" ||
                      shown.section === "untracked") && (
                      <button
                        type="button"
                        disabled={Boolean(writeBusy)}
                        aria-label={t("Stage all changes")}
                        title={t("Stage all changes")}
                        data-iori-action="git-stage-all"
                        data-area={shown.section}
                        className="inline-flex size-5 flex-none cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-40 [@media(pointer:coarse)]:size-8 [@media(pointer:coarse)]:opacity-100"
                        onClick={handleStageAll}
                      >
                        <Plus className="size-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              }
              const entry = status.get(shown.index);
              if (!entry) return <div className="h-full" data-loading="true" />;
              const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
              const active =
                view.mode === "changes" &&
                !view.change?.branchScope &&
                view.change?.area === entry.area &&
                view.change.path === entry.path;
              const isViewed = viewedPaths.has(entry.path);
              const issue = entry.error ? t("Unreadable") : undefined;
              const canStage = entry.area !== "staged";
              const canUnstage = entry.area === "staged";
              const canDiscard =
                entry.area === "unstaged" || entry.area === "untracked";
              return (
                <PathMenu
                  path={entry.absolutePath}
                  relativePath={entry.path}
                  locale={locale}
                  leadingActions={[
                    ...(canStage
                      ? [
                          {
                            label: t("Stage changes"),
                            icon: <Plus aria-hidden="true" />,
                            action: "git-stage-file",
                            disabled: Boolean(writeBusy),
                            run: () => handleStageEntry(entry),
                          },
                        ]
                      : []),
                    ...(canUnstage
                      ? [
                          {
                            label: t("Unstage changes"),
                            icon: <Minus aria-hidden="true" />,
                            action: "git-unstage-file",
                            disabled: Boolean(writeBusy),
                            run: () => handleUnstageEntry(entry),
                          },
                        ]
                      : []),
                    ...(canDiscard
                      ? [
                          {
                            label: t("Discard changes"),
                            icon: <Undo2 aria-hidden="true" />,
                            action: "git-discard-file",
                            disabled: Boolean(writeBusy),
                            destructive: true,
                            run: () => handleDiscardEntry(entry),
                          },
                        ]
                      : []),
                    ...(onOpenFile
                      ? [
                          {
                            label: t("Open in Files"),
                            icon: <FileCode2 aria-hidden="true" />,
                            action: "git-open-in-files",
                            run: () =>
                              openInFiles(entry.path, entry.absolutePath),
                          },
                        ]
                      : []),
                    {
                      label: t("File history"),
                      icon: <History aria-hidden="true" />,
                      action: "git-file-history",
                      run: () => openHistory(entry.path),
                    },
                  ]}
                >
                  <div
                    className={cn(
                      "group/row flex h-full w-full items-center pr-1.5 pl-2 text-xs whitespace-nowrap text-foreground",
                      active &&
                        "group-data-[narrow=false]/split:bg-accent group-data-[narrow=false]/split:text-accent-foreground group-data-[narrow=false]/split:shadow-[inset_2px_0_0_var(--primary)]",
                      !active && "[@media(hover:hover)]:hover:bg-muted/70",
                      isViewed && "opacity-60",
                    )}
                    data-viewed={isViewed ? "true" : undefined}
                  >
                    <Checkbox
                      checked={isViewed}
                      onCheckedChange={() => toggleViewed(entry.path)}
                      aria-label={t("Viewed")}
                      data-iori-action="git-toggle-viewed"
                      data-path={entry.path}
                      className="mr-1.5 size-3.5 shrink-0"
                    />
                    <button
                      type="button"
                      className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent text-left text-xs whitespace-nowrap text-inherit outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
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
                          root: repository?.root ?? root,
                          path: entry.path,
                          absolutePath: entry.absolutePath,
                        })
                      }
                      onClick={() => selectEntry(entry, false)}
                    >
                      <ChangeIcon kind={entry.kind} ja={ja} />
                      <span className="min-w-0 flex-[0_1_auto] truncate">
                        {name}
                      </span>
                      <span className="min-w-0 flex-[0_1000_auto] truncate text-xs text-muted-foreground">
                        {parentDirectory(entry.path)}
                      </span>
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
                    <span className="ml-1 flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
                      {canDiscard && (
                        <button
                          type="button"
                          disabled={Boolean(writeBusy)}
                          aria-label={t("Discard changes")}
                          title={t("Discard changes")}
                          data-iori-action="git-discard-file"
                          data-path={entry.path}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-40 [@media(pointer:coarse)]:size-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDiscardEntry(entry);
                          }}
                        >
                          <Undo2 className="size-3" aria-hidden="true" />
                        </button>
                      )}
                      {canStage && (
                        <button
                          type="button"
                          disabled={Boolean(writeBusy)}
                          aria-label={t("Stage changes")}
                          title={t("Stage changes")}
                          data-iori-action="git-stage-file"
                          data-path={entry.path}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:size-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleStageEntry(entry);
                          }}
                        >
                          <Plus className="size-3" aria-hidden="true" />
                        </button>
                      )}
                      {canUnstage && (
                        <button
                          type="button"
                          disabled={Boolean(writeBusy)}
                          aria-label={t("Unstage changes")}
                          title={t("Unstage changes")}
                          data-iori-action="git-unstage-file"
                          data-path={entry.path}
                          className="inline-flex size-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 [@media(pointer:coarse)]:size-8"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleUnstageEntry(entry);
                          }}
                        >
                          <Minus className="size-3" aria-hidden="true" />
                        </button>
                      )}
                    </span>
                  </div>
                </PathMenu>
              );
            }}
          />
        )}
    </>
  );

  const historyList = (
    <>
      {view.filter && (
        <div
          className="git-filter mx-1.5 my-1 flex flex-none items-center gap-1 rounded-sm border border-border-subtle bg-muted/60 py-0.5 pr-1 pl-2 text-xs [@media(pointer:coarse)]:min-h-10"
          title={view.filter}
        >
          <span className="min-w-0 flex-1 truncate text-foreground">
            {view.filter}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="[@media(pointer:coarse)]:size-10"
            aria-label={t("Clear the file filter")}
            data-iori-action="git-history-clear-filter"
            onClick={() =>
              update({
                filter: undefined,
                commit: undefined,
                commitFile: undefined,
              })
            }
          >
            <X />
          </Button>
        </div>
      )}
      {history.loaded && history.count === 0 ? (
        <ReadingEmpty compact title={t("There is no history.")} />
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {!history.loaded && !history.error && (
            <ReadingLoading
              compact
              label={t("Loading")}
              rows={5}
              className="pointer-events-none absolute inset-x-0 top-0 z-[1]"
            />
          )}
          <VirtualRows
            count={history.count}
            rowHeight={row.height * 2 - 4}
            dataId="git-history"
            className="py-0.5 [&_.reading-virtual-row]:w-full"
            label={t("Commit history")}
            onRange={(first, last) => history.ensure(first, last)}
            renderRow={(index) => {
              const commit = history.get(index);
              if (!commit)
                return <div className="h-full" data-loading="true" />;
              return (
                <button
                  type="button"
                  className="flex h-full w-full cursor-pointer flex-col justify-center border-0 bg-transparent px-2.5 py-1 text-left text-xs text-foreground outline-none group-data-[narrow=false]/split:aria-[current=true]:bg-accent group-data-[narrow=false]/split:aria-[current=true]:text-accent-foreground group-data-[narrow=false]/split:aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset [@media(hover:hover)]:hover:bg-muted/70"
                  aria-current={view.commit === commit.hash || undefined}
                  data-iori-action="git-commit-select"
                  data-hash={commit.hash}
                  onClick={() =>
                    update({
                      commit: commit.hash,
                      commitFile: undefined,
                      parent: undefined,
                      detailOpen: true,
                    })
                  }
                >
                  <span className="truncate font-medium">{commit.subject}</span>
                  <span className="flex gap-2 overflow-hidden text-xs whitespace-nowrap text-muted-foreground">
                    <code className="font-mono text-muted-foreground">
                      {commit.hash.slice(0, 7)}
                    </code>
                    <span className="truncate">
                      {commit.author.replace(/\s*<[^>]*>$/u, "")}
                    </span>
                    <time className="shrink-0">
                      {formatDate(commit.authorTimeMs, locale)}
                    </time>
                  </span>
                </button>
              );
            }}
          />
        </div>
      )}
    </>
  );

  const failure =
    view.mode === "changes"
      ? scope === "branch"
        ? (branchesState.error ?? branchError)
        : status.error
      : history.error;
  const list = (
    <>
      <div
        className="flex h-9 min-w-0 flex-none items-center gap-1 px-1.5 [@media(pointer:coarse)]:h-11"
        data-iori-part="git-list-header"
      >
        <WorktreePicker
          label={repository?.branch ?? label}
          root={root}
          worktrees={worktrees}
          onSelect={onSelectWorktree}
          field="git-worktree"
        />
        {repository && (
          <span
            className="flex-none px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
            title={repository.upstream ?? t("No upstream")}
            data-iori-part="git-branch-state"
          >
            {repository.upstream === undefined
              ? t("no upstream")
              : [
                  repository.ahead === undefined
                    ? undefined
                    : `↑${repository.ahead}`,
                  repository.behind === undefined
                    ? undefined
                    : `↓${repository.behind}`,
                ]
                  .filter(Boolean)
                  .join(" ")}
          </span>
        )}
      </div>
      <Tabs
        value={view.mode}
        onValueChange={(mode) => update({ mode: mode as ViewState["mode"] })}
        className="mt-1 flex-none border-b border-border px-1.5"
      >
        <TabsList
          variant="line"
          className="h-8 border-b-0 [@media(pointer:coarse)]:h-11"
        >
          <TabsTrigger
            value="changes"
            className="px-3 text-xs [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4"
            data-iori-action="git-mode-changes"
          >
            {t("Changes")}
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="px-3 text-xs [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4"
            data-iori-action="git-mode-history"
          >
            {t("History")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {isRepository && (
        <div className="flex-none border-b border-border-subtle px-1.5 py-1.5">
          <GitRemoteBar
            locale={locale}
            ahead={repository?.ahead}
            behind={repository?.behind}
            hasUpstream={Boolean(repository?.upstream)}
            busy={writeBusy}
            error={showsDetail ? undefined : writeError}
            onDismissError={() => setWriteError(undefined)}
            onFetch={handleFetch}
            onPull={handlePull}
            onPush={handlePush}
          />
        </div>
      )}
      {Boolean(failure) && (
        <ReadingError
          retryLabel={t("Retry")}
          action="git-list-retry"
          onRetry={() =>
            view.mode === "changes"
              ? scope === "branch"
                ? setBranchRefresh((value) => value + 1)
                : status.retry()
              : history.retry()
          }
        >
          {readErrorCopy(failure, locale)}
        </ReadingError>
      )}
      {view.mode === "changes" ? changesList : historyList}
    </>
  );

  const change = view.change;
  const conflictStage = change?.area === "conflict" ? view.stage : undefined;
  const changeSource: GitDiffSource | undefined = change
    ? change.branchScope && effectiveBase
      ? {
          kind: "branch",
          base: effectiveBase,
          path: change.path,
          ...(change.oldPath ? { oldPath: change.oldPath } : {}),
          ...(change.area === "untracked" ? { untracked: true } : {}),
        }
      : change.area === "conflict"
        ? { kind: "stage", path: change.path, stage: conflictStage ?? 2 }
        : {
            kind: "change",
            area: change.area,
            path: change.path,
            ...(change.oldPath ? { oldPath: change.oldPath } : {}),
          }
    : undefined;
  const activeComments = change
    ? comments.filter((comment) => comment.path === change.path)
    : [];
  const detail =
    view.mode === "changes" ? (
      change && changeSource ? (
        <DiffViewer
          key={`${change.branchScope ? `branch:${effectiveBase}` : change.area}:${change.path}:${conflictStage ?? ""}`}
          transport={transport}
          onBackHandler={setImageBack}
          active={visible && (!narrow || view.detailOpen)}
          narrow={narrow}
          split={Boolean(view.splitDiff)}
          onSplitChange={(splitDiff) => update({ splitDiff })}
          viewed={viewedPaths.has(change.path)}
          onToggleViewed={() => toggleViewed(change.path)}
          onOpenInFiles={
            onOpenFile && change.kind !== "deleted"
              ? (line) => openInFiles(change.path, change.absolutePath, line)
              : undefined
          }
          onHunkAction={
            !change.branchScope &&
            (change.area === "staged" || change.area === "unstaged")
              ? (action, hunkIndex, fingerprint) =>
                  handleHunkAction(change.path, action, hunkIndex, fingerprint)
              : undefined
          }
          hunkBusy={Boolean(writeBusy)}
          comments={activeComments}
          onAddComment={(draft) =>
            setComments((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                path: change.path,
                absolutePath: change.absolutePath,
                ...draft,
              },
            ])
          }
          onEditComment={(id, body) =>
            setComments((current) =>
              current.map((item) =>
                item.id === id ? { ...item, body } : item,
              ),
            )
          }
          onDeleteComment={(id) =>
            setComments((current) => current.filter((item) => item.id !== id))
          }
          commentJump={
            commentJump && commentJump.path === change.path
              ? {
                  id: commentJump.id,
                  side: commentJump.side,
                  line: commentJump.line,
                }
              : undefined
          }
          root={root}
          source={changeSource}
          absolutePath={change.absolutePath}
          relativePath={change.path}
          refreshKey={diffRefresh}
          position={view.diff}
          onPosition={(diff) => update({ diff })}
          locale={locale}
          lead={listToggle}
          title={
            <PathMenu
              path={change.absolutePath}
              relativePath={change.path}
              locale={locale}
            >
              <span
                className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-foreground"
                data-iori-action="git-detail-path"
                title={change.path}
              >
                <ChangeIcon kind={change.kind} ja={ja} />
                <PathEllipsis
                  path={
                    change.oldPath
                      ? `${change.oldPath} → ${change.path}`
                      : change.path
                  }
                />
                <span
                  className="flex-none text-xs text-muted-foreground"
                  data-iori-part="git-detail-area"
                >
                  {change.branchScope && effectiveBase
                    ? `${t("Branch diff")} (${effectiveBase})`
                    : areaName(change.area, ja)}
                  {change.kind !== "modified" &&
                  change.kind !== "conflict" &&
                  change.kind !== "untracked"
                    ? ` · ${kindName(change.kind, ja)}`
                    : ""}
                </span>
                {change.area === "conflict" && (
                  <span
                    className="flex flex-none gap-0.5"
                    role="group"
                    aria-label={t("Conflict stage")}
                  >
                    {(change.stages ?? []).map((stage) => (
                      <Button
                        key={stage}
                        variant={
                          conflictStage === stage ? "secondary" : "ghost"
                        }
                        size="sm"
                        className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-3"
                        data-iori-action="git-conflict-stage"
                        data-stage={stage}
                        onClick={() =>
                          update({ stage, diff: emptyDiffPosition() })
                        }
                      >
                        {stage === 1
                          ? t("Base")
                          : stage === 2
                            ? t("Ours")
                            : t("Theirs")}
                      </Button>
                    ))}
                  </span>
                )}
              </span>
            </PathMenu>
          }
          notes={
            change.area === "untracked"
              ? [
                  t(
                    "Git does not track this file yet; all of it shows as added.",
                  ),
                ]
              : []
          }
          onFileHistory={() => openHistory(change.path)}
        />
      ) : (
        <>
          <div className="flex h-9 min-w-0 flex-none items-center gap-1 border-b border-border px-1.5 [@media(pointer:coarse)]:h-11">
            {listToggle}
          </div>
          <ReadingEmpty title={t("Select a change to see its diff")} />
        </>
      )
    ) : view.commit && view.commitFile ? (
      <DiffViewer
        key={`${view.commit}:${view.parent ?? ""}:${view.commitFile.path}`}
        transport={transport}
        onBackHandler={setImageBack}
        active={visible && (!narrow || view.detailOpen)}
        narrow={narrow}
        split={Boolean(view.splitDiff)}
        onSplitChange={(splitDiff) => update({ splitDiff })}
        onOpenInFiles={
          onOpenFile && view.commitFile.kind !== "deleted"
            ? (line) =>
                openInFiles(
                  view.commitFile!.path,
                  view.commitFile!.absolutePath,
                  line,
                )
            : undefined
        }
        root={root}
        source={{
          kind: "commit",
          hash: view.commit,
          ...(view.parent ? { parent: view.parent } : {}),
          path: view.commitFile.path,
          ...(view.commitFile.oldPath
            ? { oldPath: view.commitFile.oldPath }
            : {}),
        }}
        absolutePath={view.commitFile.absolutePath}
        relativePath={view.commitFile.path}
        refreshKey={0}
        position={view.diff}
        onPosition={(diff) => update({ diff })}
        locale={locale}
        lead={
          <>
            {!narrow && listToggle}
            <Button
              variant="ghost"
              size="icon-sm"
              className={cn(
                "[@media(pointer:coarse)]:size-11",
                narrow && "[.mobile-retained-view_&]:hidden",
              )}
              data-iori-action={narrow ? "reading-back" : "git-commit-back"}
              aria-label={t("Back to the commit")}
              onClick={() => update({ commitFile: undefined })}
            >
              <ArrowLeft />
            </Button>
          </>
        }
        title={
          <span
            className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-foreground"
            data-iori-action="git-commit-diff-path"
            title={view.commitFile.path}
          >
            <ChangeIcon kind={view.commitFile.kind} ja={ja} />
            <PathEllipsis
              path={
                view.commitFile.oldPath
                  ? `${view.commitFile.oldPath} → ${view.commitFile.path}`
                  : view.commitFile.path
              }
            />
            <code className="shrink-0 font-mono text-xs text-muted-foreground">
              {view.commit.slice(0, 7)}
            </code>
          </span>
        }
        onFileHistory={() => openHistory(view.commitFile!.path)}
      />
    ) : view.commit ? (
      <CommitDetail
        key={view.commit}
        transport={transport}
        root={root}
        repositoryRoot={repository?.root ?? root}
        hostKey={hostKey}
        hash={view.commit}
        refreshKey={commitRefresh}
        parent={view.parent}
        onParent={(parent) => update({ parent })}
        onOpenFile={(commitFile) =>
          update({ commitFile, diff: emptyDiffPosition() })
        }
        locale={locale}
        lead={listToggle}
      />
    ) : (
      <>
        <div className="flex h-9 min-w-0 flex-none items-center gap-1 border-b border-border px-1.5 [@media(pointer:coarse)]:h-11">
          {listToggle}
        </div>
        <ReadingEmpty title={t("Select a commit to see its details")} />
      </>
    );

  const onNarrow = useCallback((value: boolean) => setNarrow(value), []);
  return (
    <div
      className="git-pane flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-sm [&[hidden]]:hidden"
      data-iori-view="git"
      hidden={!visible}
    >
      <div
        ref={row.probe}
        className={LIST_ROW_PROBE_CLASS}
        aria-hidden="true"
      />
      {watchError && (
        <ReadingError
          retryLabel={t("Retry")}
          action="git-watch-retry"
          onRetry={() => setWatchRetry((value) => value + 1)}
        >
          {watchError}
        </ReadingError>
      )}
      {showsDetail && writeError && (
        <div
          role="alert"
          data-iori-part="git-write-error"
          className="mx-2 my-1.5 flex flex-none items-start gap-2 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-2.5 py-1.5 text-xs text-foreground"
        >
          <CircleAlert
            className="mt-0.5 size-3.5 shrink-0 text-status-failed-text"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {writeError}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={ja ? "閉じる" : "Close"}
            data-iori-action="git-write-error-dismiss"
            onClick={() => setWriteError(undefined)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
      {comments.length > 0 && (
        <DiffCommentsBar
          comments={comments}
          locale={locale}
          targets={agentTargets}
          canSend={Boolean(onSendTextToTerminal)}
          onSelectComment={(comment) => {
            const match = activeEntries.find(
              (entry) => entry.path === comment.path,
            );
            if (match) selectEntry(match, scope === "branch");
            setCommentJump((prev) => ({
              id: (prev?.id ?? 0) + 1,
              path: comment.path,
              side: comment.side,
              line: comment.startLine,
            }));
          }}
          onDeleteComment={(id) =>
            setComments((current) => current.filter((item) => item.id !== id))
          }
          onClearAll={() => setComments([])}
          onSendToAgent={(terminalId) => {
            if (!onSendTextToTerminal || comments.length === 0) return;
            if (
              onSendTextToTerminal(
                formatDiffCommentsForAgent(comments),
                terminalId,
              )
            ) {
              setComments([]);
            }
          }}
        />
      )}
      <SplitPane
        list={list}
        detailOpen={view.detailOpen}
        listOpen={view.listOpen}
        onNarrow={onNarrow}
        locale={locale}
        ratio={view.ratio}
        onRatio={changeRatio}
      >
        {detail}
      </SplitPane>
      <GitDiscardDialog
        target={discardRequest?.target}
        locale={locale}
        busy={Boolean(writeBusy)}
        onOpenChange={(open) => {
          if (!open) setDiscardRequest(undefined);
        }}
        onConfirm={async () => {
          await discardRequest?.run();
        }}
      />
    </div>
  );
}
