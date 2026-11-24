import { translator } from "../i18n.ts";
import { useNarrowBack } from "../reading/useNarrowBack.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  PanelLeft,
  RotateCcw,
  RotateCw,
  Search,
  Square,
  WrapText,
} from "lucide-react";
import {
  forgeCiState,
  type ForgeCi,
  type ForgeCiJob,
  type ForgeCiResult,
  type ForgeCiRun,
  type ForgeCiState,
  type ForgeCiStatusOf,
  type ForgePrView,
  type ForgeReadFailure,
} from "@iori/protocol";
import { AsyncState } from "../components/AsyncState.tsx";
import { Button } from "../components/ui/button";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { forgeMark } from "../forge-status.ts";
import { samePath } from "../host-path.ts";
import { cn } from "../lib/utils.ts";
import type { OpenFile } from "../workspace-panel.tsx";
import { SplitPane } from "../reading/SplitPane.tsx";
import { useSavedViewState } from "../reading/savedViewState.ts";
import {
  WorktreePicker,
  type WorktreeChoice,
} from "../reading/WorktreePicker.tsx";
import { CiStateIcon } from "./CiStateIcon.tsx";
import { CiLog } from "./CiLog.tsx";
import { CiFailure } from "./CiFailure.tsx";
import { CiCancelDialog } from "./CiCancelDialog.tsx";
import { AgentTargetPicker, type AgentTarget } from "./AgentTargetPicker.tsx";
import { formatCiFailureForAgent } from "./ci-log.ts";
import { PrPane } from "./PrPane.tsx";
import { ForgeNotice } from "./ForgeFailure.tsx";
import { useForgeTokenChange } from "./forge-token-changes.ts";
import { ciDuration, ciStatusLabel } from "./ci-format.ts";

