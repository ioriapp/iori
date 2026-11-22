import { translator } from "../i18n.ts";
import { useNarrowBack } from "../reading/useNarrowBack.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  PanelLeft,
  RotateCw,
  WrapText,
} from "lucide-react";
import {
  forgeCiState,
  type ForgeCi,
  type ForgeCiJob,
  type ForgeCiResult,
  type ForgeCiRun,
  type ForgeCiStatusOf,
  type ForgeReadFailure,
} from "@iori/protocol";
import { AsyncState } from "../components/AsyncState.tsx";
import { Button } from "../components/ui/button";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { forgeMark } from "../forge-status.ts";
import { samePath } from "../host-path.ts";
import { useIsMobile } from "../hooks/use-mobile.ts";
import { cn } from "../lib/utils.ts";
import { SplitPane } from "../reading/SplitPane.tsx";
import { useSavedViewState } from "../reading/savedViewState.ts";
import {
  WorktreePicker,
  type WorktreeChoice,
} from "../reading/WorktreePicker.tsx";
import { CiStateIcon } from "./CiStateIcon.tsx";
import { CiLog } from "./CiLog.tsx";
import { CiFailure } from "./CiFailure.tsx";
import { ForgeNotice } from "./ForgeFailure.tsx";
import { useForgeTokenChange } from "./forge-token-changes.ts";
import { ciDuration, ciStatusLabel } from "./ci-format.ts";

type Selection = { kind: "job" | "result"; id: string };
export type CiViewState = {
  selected?: Selection;
  listOpen: boolean;
  detailOpen: boolean;
  wrap?: boolean;
  stepsOpen?: boolean;
  ratio?: number;
};

// A saved state is read leniently; the shape is iori's own.
function readViewState(value: unknown): CiViewState {
  const saved: Partial<CiViewState> =
    value && typeof value === "object" ? { ...value } : {};
  return {
    ...saved,
    listOpen: saved.listOpen !== false,
    detailOpen: saved.detailOpen === true,
  };
}

/** Failed, else running, else the first: jobs first, then results without jobs. */
function defaultSelection(ci: ForgeCi): Selection | undefined {
  const jobs = ci.runs.flatMap((run) => run.jobs);
  for (const state of ["failed", "running"] as const) {
    const job = jobs.find((item) => forgeCiState(item.status) === state);
    if (job) return { kind: "job", id: job.id };
  }
  if (jobs[0]) return { kind: "job", id: jobs[0].id };
  for (const state of ["failed", "running"] as const) {
    const result = ci.results.find(
      (item) => forgeCiState(item.status) === state,
    );
    if (result) return { kind: "result", id: result.id };
  }
  return ci.results[0] && { kind: "result", id: ci.results[0].id };
}

type Shown =
  | { kind: "job"; job: ForgeCiJob; run: ForgeCiRun }
  | { kind: "result"; result: ForgeCiResult };
function find(ci: ForgeCi, selection?: Selection): Shown | undefined {
  if (!selection) return undefined;
  if (selection.kind === "result") {
    const result = ci.results.find((item) => item.id === selection.id);
    return result && { kind: "result", result };
  }
  for (const run of ci.runs) {
    const job = run.jobs.find((item) => item.id === selection.id);
    if (job) return { kind: "job", job, run };
  }
  return undefined;
}

const NOT_STARTED = new Set(["queued", "waiting", "pending", "blocked"]);

// Names, events and times share the list's line, so it starts as wide as the
// Issues list (forge.md「CIの詳細」).
const LIST_RATIO = 38;
const LIST_MIN_WIDTH = 320;

export type CiPaneProps = {
  hostKey: string;
  /** The worktree whose push target's CI is shown. */
  root: string;
  label: string;
  worktrees?: WorktreeChoice[];
  onSelectWorktree?: (path: string) => void;
  locale?: string;
  visible?: boolean;
  viewState?: unknown;
  onViewState?: (state: CiViewState) => void;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
  /** The sidebar's CI mark asked to show this worktree's CI from its failed job. */
  openRequest?: { id: number };
  onOpenRequestShown?: (id: number) => void;
  /** Recovery from a failed read: the Host's Integrations settings. */
  onOpenIntegrations?: () => void;
  /** Recovery from a failed read: the workspace's Git settings. */
  onOpenWorkspaceSettings?: () => void;
};

