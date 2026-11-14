import { translator } from "../i18n.ts";
import { useNarrowBack } from "../reading/useNarrowBack.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  ExternalLink,
  MessageSquare,
  RotateCw,
  Tag,
} from "lucide-react";
import type {
  ForgeIssue,
  ForgeIssueLabel,
  ForgeIssueRepository,
  ForgeIssueState,
  ForgeIssueSummary,
} from "@iori/protocol";
import { Button } from "../components/ui/button.tsx";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../components/ui/toggle-group.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { PageHeader } from "../components/page-layout.tsx";
import { SplitPane } from "../reading/SplitPane.tsx";
import { useSavedViewState } from "../reading/savedViewState.ts";
import { ReadConnectionLost, isAbort } from "../reading/transport.ts";
import { formatDate } from "../reading/format.ts";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import { requestIssues } from "./issue-requests.ts";
import { IssueMarkdown } from "./IssueMarkdown.tsx";
import { IssuesFailure } from "./IssuesFailure.tsx";
import { ForgeAction, ForgeNotice } from "../forge/ForgeFailure.tsx";
import { toggleVariants } from "../components/ui/toggle.tsx";
import { cn } from "../lib/utils.ts";
import { useForgeTokenChange } from "../forge/forge-token-changes.ts";
import "./issues.css";

export type IssuesViewState = {
  state: ForgeIssueState;
  labels: string[];
  selected?: number;
  /** On a narrow screen, whether the Issue replaces the list. */
  detailOpen: boolean;
  /** The list's share of the width, in percent. */
  ratio?: number;
};

// The list shows titles and labels, so it starts wider than Files' and Git's.
const LIST_RATIO = 38;
const LIST_MIN_WIDTH = 320;

// A saved state is read leniently; the shape is iori's own.
function readViewState(value: unknown): IssuesViewState {
  const saved: Partial<IssuesViewState> =
    value && typeof value === "object" ? { ...value } : {};
  return {
    state: saved.state === "closed" ? "closed" : "open",
    labels: Array.isArray(saved.labels)
      ? saved.labels.filter((label) => typeof label === "string")
      : [],
    ...(typeof saved.selected === "number" ? { selected: saved.selected } : {}),
    detailOpen: saved.detailOpen === true,
    ...(typeof saved.ratio === "number" ? { ratio: saved.ratio } : {}),
  };
}

type Listing = {
  /** The state and labels these Issues were read with. */
  filter: string;
  url: string;
  enabled: boolean;
  issues: ForgeIssueSummary[];
  pages: number;
  hasMore: boolean;
};
type ListRead = "reset" | "refresh" | "more";

const timeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];
function since(time: number, now: number, locale: string) {
  const seconds = Math.max(0, (now - time) / 1000);
  const [unit, size] = timeUnits.find(([, size]) => seconds >= size) ?? [
    "second",
    1,
  ];
  const formatted = new Intl.RelativeTimeFormat(locale).format(
    -Math.floor(seconds / size),
    unit,
  );
  return locale.startsWith("ja") ? formatted.replace(/\s/gu, "") : formatted;
}

function LabelChip({ label }: { label: ForgeIssueLabel }) {
  return (
    <span className="issues-label" data-iori-label={label.name}>
      <i
        style={
          label.color
            ? ({ "--issues-label-color": label.color } as CSSProperties)
            : undefined
        }
      />
      {label.name}
    </span>
  );
}

function StateIcon({ state }: { state: ForgeIssueState }) {
  return state === "open" ? (
    <CircleDot
      size={15}
      className="issues-state-icon issues-open"
      aria-label="Open"
    />
  ) : (
    <CircleCheck
      size={15}
      className="issues-state-icon issues-closed"
      aria-label="Closed"
    />
  );
}

/** A repository's Issues: the list beside the chosen Issue, or one at a time. */
export function IssuesPane(props: {
  hostKey: string;
  /** A folder of the repository; every worktree shows the same Issues. */
  path: string;
  locale: string;
  visible: boolean;
  viewState?: unknown;
  onViewState?: (state: IssuesViewState) => void;
  onBackHandler?: (handler: (() => boolean) | undefined) => void;
  /** Recovery from a failed read: the Host's Integrations settings. */
  onOpenIntegrations?: () => void;
  /** Recovery from a failed read: the workspace's Git settings. */
  onOpenWorkspaceSettings?: () => void;
  /** Opens the repository's worktree screen filled in for the Issue. */
  onStartIssue?: (issue: { number: number; title: string }) => void;
}) {
  return (
    <IssuesView key={JSON.stringify([props.hostKey, props.path])} {...props} />
  );
}