type Selection = { kind: "job" | "result"; id: string };
export type CiSection = "pr" | "ci";
export type CiViewState = {
  section?: CiSection;
  selected?: Selection;
  listOpen: boolean;
  detailOpen: boolean;
  wrap?: boolean;
  stepsOpen?: boolean;
  stepsHeight?: number;
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
  /** The sidebar's PR or CI mark asked to open that section of this worktree. */
  openRequest?: { id: number; section?: CiSection };
  onOpenRequestShown?: (id: number) => void;
  /** Recovery from a failed read: the Host's Integrations settings. */
  onOpenIntegrations?: () => void;
  /** Recovery from a failed read: the workspace's Git settings. */
  onOpenWorkspaceSettings?: () => void;
  /** Opens a workspace-relative `file:line` from CI logs in Files View. */
  onOpenFile?: (file: OpenFile, standalone?: boolean) => void;
  /** Opens a PR changed file in Git View's branch diff. */
  onOpenDiff?: (path: string, baseBranch?: string) => void;
  /** Eligible non-child Agent/Terminal destinations for "Send failure to Agent". */
  agentTargets?: AgentTarget[];
  /** Inserts formatted CI failure details or PR comments into an eligible Agent/Terminal without Enter. */
  onSendTextToTerminal?: (text: string, terminalId?: string) => boolean;
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
  onOpenFile,
  onOpenDiff,
  agentTargets = [],
  onSendTextToTerminal,
}: CiPaneProps) {
  const t = translator(locale);
  const [view, setView] = useState(() => readViewState(viewState));
  const activeSection: CiSection = view.section === "pr" ? "pr" : "ci";
  const update = (value: Partial<CiViewState>) =>
    setView((current) => ({ ...current, ...value }));
  const changeRatio = useSavedViewState(view, onViewState);
  const [narrow, setNarrow] = useState(false);
  const [ci, setCi] = useState<ForgeCi>();
  const [loading, setLoading] = useState(false);
  // A failed read, and why when the Host could tell.
  const [failed, setFailed] = useState<{ forge?: ForgeReadFailure }>();
  const [reads, setReads] = useState(0);
  const [prView, setPrView] = useState<ForgePrView>();
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<{
    forge?: ForgeReadFailure;
    message?: string;
  }>();
  const [prReads, setPrReads] = useState(0);
  const [findRequest, setFindRequest] = useState(0);
  const [failureContext, setFailureContext] = useState<{
    failedStepName?: string;
    errorExcerpt: string;
  }>();
  const [actionBusy, setActionBusy] = useState<{
    runId: string;
    kind: "rerun-failed" | "rerun-all" | "cancel";
  }>();
  const [actionFailed, setActionFailed] = useState<{
    forge?: ForgeReadFailure;
  }>();
  const [cancelTarget, setCancelTarget] = useState<{
    runId: string;
    runName: string;
  }>();
  // The reader's own reads also ask again which Forge the site is.
  const redetect = useRef(false);
  const prRedetect = useRef(false);
  const reread = () => {
    redetect.current = true;
    prRedetect.current = true;
    setReads((value) => value + 1);
    setPrReads((value) => value + 1);
  };
  const markAtRead = useRef<string | undefined>(undefined);
  const prMarkAtRead = useRef<string | undefined>(undefined);

  // The mark opens the requested section (PR or CI with failed job chosen), once per press.
  const shown = useRef(onOpenRequestShown);
  shown.current = onOpenRequestShown;
  useEffect(() => {
    if (!openRequest) return;
    const requestedSection: CiSection =
      openRequest.section === "pr" ? "pr" : "ci";
    setView((current) => ({
      ...current,
      section: requestedSection,
      ...(requestedSection === "ci"
        ? { selected: undefined, detailOpen: false }
        : {}),
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
    if (!visible || activeSection !== "pr") return;
    const controller = new AbortController();
    setPrLoading(true);
    prMarkAtRead.current = JSON.stringify(
      forgeMark(hostKey, root)?.pullRequest ?? null,
    );
    const params = prRedetect.current
      ? { path: root, redetect: true as const }
      : { path: root };
    prRedetect.current = false;
    void connection
      .requestHost(hostKey, "forge.pr", params, undefined, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response?.ok) {
          setPrView(response.result);
          setPrError(undefined);
        } else {
          setPrError({
            forge: response?.ok === false ? response.error.forge : undefined,
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPrError({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setPrLoading(false);
      });
    return () => controller.abort();
  }, [hostKey, root, visible, activeSection, prReads]);
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
      if (
        JSON.stringify(event.status.pullRequest ?? null) !==
        prMarkAtRead.current
      )
        setPrReads((value) => value + 1);
    });
    return () => {
      stop();
    };
  }, [hostKey, root, visible]);
  // A token registered, replaced or removed may let a failed read work now.
  useForgeTokenChange(hostKey, visible && Boolean(failed || prError), () => {
    setReads((value) => value + 1);
    setPrReads((value) => value + 1);
  });

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

  // On a narrow screen, going back leaves the detail for the list (in CI section).
  const showsDetail = activeSection === "ci" && narrow && view.detailOpen;
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
  const openLogFile = useCallback(
    (relativePath: string, line?: number, column?: number) => {
      if (!onOpenFile) return;
      const base = root.replace(/[\\/]+$/u, "");
      const sep = root.includes("\\") ? "\\" : "/";
      const normalized = relativePath.replace(/^\/+/u, "");
      const absolutePath = `${base}${sep}${sep === "\\" ? normalized.replaceAll("/", "\\") : normalized}`;
      onOpenFile({
        absolutePath,
        root,
        path: normalized,
        displayPath: normalized,
        ...(line !== undefined ? { line } : {}),
        ...(column !== undefined ? { column } : {}),
      });
    },
    [onOpenFile, root],
  );
  const rerunWorkflow = async (runId: string, failedOnly: boolean) => {
    if (actionBusy) return;
    setActionBusy({
      runId,
      kind: failedOnly ? "rerun-failed" : "rerun-all",
    });
    setActionFailed(undefined);
    try {
      const response = await connection.requestHost(hostKey, "forge.ci.rerun", {
        path: root,
        run: runId,
        ...(failedOnly ? { failedOnly: true } : {}),
      });
      if (response?.ok) {
        setReads((value) => value + 1);
      } else {
        setActionFailed({
          forge: response?.ok === false ? response.error.forge : undefined,
        });
      }
    } catch {
      setActionFailed({});
    } finally {
      setActionBusy(undefined);
    }
  };
  const cancelWorkflow = async (runId: string) => {
    if (actionBusy) return;
    setActionBusy({ runId, kind: "cancel" });
    setActionFailed(undefined);
    try {
      const response = await connection.requestHost(
        hostKey,
        "forge.ci.cancel",
        { path: root, run: runId },
      );
      if (response?.ok) {
        setReads((value) => value + 1);
      } else {
        setActionFailed({
          forge: response?.ok === false ? response.error.forge : undefined,
        });
      }
    } catch {
      setActionFailed({});
    } finally {
      setActionBusy(undefined);
      setCancelTarget(undefined);
    }
  };

  const createPr = async (input: {
    title: string;
    body: string;
    base?: string;
    draft: boolean;
    issue?: number;
  }): Promise<
    | { ok: true; url: string; created: boolean }
    | { ok: false; message?: string; forge?: ForgeReadFailure }
  > => {
    try {
      const response = await connection.requestHost(
        hostKey,
        "forge.pr.create",
        {
          path: root,
          title: input.title,
          body: input.body,
          ...(input.base ? { base: input.base } : {}),
          draft: input.draft,
          ...(input.issue !== undefined ? { issue: input.issue } : {}),
        },
      );
      if (response?.ok) {
        setPrReads((value) => value + 1);
        setReads((value) => value + 1);
        return {
          ok: true,
          url: response.result.url,
          created: response.result.created,
        };
      }
      return {
        ok: false,
        message: response?.ok === false ? response.error.message : undefined,
        forge: response?.ok === false ? response.error.forge : undefined,
      };
    } catch {
      return { ok: false };
    }
  };

  // Without CI, the top shows only the switcher and reloading (forge.md).
  const hasCi = Boolean(ci && (ci.runs.length || ci.results.length));
  const ciSummary = useMemo<
    { state: ForgeCiState; label: string } | undefined
  >(() => {
    const ja = locale.startsWith("ja");
    if (ci && (ci.runs.length > 0 || ci.results.length > 0)) {
      const items: ForgeCiStatusOf[] = [
        ...ci.runs.flatMap((run) => (run.jobs.length > 0 ? run.jobs : [run])),
        ...ci.results,
      ];
      let failedCount = 0;
      let runningCount = 0;
      let passedCount = 0;
      for (const item of items) {
        const state = forgeCiState(item.status);
        if (state === "failed") failedCount += 1;
        else if (state === "running") runningCount += 1;
        else if (state === "passed") passedCount += 1;
      }
      const total = items.length;
      if (failedCount > 0) {
        return {
          state: "failed",
          label: ja
            ? `CI失敗（${failedCount}/${total}）`
            : `CI failed (${failedCount}/${total})`,
        };
      }
      if (runningCount > 0) {
        return {
          state: "running",
          label: ja
            ? `CI実行中（${runningCount}/${total}）`
            : `CI running (${runningCount}/${total})`,
        };
      }
      if (passedCount > 0) {
        return {
          state: "passed",
          label: ja
            ? `CI通過（${passedCount}/${total}）`
            : `CI passed (${passedCount}/${total})`,
        };
      }
      return {
        state: "other",
        label: ja ? `CI（${total}件）` : `CI (${total})`,
      };
    }
    const checks = forgeMark(hostKey, root)?.checks;
    if (!checks) return undefined;
    const labelText =
      checks.state === "other"
        ? checks.word
          ? `CI: ${checks.word}`
          : "CI"
        : t(`CI ${checks.state}`);
    return { state: checks.state, label: labelText };
  }, [ci, hostKey, root, locale, t]);
  const prNumber =
    prView?.pr?.number ?? forgeMark(hostKey, root)?.pullRequest?.number;
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
      <div
        role="tablist"
        aria-label="PR / CI"
        className="flex shrink-0 items-center rounded-md border border-border-subtle bg-muted/40 p-0.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "pr"}
          data-iori-action="ci-section-pr"
          className={cn(
            "cursor-pointer rounded-sm px-2 py-0.5 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:px-3",
            activeSection === "pr"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => update({ section: "pr" })}
        >
          {prNumber !== undefined ? `PR #${prNumber}` : "PR"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "ci"}
          data-iori-action="ci-section-ci"
          className={cn(
            "cursor-pointer rounded-sm px-2 py-0.5 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-8 [@media(pointer:coarse)]:px-3",
            activeSection === "ci"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => update({ section: "ci" })}
        >
          CI
        </button>
      </div>
      {activeSection === "ci" && hasCi && ci?.commit && (
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
          pending={activeSection === "pr" ? prLoading : loading}
          data-iori-action="ci-reload"
          onClick={reread}
        >
          <RotateCw />
        </Button>
        {activeSection === "ci" && hasCi && ci?.url && (
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
  const failure = (failed || actionFailed) && (
    <CiFailure
      subject="ci"
      form={ci ? "line" : "notice"}
      className={ci ? "mx-3 my-2" : undefined}
      failure={(actionFailed ?? failed)?.forge}
      locale={locale}
      recovery={{
        onRetry: () => {
          setActionFailed(undefined);
          reread();
        },
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
        const runState = forgeCiState(run.status);
        const canRerunRun = Boolean(ci.canRerun) && runState !== "running";
        const canCancelRun = Boolean(ci.canCancel) && runState === "running";
        return (
          <div
            className="not-first:mt-2 not-first:border-t not-first:border-border-subtle not-first:pt-2"
            key={run.id}
            data-iori-ci-run={run.id}
          >
            <div
              className="flex min-h-7 items-center gap-1.5 px-3 py-1 font-semibold text-foreground [@media(pointer:coarse)]:min-h-11"
              title={run.name}
            >
              <CiStateIcon state={runState} />
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
              {canRerunRun && runState === "failed" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={Boolean(actionBusy)}
                  pending={
                    actionBusy?.runId === run.id &&
                    actionBusy.kind === "rerun-failed"
                  }
                  aria-label={t("Rerun failed jobs")}
                  title={t("Rerun failed jobs")}
                  data-iori-action="ci-rerun-failed"
                  data-run-id={run.id}
                  className="shrink-0 [@media(pointer:coarse)]:size-9"
                  onClick={() => void rerunWorkflow(run.id, true)}
                >
                  <RotateCcw />
                </Button>
              )}
              {canRerunRun && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={Boolean(actionBusy)}
                  pending={
                    actionBusy?.runId === run.id &&
                    actionBusy.kind === "rerun-all"
                  }
                  aria-label={t("Rerun all")}
                  title={t("Rerun all")}
                  data-iori-action="ci-rerun-all"
                  data-run-id={run.id}
                  className="shrink-0 [@media(pointer:coarse)]:size-9"
                  onClick={() => void rerunWorkflow(run.id, false)}
                >
                  <RotateCw />
                </Button>
              )}
              {canCancelRun && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={Boolean(actionBusy)}
                  pending={
                    actionBusy?.runId === run.id && actionBusy.kind === "cancel"
                  }
                  aria-label={t("Cancel workflow")}
                  title={t("Cancel workflow")}
                  data-iori-action="ci-cancel-run"
                  data-run-id={run.id}
                  className="shrink-0 text-destructive hover:text-destructive [@media(pointer:coarse)]:size-9"
                  onClick={() =>
                    setCancelTarget({ runId: run.id, runName: run.name })
                  }
                >
                  <Square />
                </Button>
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
        {selected.kind === "job" &&
          forgeCiState(selected.job.status) === "failed" && (
            <AgentTargetPicker
              targets={onSendTextToTerminal ? agentTargets : []}
              locale={locale}
              label={t("Send failure to Agent")}
              actionId="ci-send-failure-to-agent"
              size="xs"
              variant="outline"
              className="shrink-0 [@media(pointer:coarse)]:min-h-11"
              onSend={(terminalId) => {
                if (!onSendTextToTerminal) return;
                const message = formatCiFailureForAgent({
                  jobName: selected.job.name,
                  runName: selected.run.name,
                  jobId: selected.job.id,
                  failedStepName: failureContext?.failedStepName,
                  errorExcerpt: failureContext?.errorExcerpt ?? "",
                });
                onSendTextToTerminal(message, terminalId);
              }}
            />
          )}
        {selected.kind === "job" && ci.logs && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              className="[@media(pointer:coarse)]:size-11"
              aria-label={t("Find in log")}
              title={`${t("Find in log")} (Ctrl+F)`}
              data-iori-action="ci-log-find"
              onClick={() => setFindRequest((value) => value + 1)}
            >
              <Search />
            </Button>
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
          </>
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
            wrap={view.wrap === true}
            refresh={logRefresh}
            stepsOpen={view.stepsOpen !== false}
            onStepsOpen={(stepsOpen) => update({ stepsOpen })}
            stepsHeight={view.stepsHeight}
            onStepsHeight={(stepsHeight) => update({ stepsHeight })}
            locale={locale}
            recovery={{ onOpenIntegrations, onOpenWorkspaceSettings }}
            findRequest={findRequest}
            onOpenFile={onOpenFile ? openLogFile : undefined}
            onFailureContext={setFailureContext}
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-iori-action="ci-empty-open-pr"
          onClick={() => update({ section: "pr" })}
        >
          {locale.startsWith("ja") ? "PRを開く" : "Open PR"}
        </Button>
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
      data-iori-ci-section={activeSection}
      data-iori-state={
        activeSection === "pr"
          ? prView
            ? "loaded"
            : prError
              ? "failed"
              : "reading"
          : ci
            ? "loaded"
            : failed
              ? "failed"
              : "reading"
      }
      hidden={!visible}
    >
      {!showsDetail && head}
      {activeSection === "pr" ? (
        <PrPane
          locale={locale}
          prView={prView}
          loading={prLoading}
          error={prError}
          ciSummary={ciSummary}
          onOpenCi={() => update({ section: "ci" })}
          onReload={reread}
          onOpenIntegrations={onOpenIntegrations}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          onOpenInBrowser={(url) => openUrl(url)}
          onOpenChangedFile={
            onOpenDiff
              ? (path, baseBranch) => onOpenDiff(path, baseBranch)
              : undefined
          }
          agentTargets={agentTargets}
          onSendTextToTerminal={onSendTextToTerminal}
          onCreatePr={createPr}
        />
      ) : (
        <>
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
        </>
      )}
      <CiCancelDialog
        runName={cancelTarget?.runName}
        locale={locale}
        busy={actionBusy?.kind === "cancel"}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(undefined);
        }}
        onConfirm={async () => {
          if (cancelTarget) await cancelWorkflow(cancelTarget.runId);
        }}
      />
    </div>
  );
}
