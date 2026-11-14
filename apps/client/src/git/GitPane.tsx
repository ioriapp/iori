import { translator } from "../i18n.ts";
import { useNarrowBack } from "../reading/useNarrowBack.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import "./git.css";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  PanelLeft,
  X,
} from "lucide-react";
import type {
  GitChangeArea,
  GitChangeEntry,
  GitCommitFile,
  GitHistoryEntry,
  GitRepositoryStatus,
  ReadResultByMethod,
} from "@iori/protocol";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { SplitPane } from "../reading/SplitPane.tsx";
import { useSavedViewState } from "../reading/savedViewState.ts";
import {
  WorktreePicker,
  type WorktreeChoice,
} from "../reading/WorktreePicker.tsx";
import { VirtualRows } from "../reading/VirtualRows.tsx";
import { PathMenu } from "../reading/PathMenu.tsx";
import { writePathDrag } from "../path-drag.ts";
import { usePagedList } from "../reading/paged.ts";
import { readErrorCopy, type ReadingTransport } from "../reading/transport.ts";
import { formatDate } from "../reading/format.ts";
import { useRowHeight } from "../reading/rowHeight.ts";
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
};

type Selected = Pick<
  GitChangeEntry,
  "area" | "path" | "oldPath" | "kind" | "stages" | "absolutePath"
