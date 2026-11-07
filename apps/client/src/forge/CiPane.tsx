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
  type ForgeReadFailure,
} from "@iori/protocol";
import { Button } from "../components/ui/button";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { forgeMark } from "../forge-status.ts";
import { samePath } from "../host-path.ts";
import { useIsMobile } from "../hooks/use-mobile.ts";
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
import "./ci.css";

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
  const ja = locale.startsWith("ja");
  const mobile = useIsMobile();
  const [view, setView] = useState(() => readViewState(viewState));
  const update = (value: Partial<CiViewState>) =>
    setView((current) => ({ ...current, ...value }));
  const changeRatio = useSavedViewState(view, onViewState);
  const [narrow, setNarrow] = useState(false);
  const [ci, setCi] = useState<ForgeCi>();
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
  const back = useRef(onBackHandler);
  back.current = onBackHandler;
  const showsDetail = narrow && view.detailOpen;
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
    <div className="ci-head" data-iori-part="ci-head">
      <WorktreePicker
        label={label}
        root={root}
        worktrees={worktrees}
        onSelect={onSelectWorktree}
        field="ci-worktree"
      />
      {hasCi && ci?.commit && (
        <span
          className="ci-commit"
          title={`${ci.commit.sha} ${ci.commit.subject ?? ""}`.trim()}
          data-iori-part="ci-commit"
        >
          <code>{ci.commit.sha.slice(0, 7)}</code>
          {ci.commit.subject && (
            <span className="reading-truncate">{ci.commit.subject}</span>
          )}
        </span>
      )}
      <span className="ci-head-actions">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ja ? "再読み込み" : "Reload"}
          title={ja ? "再読み込み" : "Reload"}
          data-iori-action="ci-reload"
          onClick={reread}
        >
          <RotateCw />
        </Button>
        {hasCi && ci?.url && (
          <Button
            variant="ghost"
            size="sm"
            className="ci-browser"
            data-iori-action="ci-open-browser"
            onClick={() => openUrl(ci.url)}
          >
            <ExternalLink />
            {ja ? "ブラウザーで開く" : "Open in browser"}
          </Button>
        )}
      </span>
    </div>
  );
  const failure = failed && (
    <CiFailure
      subject="ci"
      form={ci ? "line" : "notice"}
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
  const row = (
    selection: Selection,
    status: ForgeCiJob["status"],
    name: string,
    note: string | undefined,
    meta: string | undefined,
    nested: boolean,
  ) => (
    <button
      type="button"
      key={`${selection.kind}:${selection.id}`}
      className={`ci-row ${nested ? "ci-job" : ""}`}
      aria-current={isSelected(selection) || undefined}
      data-iori-action={`ci-select-${selection.kind}`}
      data-iori-ci-id={selection.id}
      data-iori-ci-status={status}
      title={name}
      onClick={() => choose(selection)}
    >
      <CiStateIcon state={forgeCiState(status)} />
      <span className="ci-name">{name}</span>
      {note && <span className="ci-note">{note}</span>}
      {meta && <span className="ci-meta">{meta}</span>}
      {narrow && <ChevronRight size={14} className="ci-chevron" />}
    </button>
  );
  const list = ci && (
    <div className="ci-list" data-iori-part="ci-list">
      {ci.runs.map((run) => (
        <div className="ci-run" key={run.id} data-iori-ci-run={run.id}>
          <div className="ci-run-head" title={run.name}>
            <CiStateIcon state={forgeCiState(run.status)} />
            <span className="ci-name">{run.name}</span>
            {run.event && <span className="ci-note">{run.event}</span>}
            {ciDuration(run, now) && (
              <span className="ci-meta">{ciDuration(run, now)}</span>
            )}
          </div>
          {run.jobs.map((job) =>
            row(
              { kind: "job", id: job.id },
              job.status,
              job.name,
              undefined,
              ciDuration(job, now),
              true,
            ),
          )}
        </div>
      ))}
      {ci.results.length > 0 && (
        <div className="ci-run">
          {ci.runs.length > 0 && (
            <div className="ci-run-head ci-run-plain">
              {ja ? "その他の結果" : "Other results"}
            </div>
          )}
          {ci.results.map((result) =>
            row(
              { kind: "result", id: result.id },
              result.status,
              result.name,
              result.description,
              undefined,
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
      data-iori-action={narrow ? "ci-back" : "toggle-ci-list"}
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
      className="ci-detail"
      data-iori-part="ci-detail"
      data-iori-ci-selected={
        selected.kind === "job" ? selected.job.id : selected.result.id
      }
    >
      <div className="reading-header ci-detail-head">
        {listToggle}
        {/* A long name keeps its line; the state moves under it. */}
        <div className="ci-detail-title">
          <span className="ci-detail-label">
            <CiStateIcon state={forgeCiState(status)} size={16} />
            <span className="ci-detail-name">
              {selected.kind === "job"
                ? selected.job.name
                : selected.result.name}
            </span>
          </span>
          <span className="ci-meta ci-detail-meta">
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
            aria-pressed={view.wrap === true}
            aria-label={ja ? "長い行を折り返す" : "Wrap long lines"}
            title={ja ? "長い行を折り返す" : "Wrap long lines"}
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
            aria-label={
              ja ? "このジョブをブラウザーで開く" : "Open this job in browser"
            }
            title={
              ja ? "このジョブをブラウザーで開く" : "Open this job in browser"
            }
            data-iori-action="ci-job-open-browser"
            onClick={() => openUrl(selected.job.url)}
          >
            <ExternalLink />
          </Button>
        )}
      </div>
      {selected.kind === "job" && ci.logs ? (
        forgeCiState(selected.job.status) === "skipped" ? (
          <p className="reading-empty">
            {ja
              ? "このジョブは実行されませんでした。"
              : "This job did not run."}
          </p>
        ) : NOT_STARTED.has(selected.job.status) ? (
          <p className="reading-empty">
            {ja
              ? "このジョブはまだ開始されていません。"
              : "This job has not started yet."}
          </p>
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
        <div className="ci-browser-only" data-iori-state="ci-browser-only">
          <Button
            variant="outline"
            size="sm"
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
            {ja ? "ブラウザーで開く" : "Open in browser"}
          </Button>
        </div>
      )}
    </div>
  );

  const onNarrow = useCallback((value: boolean) => setNarrow(value), []);
  const empty =
    ci && !ci.commit ? (
      <ForgeNotice data-iori-state="ci-no-target">
        <p>
          {ja
            ? "このブランチにはpush先がありません。CIを表示するには、ブランチをpushしてください。"
            : "This branch has no push destination. Push it to see its commit's CI."}
        </p>
      </ForgeNotice>
    ) : ci && ci.runs.length === 0 && ci.results.length === 0 ? (
      <ForgeNotice data-iori-state="ci-none">
        <p>
          {ja
            ? "このcommitのCIはありません。"
            : "There is no CI for this commit."}
        </p>
      </ForgeNotice>
    ) : undefined;
  return (
    <div
      className="ci-pane"
      data-iori-view="ci"
      data-iori-ci-path={root}
      data-iori-state={ci ? "loaded" : failed ? "failed" : "reading"}
      hidden={!visible}
    >
      {!showsDetail && head}
      {failure}
      {empty ??
        (ci && (
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
        ))}
    </div>
  );
}
