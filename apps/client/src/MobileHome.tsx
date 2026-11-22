import { creationOrder } from "@iori/protocol";
import { cn } from "cn";
import { ArrowRight, LayoutDashboard, Settings } from "lucide-react";
import type {
  BoardSummary,
  TerminalListResult,
  FolderHistoryItem,
  HostInfo,
  Worktree,
} from "@iori/protocol";
import { childStatus } from "./teams/children.ts";
import type { MobileBoardsState } from "./teams/mobile-boards.ts";
import { StatusDot } from "./components/StatusDot.tsx";
import { AsyncState, type AsyncViewMode } from "./components/AsyncState.tsx";
import { SettingsUpdateMark } from "./updates/UpdateSettings.tsx";
import { samePath } from "./host-path.ts";
import { Button } from "./components/ui/button.tsx";
import { SidebarTrigger } from "./components/ui/sidebar.tsx";
import { basename } from "./workspace-panel.tsx";
import { CliIcon } from "./CliIcon.tsx";
import { CliStateDot, CliElapsed } from "./CliStatus.tsx";
import type { AttentionItem } from "./attention.ts";
import { MobileAttentionRow } from "./MobileAttentionRow.tsx";

export type OpenWorktree = {
  host: HostInfo;
  folder: FolderHistoryItem;
  worktree: Worktree;
};

function isMobileBoardsState(
  value: MobileBoardsState | Record<string, BoardSummary[]>,
): value is MobileBoardsState {
  return (
    "boards" in value &&
    "loading" in value &&
    typeof value.boards === "object" &&
    typeof value.loading === "object"
  );
}

const MOBILE_ATTENTION_LIST_CLASS = cn(
  "flex flex-col",
  "[&_article.mobile-approval-row]:border-b [&_article.mobile-approval-row]:border-border [&_article.mobile-approval-row]:pb-4",
  "[&_.mobile-task]:block [&_.mobile-task]:w-full [&_.mobile-task]:border-0 [&_.mobile-task]:border-b [&_.mobile-task]:border-border [&_.mobile-task]:bg-transparent [&_.mobile-task]:py-3.5 [&_.mobile-task]:text-left [&_.mobile-task]:text-sm [&_.mobile-task]:text-foreground [&_.mobile-task]:transition-colors [@media(hover:hover)]:[&_.mobile-task:hover]:bg-accent [&_.mobile-task:focus-visible]:outline-2 [&_.mobile-task:focus-visible]:outline-offset-2 [&_.mobile-task:focus-visible]:outline-ring",
  "[&_article.mobile-approval-row_.mobile-task]:border-b-0 [&_article.mobile-approval-row_.mobile-task]:pb-0",
  "[&_.mobile-task>div]:flex [&_.mobile-task>div]:min-w-0 [&_.mobile-task>div]:items-center [&_.mobile-task>div]:gap-2",
  "[&_.mobile-task_strong]:shrink-0 [&_.mobile-task_strong]:text-sm [&_.mobile-task_strong]:font-semibold",
  "[&_.mobile-task>div>svg]:ml-auto [&_.mobile-task>div>svg]:shrink-0 [&_.mobile-task>div>svg]:text-muted-foreground",
  "[&_.mobile-task-title]:min-w-0 [&_.mobile-task-title]:truncate",
  "[&_.mobile-task_p]:my-1.5 [&_.mobile-task_p]:text-xs [&_.mobile-task_p]:text-muted-foreground [&_.mobile-task_p]:[overflow-wrap:anywhere]",
  "[&_.mobile-task>span]:text-xs [&_.mobile-task>span]:text-muted-foreground",
  "[&_.mobile-task_code]:mt-2 [&_.mobile-task_code]:block [&_.mobile-task_code]:truncate [&_.mobile-task_code]:rounded-md [&_.mobile-task_code]:border [&_.mobile-task_code]:border-border [&_.mobile-task_code]:bg-muted/40 [&_.mobile-task_code]:p-2 [&_.mobile-task_code]:font-mono [&_.mobile-task_code]:text-2xs",
  "[&_.mobile-approval-command]:mt-2.5 [&_.mobile-approval-command]:block [&_.mobile-approval-command]:w-full [&_.mobile-approval-command]:overflow-hidden [&_.mobile-approval-command]:rounded-md [&_.mobile-approval-command]:border [&_.mobile-approval-command]:border-border [&_.mobile-approval-command]:bg-muted/40 [&_.mobile-approval-command]:p-2 [&_.mobile-approval-command]:text-left [&_.mobile-approval-command]:text-xs [&_.mobile-approval-command]:select-text",
  "[&_.mobile-approval-command_code]:block [&_.mobile-approval-command_code]:font-mono [&_.mobile-approval-command_code]:leading-relaxed [&_.mobile-approval-command_code]:whitespace-pre-wrap [&_.mobile-approval-command_code]:[overflow-wrap:anywhere]",
  "[&_.mobile-approval-command.is-collapsed_code]:max-h-[9.6em] [&_.mobile-approval-command.is-collapsed_code]:overflow-hidden",
  "[&_.mobile-approval-expand]:mt-1 [&_.mobile-approval-expand]:min-h-11 [&_.mobile-approval-expand]:px-2",
  "[&_.mobile-approval-actions]:mt-3.5 [&_.mobile-approval-actions]:flex [&_.mobile-approval-actions]:justify-end [&_.mobile-approval-actions]:gap-3 [&_.mobile-approval-actions>button]:min-w-16 [@media(pointer:coarse)]:[&_.mobile-approval-actions>button]:min-h-11 [@media(pointer:coarse)]:[&_.mobile-approval-actions>button]:min-w-22",
  "[&_.mobile-approval-error]:mt-3 [&_.mobile-approval-error]:flex [&_.mobile-approval-error]:items-start [&_.mobile-approval-error]:gap-2 [&_.mobile-approval-error]:text-xs [&_.mobile-approval-error]:leading-relaxed [&_.mobile-approval-error]:text-foreground [&_.mobile-approval-error_svg]:mt-0.5 [&_.mobile-approval-error_svg]:shrink-0 [&_.mobile-approval-error_svg]:text-status-failed-text",
);