function IssuesView({
  hostKey,
  path,
  locale,
  visible,
  viewState,
  onViewState,
  onBackHandler,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onStartIssue,
}: Parameters<typeof IssuesPane>[0]) {
  const t = translator(locale);
  const [view, setView] = useState(() => readViewState(viewState));
  const update = (value: Partial<IssuesViewState>) =>
    setView((current) => ({ ...current, ...value }));
  const changeRatio = useSavedViewState(view, onViewState);
  const [narrow, setNarrow] = useState(false);
  const connected = useSyncExternalStore(connection.subscribe, () =>
    connection.getSnapshot().connectedHosts.includes(hostKey),
  );
  // Issues are read when shown, again when shown after being hidden, and
  // after the Host connection returns.
  const active = visible && connected;

  const [repository, setRepository] = useState<ForgeIssueRepository>();
  const [listing, setListing] = useState<Listing>();
  const [listFailure, setListFailure] = useState<{
    error: unknown;
    read: ListRead;
  }>();
  const [listBusy, setListBusy] = useState<ListRead>();
  const listingRef = useRef(listing);
  listingRef.current = listing;
  const running = useRef<AbortController | undefined>(undefined);
  const filter = JSON.stringify([view.state, [...view.labels].sort()]);
  const readList = useCallback(
    async (read: ListRead) => {
      const shown =
        listingRef.current?.filter === filter ? listingRef.current : undefined;
      if (read === "more" && (running.current || !shown?.hasMore)) return;
      running.current?.abort();
      const controller = new AbortController();
      running.current = controller;
      setListBusy(read);
      if (!shown) {
        setListing(undefined);
        setListFailure(undefined);
      }
      const [state, labels] = JSON.parse(filter) as [ForgeIssueState, string[]];
      // A refresh reads again the pages already shown, so the place stays.
      const first = read === "more" && shown ? shown.pages + 1 : 1;
      const last = read === "refresh" && shown ? shown.pages : first;
      try {
        let issues = read === "more" && shown ? shown.issues : [];
        let next: Listing | undefined;
        for (let page = first; page <= last; page++) {
          const result = await requestIssues(
            hostKey,
            "forge.issues.list",
            { path, state, labels, page },
            controller.signal,
          );
          // An Issue opened meanwhile moves the rest down a page.
          const seen = new Set(issues.map((issue) => issue.number));
          issues = [
            ...issues,
            ...result.issues.filter((issue) => !seen.has(issue.number)),
          ];
          setRepository(result.repository);
          next = {
            filter,
            url: result.url,
            enabled: result.enabled,
            issues,
            pages: page,
            hasMore: result.hasMore,
          };
          if (!result.hasMore) break;
        }
        if (next) setListing(next);
        setListFailure(undefined);
      } catch (error) {
        if (controller.signal.aborted || isAbort(error)) return;
        // Without the Host the list stays as it is until it reconnects.
        if (!(error instanceof ReadConnectionLost))
          setListFailure({ error, read });
      } finally {
        if (running.current === controller) {
          running.current = undefined;
          setListBusy(undefined);
        }
      }
    },
    [hostKey, path, filter],
  );
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (!active) return;
    void readList(listingRef.current?.filter === filter ? "refresh" : "reset");
  }, [active, filter, readList]);

  const [labels, setLabels] = useState<ForgeIssueLabel[]>([]);
  const [labelsFailure, setLabelsFailure] = useState<{ error: unknown }>();
  const [labelsRetry, setLabelsRetry] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    // The repository is named even when its Issues cannot be read.
    requestIssues(
      hostKey,
      "forge.issues.repository",
      { path },
      controller.signal,
    )
      .then((result) => {
        if (result.repository) setRepository(result.repository);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active, hostKey, path, reload]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    requestIssues(hostKey, "forge.issues.labels", { path }, controller.signal)
      .then((result) => {
        setLabels(result.labels);
        setLabelsFailure(undefined);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          isAbort(error) ||
          error instanceof ReadConnectionLost
        )
          return;
        setLabelsFailure({ error });
      });
    return () => controller.abort();
  }, [active, hostKey, path, reload, labelsRetry]);

  const [detail, setDetail] = useState<{
    number: number;
    issue?: ForgeIssue;
    /** The repository reads, but the Issue was removed or moved. */
    gone?: boolean;
    failure?: unknown;
  }>();
  const [detailRetry, setDetailRetry] = useState(0);
  const selected = view.selected;
  useEffect(() => {
    if (selected === undefined || !active) return;
    const controller = new AbortController();
    // The same Issue stays on screen while it is read again.
    setDetail((current) =>
      current?.number === selected
        ? { ...current, failure: undefined }
        : { number: selected },
    );
    requestIssues(
      hostKey,
      "forge.issues.show",
      { path, number: selected },
      controller.signal,
    )
      .then((result) =>
        setDetail({
          number: selected,
          issue: result.issue,
          gone: !result.issue,
        }),
      )
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          isAbort(error) ||
          error instanceof ReadConnectionLost
        )
          return;
        setDetail((current) =>
          current?.number === selected
            ? { ...current, failure: error }
            : current,
        );
      });
    return () => controller.abort();
  }, [selected, active, hostKey, path, reload, detailRetry]);

  const shown = listing?.filter === filter ? listing : undefined;
  const empty =
    shown && (!shown.enabled || (!shown.issues.length && !shown.hasMore));
  // Nothing to choose from: the list and its message take the whole width.
  const single = Boolean(empty) || (!shown && Boolean(listFailure));
  const detailOpen = !single && view.detailOpen && selected !== undefined;

  // On a narrow screen, going back leaves the Issue for the list.
  const showsDetail = narrow && detailOpen;
  useNarrowBack(onBackHandler, showsDetail, () => {
    setView((current) => ({ ...current, detailOpen: false }));
    return true;
  });

  // The list reads the next page before its end comes into view. A hidden
  // list keeps its place: the WebView restores it when shown again.
  const scroller = useRef<HTMLDivElement>(null);
  const loadMore = useCallback(() => {
    const box = scroller.current;
    if (
      box &&
      box.clientHeight > 0 &&
      box.scrollTop + box.clientHeight * 2 >= box.scrollHeight
    )
      void readList("more");
  }, [readList]);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const observer = new ResizeObserver(() => loadMore());
    observer.observe(box);
    return () => observer.disconnect();
  }, [loadMore]);
  useEffect(() => {
    if (active) loadMore();
  }, [active, listing, loadMore]);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [filter]);
  const detailBox = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (detailBox.current) detailBox.current.scrollTop = 0;
  }, [selected]);

  const now = Date.now();
  const menuLabels = [
    ...labels,
    // A chosen label the Forge no longer lists can still be cleared.
    ...view.labels
      .filter((name) => !labels.some((label) => label.name === name))
      .map((name) => ({ name })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = [...view.labels].sort((a, b) => a.localeCompare(b));
  // Without a list read, the repository's own Issues page still opens.
  const browserUrl = shown?.url ?? repository?.url;
  const reloadAll = () => {
    void readList(shown ? "refresh" : "reset");
    setReload((value) => value + 1);
  };
  // A token registered, replaced or removed may let a failed read work now.
  useForgeTokenChange(
    hostKey,
    active &&
      (Boolean(listFailure) ||
        Boolean(labelsFailure) ||
        detail?.failure !== undefined),
    reloadAll,
  );
  // A failed reload keeps the Issues already listed; otherwise it says why
  // where the list would be, without the empty list's sentence.
  const kept = Boolean(shown?.issues.length);
  const failure = listFailure && (
    <IssuesFailure
      subject="list"
      form={kept ? "line" : "notice"}
      error={listFailure.error}
      locale={locale}
      recovery={{
        onRetry: () =>
          void readList(
            listFailure.read === "more" ? "more" : shown ? "refresh" : "reset",
          ),
        onOpenIntegrations,
        onOpenWorkspaceSettings,
      }}
    />
  );

  const head = (
    <div className="issues-head" data-iori-part="issues-head">
      <div className="issues-repo">
        <span
          className="issues-repo-name"
          title={
            repository ? `${repository.owner}/${repository.repo}` : undefined
          }
          data-iori-part="issues-repository"
        >
          {repository && `${repository.owner}/${repository.repo}`}
        </span>
        {repository && (
          <span className="issues-forge">{repository.forge.label}</span>
        )}
        <span className="issues-head-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Reload")}
            title={t("Reload")}
            pending={listBusy === "reset" || listBusy === "refresh"}
            data-iori-action="issues-reload"
            onClick={reloadAll}
          >
            <RotateCw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Open in browser")}
            title={t("Open in browser")}
            disabled={!browserUrl}
            data-iori-action="issues-open-browser"
            onClick={() => browserUrl && void native.openUrl(browserUrl)}
          >
            <ExternalLink />
          </Button>
        </span>
      </div>
      {shown?.enabled !== false && (
        <div className="issues-tools">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view.state}
            onValueChange={(value) =>
              value && update({ state: value as ForgeIssueState })
            }
            aria-label={t("Issue state")}
          >
            <ToggleGroupItem value="open" data-iori-action="issues-open">
              Open
            </ToggleGroupItem>
            <ToggleGroupItem value="closed" data-iori-action="issues-closed">
              Closed
            </ToggleGroupItem>
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Looks like the state toggle: chosen while it filters. */}
              <button
                type="button"
                className={cn(
                  toggleVariants({ variant: "outline", size: "sm" }),
                  "issues-label-trigger",
                )}
                data-filtered={chosen.length > 0}
                data-iori-action="issues-labels"
                title={chosen.join(", ") || undefined}
              >
                <Tag />
                <span className="issues-label-trigger-text">
                  {chosen.length ? chosen.join(", ") : t("Labels")}
                </span>
                <ChevronDown />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="issues-label-menu">
              {labelsFailure && (
                <IssuesFailure
                  subject="labels"
                  form="line"
                  error={labelsFailure.error}
                  locale={locale}
                  recovery={{
                    onRetry: () => setLabelsRetry((value) => value + 1),
                    onOpenIntegrations,
                    onOpenWorkspaceSettings,
                  }}
                />
              )}
              {!labelsFailure && menuLabels.length === 0 && (
                <p className="issues-label-none">{t("There are no labels.")}</p>
              )}
              {!labelsFailure &&
                menuLabels.map((label) => (
                  <DropdownMenuCheckboxItem
                    key={label.name}
                    checked={view.labels.includes(label.name)}
                    data-iori-action="issues-label"
                    data-iori-label={label.name}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      update({
                        labels: checked
                          ? [...view.labels, label.name]
                          : view.labels.filter((name) => name !== label.name),
                      })
                    }
                  >
                    <LabelChip label={label} />
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  const list = (
    <div
      ref={scroller}
      className="issues-list"
      data-iori-scroll="issues-list"
      onScroll={loadMore}
    >
      {head}
      {failure}
      {listFailure && !kept ? null : shown && !shown.enabled ? (
        <ForgeNotice data-iori-state="issues-disabled">
          <p>{t("This repository does not use Issues.")}</p>
        </ForgeNotice>
      ) : empty ? (
        <ForgeNotice data-iori-state="issues-empty">
          <p>
            {t(
              view.state === "open"
                ? "There are no open Issues."
                : "There are no closed Issues.",
            )}
          </p>
          {view.labels.length > 0 && (
            <ForgeAction
              data-iori-action="issues-clear-labels"
              onClick={() => update({ labels: [] })}
            >
              {t("Clear filters")}
            </ForgeAction>
          )}
        </ForgeNotice>
      ) : (
        <div data-iori-part="issues-rows">
          {(shown?.issues ?? []).map((issue) => (
            <button
              type="button"
              key={issue.number}
              className="issues-row"
              aria-current={issue.number === selected || undefined}
              data-iori-issue={issue.number}
              onClick={() =>
                update({ selected: issue.number, detailOpen: true })
              }
            >
              <StateIcon state={issue.state} />
              <span className="issues-row-main">
                <span className="issues-row-title">{issue.title}</span>
                <span className="issues-row-meta">
                  #{issue.number}
                  {issue.author && ` · ${issue.author}`} ·{" "}
                  {t("updated {value1}").replace("{value1}", () =>
                    String(since(issue.updatedAt, now, locale)),
                  )}
                  {issue.comments > 0 && (
                    <span
                      className="issues-row-comments"
                      title={t("{value1} comments").replace("{value1}", () =>
                        String(issue.comments),
                      )}
                    >
                      <MessageSquare size={12} aria-hidden="true" />
                      {issue.comments}
                    </span>
                  )}
                </span>
                {issue.labels.length > 0 && (
                  <span className="issues-labels">
                    {issue.labels.map((label) => (
                      <LabelChip key={label.name} label={label} />
                    ))}
                  </span>
                )}
              </span>
              {narrow && <ChevronRight size={14} className="issues-chevron" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const issue = detail?.number === selected ? detail?.issue : undefined;
  const summary =
    issue ?? shown?.issues.find((item) => item.number === selected);
  const author = summary?.author;
  const detailView = (
    <section
      ref={detailBox}
      className="issues-detail"
      data-iori-part="issue-detail"
      data-iori-issue-detail={selected}
    >
      {narrow && selected !== undefined && (
        <div className="reading-header issues-detail-nav">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Back to list")}
            title={t("Back to list")}
            data-iori-action="issues-back"
            onClick={() => update({ detailOpen: false })}
          >
            <ArrowLeft />
          </Button>
        </div>
      )}
      {selected === undefined ? (
        <ForgeNotice>
          <p>{t("Select an Issue to read it")}</p>
        </ForgeNotice>
      ) : (
        <div className="issues-detail-body">
          <PageHeader
            className="issues-detail-header"
            title={
              summary ? (
                <>
                  {summary.title}{" "}
                  <span className="issues-number">#{summary.number}</span>
                </>
              ) : (
                <span className="issues-number">#{selected}</span>
              )
            }
            description={
              summary && (
                <div className="issues-detail-meta">
                  <span className={`issues-state issues-${summary.state}`}>
                    {summary.state === "open" ? (
                      <CircleDot size={13} />
                    ) : (
                      <CircleCheck size={13} />
                    )}
                    {summary.state === "open" ? "Open" : "Closed"}
                  </span>
                  <span>
                    {author && (
                      <>
                        <span className="issues-detail-author">{author}</span>
                        {t(" ")}
                      </>
                    )}
                    <span className="issues-detail-fact">
                      {author
                        ? t("opened on {value1}").replace("{value1}", () =>
                            String(formatDate(summary.createdAt, locale)),
                          )
                        : t("Opened on {value1}").replace("{value1}", () =>
                            String(formatDate(summary.createdAt, locale)),
                          )}
                    </span>
                    {" · "}
                    <span className="issues-detail-fact">
                      {t("{value1} comments").replace("{value1}", () =>
                        String(summary.comments),
                      )}
                    </span>
                  </span>
                </div>
              )
            }
            actions={
              <>
                {onStartIssue && (
                  <Button
                    size="lg"
                    disabled={!summary}
                    data-iori-action="issue-start"
                    onClick={() =>
                      summary &&
                      onStartIssue({
                        number: summary.number,
                        title: summary.title,
                      })
                    }
                  >
                    {t("Start with this Issue")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={!summary}
                  data-iori-action="issue-open-browser"
                  onClick={() => summary && void native.openUrl(summary.url)}
                >
                  <ExternalLink />
                  {t("Open in browser")}
                </Button>
              </>
            }
          />
          {summary &&
            (summary.labels.length > 0 || Boolean(issue?.assignees.length)) && (
              <dl className="issues-facts">
                {summary.labels.length > 0 && (
                  <div>
                    <dt>{t("Labels")}</dt>
                    <dd className="issues-labels">
                      {summary.labels.map((label) => (
                        <LabelChip key={label.name} label={label} />
                      ))}
                    </dd>
                  </div>
                )}
                {issue && issue.assignees.length > 0 && (
                  <div>
                    <dt>{t("Assignees")}</dt>
                    <dd>{issue.assignees.join(", ")}</dd>
                  </div>
                )}
              </dl>
            )}
          {detail?.number === selected && detail.failure !== undefined && (
            <IssuesFailure
              subject="issue"
              form={issue ? "line" : "notice"}
              error={detail.failure}
              locale={locale}
              recovery={{
                onRetry: () => setDetailRetry((value) => value + 1),
                onOpenIntegrations,
                onOpenWorkspaceSettings,
              }}
            />
          )}
          {detail?.number === selected && detail.gone && (
            <ForgeNotice data-iori-state="issue-gone">
              <p>{t("This Issue was not found.")}</p>
            </ForgeNotice>
          )}
          {issue && (
            <div className="issues-posts" data-iori-part="issue-posts">
              {issue.body && (
                <article className="issues-post" data-iori-part="issue-body">
                  <header>
                    <b>{issue.author}</b>
                    <span>{formatDate(issue.createdAt, locale)}</span>
                  </header>
                  <IssueMarkdown
                    text={issue.body}
                    base={issue.url}
                    locale={locale}
                  />
                </article>
              )}
              {issue.thread.map((comment) => (
                <article
                  key={comment.id}
                  className="issues-post"
                  data-iori-part="issue-comment"
                >
                  <header>
                    <b>{comment.author}</b>
                    <span>{formatDate(comment.createdAt, locale)}</span>
                  </header>
                  <IssueMarkdown
                    text={comment.body}
                    base={issue.url}
                    locale={locale}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );

  const onNarrow = useCallback((value: boolean) => setNarrow(value), []);
  return (
    <div
      className="issues-pane"
      data-iori-view="issues"
      data-single={single}
      hidden={!visible}
    >
      <SplitPane
        list={list}
        detailOpen={detailOpen}
        listOpen
        onNarrow={onNarrow}
        locale={locale}
        ratio={view.ratio ?? LIST_RATIO}
        minListWidth={LIST_MIN_WIDTH}
        onRatio={changeRatio}
      >
        {detailView}
      </SplitPane>
    </div>
  );
}