>;
export type GitViewState = {
  mode: "changes" | "history";
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

  // The first page tells how many changes each section has.
  useEffect(() => {
    if (visible && !counts) status.ensure(0, 0);
  }, [status, visible, counts]);

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

  const openHistory = (path: string) =>
    update({
      mode: "history",
      filter: path,
      commit: undefined,
      commitFile: undefined,
      detailOpen: false,
    });
  const listToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className={narrow ? "reading-back" : undefined}
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

  const changesList = (
    <>
      {isRepository === false && (
        <p className="reading-empty">
          {t("There is no Git repository in this folder.")}
        </p>
      )}
      {isRepository && counts && changeRows === 0 && (
        <p className="reading-empty">{t("There are no changes.")}</p>
      )}
      <VirtualRows
        count={changeRows}
        rowHeight={row.height}
        dataId="git-changes"
        className="git-list-rows"
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
              <button
                type="button"
                className="git-section-heading"
                data-area={shown.section}
                aria-expanded={!closed}
                onClick={() =>
                  update({
                    closed: closed
                      ? view.closed.filter((area) => area !== shown.section)
                      : [...view.closed, shown.section],
                  })
                }
              >
                {closed ? <ChevronRight /> : <ChevronDown />}
                <span>{areaName(shown.section, ja)}</span>
                <span className="git-count">{shown.count}</span>
              </button>
            );
          }
          const entry = status.get(shown.index);
          if (!entry) return <div className="git-row" data-loading="true" />;
          const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
          const active =
            view.mode === "changes" &&
            view.change?.area === entry.area &&
            view.change.path === entry.path;
          const issue = entry.error ? t("Unreadable") : undefined;
          return (
            <PathMenu path={entry.absolutePath} locale={locale}>
              <button
                type="button"
                className="git-row"
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
                onClick={() =>
                  update({
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
                  })
                }
              >
                <ChangeIcon kind={entry.kind} ja={ja} />
                <span className="git-row-name">{name}</span>
                <span className="git-row-directory">
                  {parentDirectory(entry.path)}
                </span>
                {issue && <span className="git-row-issue">{issue}</span>}
                {(entry.addedLines !== undefined ||
                  entry.removedLines !== undefined) && (
                  <span className="git-row-counts">
                    {entry.addedLines ? (
                      <span className="git-added">+{entry.addedLines}</span>
                    ) : null}
                    {entry.removedLines ? (
                      <span className="git-removed">−{entry.removedLines}</span>
                    ) : null}
                  </span>
                )}
              </button>
            </PathMenu>
          );
        }}
      />
    </>
  );

  const historyList = (
    <>
      {view.filter && (
        <div className="git-filter" title={view.filter}>
          <span className="reading-truncate">{view.filter}</span>
          <Button
            variant="ghost"
            size="icon-xs"
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
      {history.loaded && history.count === 0 && (
        <p className="reading-empty">{t("There is no history.")}</p>
      )}
      <VirtualRows
        count={history.count}
        rowHeight={row.height * 2 - 4}
        dataId="git-history"
        className="git-list-rows"
        label={t("Commit history")}
        onRange={(first, last) => history.ensure(first, last)}
        renderRow={(index) => {
          const commit = history.get(index);
          if (!commit)
            return <div className="git-commit-row" data-loading="true" />;
          return (
            <button
              type="button"
              className="git-commit-row"
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
              <span className="git-commit-subject">{commit.subject}</span>
              <span className="git-commit-line">
                <code>{commit.hash.slice(0, 7)}</code>
                <span>{commit.author.replace(/\s*<[^>]*>$/u, "")}</span>
                <time>{formatDate(commit.authorTimeMs, locale)}</time>
              </span>
            </button>
          );
        }}
      />
    </>
  );

  const failure = view.mode === "changes" ? status.error : history.error;
  const list = (
    <>
      <div
        className="reading-header reading-list-header"
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
            className="git-branch-state"
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
        className="git-mode"
      >
        <TabsList variant="line">
          <TabsTrigger value="changes" data-iori-action="git-mode-changes">
            {t("Changes")}
          </TabsTrigger>
          <TabsTrigger value="history" data-iori-action="git-mode-history">
            {t("History")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {Boolean(failure) && (
        <ReadingError
          retryLabel={t("Retry")}
          action="git-list-retry"
          onRetry={() =>
            view.mode === "changes" ? status.retry() : history.retry()
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
  const detail =
    view.mode === "changes" ? (
      change ? (
        <DiffViewer
          key={`${change.area}:${change.path}:${conflictStage ?? ""}`}
          transport={transport}
          onBackHandler={setImageBack}
          active={visible && (!narrow || view.detailOpen)}
          root={root}
          source={
            change.area === "conflict"
              ? { kind: "stage", path: change.path, stage: conflictStage ?? 2 }
              : {
                  kind: "change",
                  area: change.area,
                  path: change.path,
                  ...(change.oldPath ? { oldPath: change.oldPath } : {}),
                }
          }
          absolutePath={change.absolutePath}
          refreshKey={diffRefresh}
          position={view.diff}
          onPosition={(diff) => update({ diff })}
          locale={locale}
          lead={listToggle}
          title={
            <PathMenu path={change.absolutePath} locale={locale}>
              <span
                className="git-detail-title"
                data-iori-action="git-detail-path"
                title={change.path}
              >
                <ChangeIcon kind={change.kind} ja={ja} />
                <span className="reading-truncate">
                  {change.oldPath
                    ? `${change.oldPath} → ${change.path}`
                    : change.path}
                </span>
                <span
                  className="git-detail-kind"
                  data-iori-part="git-detail-area"
                >
                  {areaName(change.area, ja)}
                  {change.kind !== "modified" &&
                  change.kind !== "conflict" &&
                  change.kind !== "untracked"
                    ? ` · ${kindName(change.kind, ja)}`
                    : ""}
                </span>
                {change.area === "conflict" && (
                  <span
                    className="git-stage-switch"
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
          <div className="reading-header">{listToggle}</div>
          <p className="reading-empty">
            {t("Select a change to see its diff")}
          </p>
        </>
      )
    ) : view.commit && view.commitFile ? (
      <DiffViewer
        key={`${view.commit}:${view.parent ?? ""}:${view.commitFile.path}`}
        transport={transport}
        onBackHandler={setImageBack}
        active={visible && (!narrow || view.detailOpen)}
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
            className="git-detail-title"
            data-iori-action="git-commit-diff-path"
            title={view.commitFile.path}
          >
            <ChangeIcon kind={view.commitFile.kind} ja={ja} />
            <span className="reading-truncate">
              {view.commitFile.oldPath
                ? `${view.commitFile.oldPath} → ${view.commitFile.path}`
                : view.commitFile.path}
            </span>
            <code className="git-hash">{view.commit.slice(0, 7)}</code>
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
        <div className="reading-header">{listToggle}</div>
        <p className="reading-empty">
          {t("Select a commit to see its details")}
        </p>
      </>
    );

  const onNarrow = useCallback((value: boolean) => setNarrow(value), []);
  return (
    <div className="git-pane" data-iori-view="git" hidden={!visible}>
      <div ref={row.probe} className="reading-row-probe" aria-hidden="true" />
      {watchError && (
        <ReadingError
          retryLabel={t("Retry")}
          action="git-watch-retry"
          onRetry={() => setWatchRetry((value) => value + 1)}
        >
          {watchError}
        </ReadingError>
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
    </div>
  );
}