const ROW_BUTTON_CLASS = cn(
  "mobile-worktree block w-full border-0 border-b border-border bg-transparent py-3.5 text-left text-sm text-foreground transition-colors",
  "[@media(hover:hover)]:hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
);

const STATE_ORDER = [
  "Running",
  "Not responding",
  "Approval",
  "Question",
  "Waiting",
  "Reported",
  "Starting",
  "Finished",
  "Stopped",
  "Failed",
];

export function MobileHome({
  t,
  worktrees,
  connectedHosts,
  summaries,
  terminalLists,
  onBoard,
  attention,
  running,
  onOpen,
  onAttention,
  onSettings,
}: {
  t: (key: string) => string;
  worktrees: OpenWorktree[];
  connectedHosts: string[];
  summaries: MobileBoardsState | Record<string, BoardSummary[]>;
  terminalLists: Record<string, TerminalListResult>;
  onBoard: (item: OpenWorktree, conversation: string) => void;
  attention: AttentionItem[];
  running: AttentionItem[];
  onOpen: (item: OpenWorktree) => void;
  onAttention: (item: AttentionItem) => void;
  onSettings: () => void;
}) {
  const boardsState = isMobileBoardsState(summaries)
    ? summaries
    : {
        boards: summaries,
        loading: {} as Record<string, boolean>,
        errors: {} as Record<string, string | undefined>,
        retry: undefined,
      };
  const boardsByHost = boardsState.boards;

  const boards = worktrees
    .flatMap((item) => {
      if (!connectedHosts.includes(item.host.publicKey)) return [];
      const summary = boardsByHost[item.host.publicKey]?.find((entry) =>
        samePath(entry.cwd, item.worktree.path),
      );
      if (!summary) return [];
      const counts = new Map<
        string,
        ReturnType<typeof childStatus> & { count: number }
      >();
      for (const child of summary.children) {
        const status = childStatus(child);
        const previous = counts.get(status.label);
        counts.set(status.label, {
          ...status,
          count: (previous?.count ?? 0) + 1,
        });
      }
      return [
        {
          item,
          summary,
          states: [...counts.values()].sort(
            (a, b) =>
              STATE_ORDER.indexOf(a.label) - STATE_ORDER.indexOf(b.label),
          ),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.summary.hasActive) - Number(a.summary.hasActive) ||
        b.summary.lastActivityAt - a.summary.lastActivityAt ||
        a.summary.createdAt - b.summary.createdAt ||
        a.summary.conversation.localeCompare(b.summary.conversation),
    );

  const hasLoadedBoardHost = connectedHosts.some(
    (host) => boardsByHost[host] !== undefined,
  );
  const anyBoardsLoading = connectedHosts.some(
    (host) => boardsState.loading[host],
  );
  const firstBoardsError = connectedHosts
    .map((host) => boardsState.errors[host])
    .find(Boolean);
  const showBoardsSection =
    hasLoadedBoardHost || anyBoardsLoading || Boolean(firstBoardsError);
  const boardsMode: AsyncViewMode =
    boards.length > 0
      ? "ready"
      : anyBoardsLoading
        ? "loading"
        : !hasLoadedBoardHost && firstBoardsError
          ? "error"
          : "empty";

  const groups = worktrees
    .map((item) => ({
      item,
      sessions: running
        .filter(
          (session) =>
            session.host.publicKey === item.host.publicKey &&
            samePath(
              session.terminal.worktreePath ?? session.terminal.cwd,
              item.worktree.path,
            ),
        )
        .sort((a, b) => creationOrder(a.terminal, b.terminal)),
    }))
    .filter((group) => group.sessions.length);

  return (
    <div
      className="mobile-home h-full w-full overflow-y-auto bg-background px-4 pb-8"
      data-iori-view="mobile-home"
    >
      <header className="-mx-4 grid h-[calc(var(--spacing)*12+1px)] grid-cols-[1fr_auto_1fr] items-center border-b border-border px-1.5">
        <SidebarTrigger
          className="size-11 text-muted-foreground hover:text-foreground"
          title={t("Open sidebar")}
          data-iori-action="sidebar-toggle"
          aria-label={t("Open sidebar")}
        />
        <strong className="font-heading text-xl font-semibold tracking-tight text-foreground">
          iori
        </strong>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-11 justify-self-end text-muted-foreground hover:text-foreground"
          aria-label={t("Settings")}
          data-iori-action="settings-open"
          onClick={onSettings}
        >
          <Settings className="size-4.5" aria-hidden="true" />
          <SettingsUpdateMark t={t} />
        </Button>
      </header>

      <section className="mt-6">
        <h1 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-foreground">
          {t("Attention")}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {attention.length}
          </span>
        </h1>
        {attention.length > 0 ? (
          <div className={MOBILE_ATTENTION_LIST_CLASS}>
            {attention.map(({ host, terminal }) => {
              const location = worktrees.find(
                (item) =>
                  item.host.publicKey === host.publicKey &&
                  samePath(
                    item.worktree.path,
                    terminal.worktreePath ?? terminal.cwd,
                  ),
              );
              const detail = terminal.cliStatus?.attention;
              const approval =
                detail?.kind === "approval" ? detail.approval : undefined;
              return (
                <MobileAttentionRow
                  key={`${host.publicKey}:${terminal.id}:${approval?.id ?? ""}`}
                  item={{ host, terminal }}
                  approval={
                    approval?.canRespond === true ? approval : undefined
                  }
                  connected={connectedHosts.includes(host.publicKey)}
                  location={`${host.hostName} · ${
                    location
                      ? `${basename(location.folder.workspacePath)} · ${location.worktree.branch ?? basename(location.worktree.path)}`
                      : (terminal.worktreePath ?? terminal.cwd)
                  }`}
                  onOpen={() => onAttention({ host, terminal })}
                  t={t}
                />
              );
            })}
          </div>
        ) : (
          <p className="mobile-home-empty border-y border-border-subtle py-3 text-xs text-muted-foreground">
            {t("No decisions waiting.")}
          </p>
        )}
      </section>

      {showBoardsSection && (
        <section className="mt-6" aria-labelledby="mobile-boards-heading">
          <h2
            id="mobile-boards-heading"
            className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-foreground"
          >
            Boards
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {boards.length}
            </span>
          </h2>
          <AsyncState
            mode={boardsMode}
            t={t}
            compact
            skeletonRows={2}
            emptyIcon={
              <LayoutDashboard className="size-4" aria-hidden="true" />
            }
            emptyTitle={t("No open team conversations.")}
            errorTitle={t("Could not load Board")}
            errorReason={firstBoardsError ? t(firstBoardsError) : undefined}
            onRetry={
              boardsState.retry ? () => boardsState.retry?.() : undefined
            }
          >
            <div className="flex flex-col border-t border-border">
              {boards.map(({ item, summary, states }) => {
                const location = [
                  item.host.hostName,
                  basename(item.folder.workspacePath),
                  item.worktree.branch,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const parentTitle = terminalLists[
                  item.host.publicKey
                ]?.terminals.find(
                  (terminal) => terminal.id === summary.terminalId,
                )?.title;
                return (
                  <button
                    key={`${item.host.publicKey}:${item.worktree.path}`}
                    type="button"
                    className={cn(ROW_BUTTON_CLASS, "mobile-board")}
                    data-iori-board-worktree={item.worktree.path}
                    onClick={() => onBoard(item, summary.conversation)}
                  >
                    <div className="mobile-board-heading flex min-w-0 items-start gap-2">
                      <strong className="min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] text-foreground">
                        {basename(item.worktree.path)}
                      </strong>
                      <CliElapsed
                        status={{
                          state: "idle",
                          since: summary.lastActivityAt,
                        }}
                      />
                      <ArrowRight
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <p
                      className="mobile-board-location mt-1.5 truncate text-xs text-muted-foreground"
                      title={location}
                    >
                      {location}
                    </p>
                    {parentTitle && (
                      <div className="mobile-board-conversation my-2 flex items-baseline">
                        <span className="min-w-0 shrink text-xs [overflow-wrap:anywhere] text-foreground">
                          {parentTitle}
                        </span>
                      </div>
                    )}
                    <div className="mobile-board-states flex flex-wrap gap-x-3.5 gap-y-1.5">
                      {states.map(({ label, state, count }) => {
                        const translated = t(label);
                        return (
                          <span
                            key={label}
                            className="mobile-board-state inline-flex items-center gap-1.5 text-2xs tabular-nums text-muted-foreground"
                          >
                            <StatusDot
                              state={state}
                              animated={state === "active"}
                              t={t}
                              label={translated}
                            />
                            {translated} {count}
                          </span>
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </AsyncState>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-foreground">
          {t("Running")}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {groups.length}
          </span>
        </h2>
        {groups.length > 0 ? (
          <div className="flex flex-col border-t border-border">
            {groups.map(({ item, sessions }) => (
              <button
                key={`${item.host.publicKey}:${item.worktree.path}`}
                type="button"
                className={ROW_BUTTON_CLASS}
                data-iori-running-worktree={item.worktree.path}
                onClick={() => onAttention(sessions[0])}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <CliStateDot status={sessions[0].terminal.cliStatus} t={t} />
                  <strong className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {basename(item.worktree.path)}
                  </strong>
                  {item.worktree.branch && (
                    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
                      {item.worktree.branch}
                    </span>
                  )}
                  <CliElapsed status={sessions[0].terminal.cliStatus} />
                </div>
                {sessions.map(({ terminal }) => (
                  <div
                    className="mobile-session-activity mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                    key={terminal.id}
                  >
                    {terminal.cli && (
                      <CliIcon
                        hostKey={item.host.publicKey}
                        cli={terminal.cli}
                        size={14}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {terminal.cli?.name}
                      {terminal.title !== terminal.cli?.name
                        ? ` · ${terminal.title}`
                        : ""}
                    </span>
                  </div>
                ))}
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {item.host.hostName} · {basename(item.folder.workspacePath)}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="mobile-home-empty border-y border-border-subtle py-3 text-xs text-muted-foreground">
            {t("No agents running.")}
          </p>
        )}
      </section>

      {groups.length === 0 && attention.length === 0 && (
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-foreground">
            {t("Worktree")}
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {worktrees.length}
            </span>
          </h2>
          {worktrees.length > 0 ? (
            <div className="flex flex-col border-t border-border">
              {worktrees.map((item) => (
                <button
                  key={`${item.host.publicKey}:${item.worktree.path}`}
                  type="button"
                  className={ROW_BUTTON_CLASS}
                  data-iori-home-worktree-path={item.worktree.path}
                  onClick={() => onOpen(item)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <strong className="min-w-0 truncate text-sm font-semibold text-foreground">
                      {basename(item.worktree.path)}
                    </strong>
                    {item.worktree.branch && (
                      <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">
                        {item.worktree.branch}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted-foreground">
                    {item.host.hostName} · {basename(item.folder.workspacePath)}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="mobile-home-empty border-y border-border-subtle py-3 text-xs text-muted-foreground">
              {t("Open a folder with Add folder in the sidebar.")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