/** The CI View of a worktree tab (forge.md「CIの詳細」). */
export function CiPane(props: CiPaneProps) {
  return (
    <CiWorkspace key={JSON.stringify([props.hostKey, props.root])} {...props} />
  );
}

function CiWorkspace({
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
  openRequest,
  onOpenRequestShown,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
}: CiPaneProps) {
  const t = translator(locale);
  const mobile = useIsMobile();
  const [view, setView] = useState(() => readViewState(viewState));
  const update = (value: Partial<CiViewState>) =>
    setView((current) => ({ ...current, ...value }));
  const changeRatio = useSavedViewState(view, onViewState);
  const [narrow, setNarrow] = useState(false);
  const [ci, setCi] = useState<ForgeCi>();
  const [loading, setLoading] = useState(false);
  // A failed read, and why when the Host could tell.
  const [failed, setFailed] = useState<{ forge?: ForgeReadFailure }>();
  const [reads, setReads] = useState(0);
  // The reader's own reads also ask again which Forge the site is.
  const redetect = useRef(false);
  const reread = () => {
    redetect.current = true;
    setReads((value) => value + 1);
  };
  const markAtRead = useRef<string | undefined>(undefined);

  // The mark shows the list with the failed job chosen, once per press.
  const shown = useRef(onOpenRequestShown);
  shown.current = onOpenRequestShown;
  useEffect(() => {
    if (!openRequest) return;
    setView((current) => ({
      ...current,
      selected: undefined,
      detailOpen: false,
    }));
    shown.current?.(openRequest.id);
  }, [openRequest]);

  // Read when shown, when asked, and when the sidebar's CI mark changes.
  // The last content stays while reading and after a failed read. A read no
  // longer wanted stops its stream, and the Host stops it too.
  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    markAtRead.current = JSON.stringify(
      forgeMark(hostKey, root)?.checks ?? null,
    );
    const params = redetect.current
      ? { path: root, redetect: true as const }
      : { path: root };
    redetect.current = false;
    void connection
      .requestHost(hostKey, "forge.ci", params, undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response?.ok) {
          setCi(response.result);
          setFailed(undefined);
        } else
          setFailed({
            forge: response?.ok === false ? response.error.forge : undefined,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [hostKey, root, visible, reads]);
  useEffect(() => {
    if (!visible) return;
    const stop = connection.subscribeHostEvents((host, event) => {
      if (
        host !== hostKey ||
        event.type !== "forge.changed" ||
        !samePath(event.path, root)
      )
        return;
      if (JSON.stringify(event.status.checks ?? null) !== markAtRead.current)
        setReads((value) => value + 1);
    });
    return () => {
      stop();
    };
  }, [hostKey, root, visible]);
  // A token registered, replaced or removed may let a failed read work now.
  useForgeTokenChange(hostKey, visible && Boolean(failed), () =>
    setReads((value) => value + 1),
  );

  const selected = useMemo(
    () =>
      ci
        ? (find(ci, view.selected) ?? find(ci, defaultSelection(ci)))
        : undefined,
    [ci, view.selected],
  );
  // A job's log is read again when its state changes, and while it runs.
  const logRefresh = useMemo(() => {
    if (selected?.kind !== "job") return "";
    const state = forgeCiState(selected.job.status);
    return JSON.stringify([
      selected.job.status,
      state === "running" ? reads : 0,
    ]);
  }, [selected, reads]);

  // On a narrow screen, going back leaves the detail for the list.
  const showsDetail = narrow && view.detailOpen;
  useNarrowBack(onBackHandler, showsDetail, () => {
    setView((value) => ({ ...value, detailOpen: false }));
    return true;
  });

  const now = Date.now();
  const choose = (selection: Selection) =>
    update({ selected: selection, detailOpen: true });
  const isSelected = (selection: Selection) =>
    selected !== undefined &&
    selected.kind === selection.kind &&
    (selected.kind === "job" ? selected.job.id : selected.result.id) ===
      selection.id;
  const openUrl = (url: string | undefined) => {
    if (url) void native.openUrl(url);
  };

  // Without CI, the top shows only the switcher and reloading (forge.md).
  const hasCi = Boolean(ci && (ci.runs.length || ci.results.length));
  const head = (
    <div
      className="flex h-9 shrink-0 min-w-0 items-center gap-2 border-b border-border bg-background px-1.5 [@media(pointer:coarse)]:min-h-11"
      data-iori-part="ci-head"
    >
      <div className="flex min-w-0 max-w-[38%] shrink items-center [&>*]:min-w-0 [&>*]:max-w-full [&>*]:font-normal [&>*]:[@media(pointer:coarse)]:min-h-11 [&>*]:[@media(pointer:coarse)]:min-w-11">
        <WorktreePicker
          label={label}
          root={root}
          worktrees={worktrees}
          onSelect={onSelectWorktree}
          field="ci-worktree"
        />
      </div>
      {hasCi && ci?.commit && (
        <span
          className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden whitespace-nowrap"
          title={`${ci.commit.sha} ${ci.commit.subject ?? ""}`.trim()}
          data-iori-part="ci-commit"
        >
          <code className="shrink-0 font-mono text-xs text-muted-foreground">
            {ci.commit.sha.slice(0, 7)}
          </code>
          {ci.commit.subject && (
            <span className="min-w-0 truncate text-foreground">
              {ci.commit.subject}
            </span>
          )}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="[@media(pointer:coarse)]:size-11"
          aria-label={t("Reload")}
          title={t("Reload")}
          pending={loading}
          data-iori-action="ci-reload"
          onClick={reread}
        >
          <RotateCw />
        </Button>
        {hasCi && ci?.url && (
          <Button
            variant="ghost"
            size="sm"
            className="font-normal text-muted-foreground hover:text-foreground @max-[32.5rem]:size-7 @max-[32.5rem]:px-0 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
            aria-label={t("Open in browser")}
            title={t("Open in browser")}
            data-iori-action="ci-open-browser"
            onClick={() => openUrl(ci.url)}
          >
            <ExternalLink />
            <span className="@max-[32.5rem]:hidden">
              {t("Open in browser")}
            </span>
          </Button>
        )}
      </span>
    </div>
  );
  const failure = failed && (
    <CiFailure
      subject="ci"
      form={ci ? "line" : "notice"}
      className={ci ? "mx-3 my-2" : undefined}
      failure={failed.forge}
      locale={locale}
      recovery={{
        onRetry: reread,
        onOpenIntegrations,
        onOpenWorkspaceSettings,
      }}
    />
  );

  // A row's name keeps its width the longest: its note (an event, a
  // description) shrinks first and goes, then the name; the time stays.
  const ciMeta = (
    item: ForgeCiStatusOf,
    duration?: string,
  ): string | undefined => {
    const parts = [ciStatusLabel(item), duration].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : undefined;
  };
  const row = (
    selection: Selection,
    item: ForgeCiStatusOf,
    name: string,
    note: string | undefined,
    meta: string | undefined,
    nested: boolean,
  ) => (
    <button
      type="button"
      key={`${selection.kind}:${selection.id}`}
      className={cn(
        "relative flex min-h-7 w-full cursor-pointer items-center gap-2 border-0 bg-transparent py-1 pr-3 text-left text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-muted [@media(pointer:coarse)]:min-h-11",
        nested ? "pl-8" : "pl-3",
        !narrow &&
          isSelected(selection) &&
          "bg-primary/14 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      )}
      aria-current={isSelected(selection) || undefined}
      data-iori-action={`ci-select-${selection.kind}`}
      data-iori-ci-id={selection.id}
      data-iori-ci-status={item.status}
      title={name}
      onClick={() => choose(selection)}
    >
      <CiStateIcon state={forgeCiState(item.status)} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {note && (
        <span className="min-w-0 shrink-[1000] truncate text-xs font-normal text-muted-foreground">
          {note}
          {meta ? " ·" : ""}
        </span>
      )}
      {meta && (
        <span className="ml-auto max-w-[55%] shrink-0 truncate pl-2 text-xs font-normal text-muted-foreground">
          {meta}
        </span>
      )}
      {narrow && (
        <ChevronRight
          size={14}
          className="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      )}
    </button>
  );
  const list = ci && (
    <div
      className="min-h-0 flex-1 overflow-auto bg-background py-2"
      data-iori-part="ci-list"
    >
      {ci.runs.map((run) => {
        const runMeta = ciMeta(run, ciDuration(run, now));
        return (
          <div
            className="not-first:mt-2 not-first:border-t not-first:border-border-subtle not-first:pt-2"
            key={run.id}
            data-iori-ci-run={run.id}
          >
            <div
              className="flex min-h-7 items-center gap-2 px-3 py-1 font-semibold text-foreground [@media(pointer:coarse)]:min-h-11"
              title={run.name}
            >
              <CiStateIcon state={forgeCiState(run.status)} />
              <span className="min-w-0 flex-1 truncate">{run.name}</span>
              {run.event && (
                <span className="min-w-0 shrink-[1000] truncate text-xs font-normal text-muted-foreground">
                  {run.event}
                  {runMeta ? " ·" : ""}
                </span>
              )}
              {runMeta && (
                <span className="ml-auto max-w-[55%] shrink-0 truncate text-xs font-normal text-muted-foreground">
                  {runMeta}
                </span>
              )}
            </div>
            {run.jobs.map((job) =>
              row(
                { kind: "job", id: job.id },
                job,
                job.name,
                undefined,
                ciMeta(job, ciDuration(job, now)),
                true,
              ),
            )}
          </div>
        );
      })}
      {ci.results.length > 0 && (
        <div className="not-first:mt-2 not-first:border-t not-first:border-border-subtle not-first:pt-2">
          {ci.runs.length > 0 && (
            <div className="flex min-h-7 items-center px-3 py-1 text-xs font-medium text-muted-foreground [@media(pointer:coarse)]:min-h-11">
              {t("Other results")}
            </div>
          )}
          {ci.results.map((result) =>
            row(
              { kind: "result", id: result.id },
              result,
              result.name,
              result.description,
              ciMeta(result),
              ci.runs.length > 0,
            ),
          )}
        </div>
      )}
    </div>
  );

  const listToggle = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="[@media(pointer:coarse)]:size-11"
      data-iori-action={narrow ? "ci-back" : "toggle-ci-list"}
      aria-label={
        narrow
          ? t("Back to list")
          : view.listOpen
            ? t("Hide list")
            : t("Show list")
      }
      aria-pressed={narrow ? undefined : view.listOpen}
      onClick={() =>
        narrow
          ? update({ detailOpen: false })
          : update({ listOpen: !view.listOpen })
      }
    >
      {narrow ? <ArrowLeft /> : <PanelLeft />}
    </Button>
  );
  const shownStatus =
    selected?.kind === "job" ? selected.job : selected?.result;
  const status = shownStatus?.status;
  const detail = ci && selected && status && (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      data-iori-part="ci-detail"
      data-iori-ci-selected={
        selected.kind === "job" ? selected.job.id : selected.result.id
      }
    >
      <div
        className={cn(
          "flex min-h-11 shrink-0 items-center gap-2 border-b border-border bg-background px-2 py-1.5",
          narrow && "[@media(pointer:coarse)]:px-1",
        )}
      >
        {listToggle}
        {/* A long name keeps its line; the state moves under it. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="flex min-w-0 max-w-full items-center gap-2">
            <CiStateIcon state={forgeCiState(status)} size={16} />
            <span className="min-w-0 truncate font-semibold text-foreground">
              {selected.kind === "job"
                ? selected.job.name
                : selected.result.name}
            </span>
          </span>
          <span className="max-w-full shrink-0 truncate text-xs font-normal text-muted-foreground">
            {[
              shownStatus && ciStatusLabel(shownStatus),
              selected.kind === "job"
                ? ciDuration(selected.job, now)
                : selected.result.description,
              selected.kind === "job" ? selected.run.name : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {mobile && selected.kind === "job" && ci.logs && (
          <Button
            variant={view.wrap ? "secondary" : "ghost"}
            size="icon-sm"
            className="[@media(pointer:coarse)]:size-11"
            aria-pressed={view.wrap === true}
            aria-label={t("Wrap long lines")}
            title={t("Wrap long lines")}
            data-iori-action="ci-log-wrap"
            onClick={() => update({ wrap: !view.wrap })}
          >
            <WrapText />
          </Button>
        )}
        {selected.kind === "job" && selected.job.url && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="[@media(pointer:coarse)]:size-11"
            aria-label={t("Open this job in browser")}
            title={t("Open this job in browser")}
            data-iori-action="ci-job-open-browser"
            onClick={() => openUrl(selected.job.url)}
          >
            <ExternalLink />
          </Button>
        )}
      </div>
      {selected.kind === "job" && ci.logs ? (
        forgeCiState(selected.job.status) === "skipped" ? (
          <ForgeNotice>
            <p>{t("This job did not run.")}</p>
          </ForgeNotice>
        ) : NOT_STARTED.has(selected.job.status) ? (
          <ForgeNotice>
            <p>{t("This job has not started yet.")}</p>
          </ForgeNotice>
        ) : (
          <CiLog
            key={selected.job.id}
            hostKey={hostKey}
            root={root}
            job={selected.job}
            wrap={mobile && view.wrap === true}
            refresh={logRefresh}
            stepsOpen={view.stepsOpen !== false}
            onStepsOpen={(stepsOpen) => update({ stepsOpen })}
            locale={locale}
            recovery={{ onOpenIntegrations, onOpenWorkspaceSettings }}
          />
        )
      ) : (
        <ForgeNotice data-iori-state="ci-browser-only">
          <Button
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-11"
            data-iori-action="ci-detail-open-browser"
            onClick={() =>
              openUrl(
                (selected.kind === "job"
                  ? selected.job.url
                  : selected.result.url) ?? ci.commit?.url,
              )
            }
          >
            <ExternalLink />
            {t("Open in browser")}
          </Button>
        </ForgeNotice>
      )}
    </div>
  );

  const onNarrow = useCallback((value: boolean) => setNarrow(value), []);
  const empty =
    ci && !ci.commit ? (
      <ForgeNotice data-iori-state="ci-no-target">
        <p>
          {t(
            "This branch has no push destination. Push it to see its commit's CI.",
          )}
        </p>
      </ForgeNotice>
    ) : ci && ci.runs.length === 0 && ci.results.length === 0 ? (
      <ForgeNotice data-iori-state="ci-none">
        <p>{t("There is no CI for this commit.")}</p>
      </ForgeNotice>
    ) : undefined;
  return (
    <div
      className={cn(
        "@container h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background text-sm",
        visible ? "flex" : "hidden",
      )}
      data-iori-view="ci"
      data-iori-ci-path={root}
      data-iori-state={ci ? "loaded" : failed ? "failed" : "reading"}
      hidden={!visible}
    >
      {!showsDetail && head}
      {failure}
      {empty ??
        (ci ? (
          <SplitPane
            list={list}
            detailOpen={view.detailOpen}
            listOpen={view.listOpen}
            onNarrow={onNarrow}
            locale={locale}
            ratio={view.ratio ?? LIST_RATIO}
            minListWidth={LIST_MIN_WIDTH}
            onRatio={changeRatio}
          >
            {detail}
          </SplitPane>
        ) : !failed ? (
          <AsyncState
            mode="loading"
            compact
            t={t}
            emptyTitle=""
            errorTitle=""
            className="border-t-0"
          >
            {null}
          </AsyncState>
        ) : null)}
    </div>
  );
}
