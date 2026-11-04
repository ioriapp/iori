import { creationOrder } from "@iori/protocol";
import { childStatus } from "./teams/children.ts";
import { StatusDot } from "./components/StatusDot.tsx";
import "./mobile-boards.css";
import { SettingsUpdateMark } from "./updates/UpdateSettings.tsx";
import { samePath } from "./host-path.ts";
import { ArrowRight, Settings } from "lucide-react";
import type {
  BoardSummary,
  TerminalListResult,
  FolderHistoryItem,
  HostInfo,
  Worktree,
} from "@iori/protocol";
import { Button } from "./components/ui/button.tsx";
import { SidebarTrigger } from "./components/ui/sidebar.tsx";
import { basename } from "./workspace-panel.tsx";
import { CliIcon } from "./CliIcon.tsx";
import { CliStateDot, CliElapsed } from "./CliStatus.tsx";
import type { AttentionItem } from "./attention.ts";

export type OpenWorktree = {
  host: HostInfo;
  folder: FolderHistoryItem;
  worktree: Worktree;
};
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
  summaries: Record<string, BoardSummary[]>;
  terminalLists: Record<string, TerminalListResult>;
  onBoard: (item: OpenWorktree, conversation: string) => void;
  attention: AttentionItem[];
  running: AttentionItem[];
  onOpen: (item: OpenWorktree) => void;
  onAttention: (item: AttentionItem) => void;
  onSettings: () => void;
}) {
  const stateOrder = [
    "Running",
    "Approval",
    "Question",
    "Waiting",
    "Reported",
    "Starting",
    "Finished",
    "Stopped",
    "Failed",
  ];
  const boards = worktrees
    .flatMap((item) => {
      if (!connectedHosts.includes(item.host.publicKey)) return [];
      const summary = summaries[item.host.publicKey]?.find((entry) =>
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
            (a, b) => stateOrder.indexOf(a.label) - stateOrder.indexOf(b.label),
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
    <div className="mobile-home" data-iori-view="mobile-home">
      <header>
        <SidebarTrigger
          className="size-12"
          title={t("Open sidebar")}
          data-iori-action="sidebar-toggle"
          aria-label={t("Open sidebar")}
        />
        <strong>iori</strong>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("Settings")}
          data-iori-action="settings-open"
          onClick={onSettings}
        >
          <Settings size={18} />
          <SettingsUpdateMark t={t} />
        </Button>
      </header>
      <section>
        <h1>
          {t("Attention")} <span>{attention.length}</span>
        </h1>
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
          return (
            <button
              key={`${host.publicKey}:${terminal.id}`}
              className="mobile-task"
              data-iori-attention-terminal={terminal.id}
              onClick={() => onAttention({ host, terminal })}
            >
              <div>
                <CliStateDot status={terminal.cliStatus} t={t} />
                {terminal.cli && (
                  <CliIcon
                    hostKey={host.publicKey}
                    cli={terminal.cli}
                    size={15}
                  />
                )}
                <strong>{terminal.cli?.name}</strong>
                <span className="mobile-task-title">
                  {terminal.title !== terminal.cli?.name ? terminal.title : ""}
                </span>
                <ArrowRight size={16} />
              </div>
              <p>
                {host.hostName} ·{" "}
                {location
                  ? `${basename(location.folder.workspacePath)} · ${location.worktree.branch ?? basename(location.worktree.path)}`
                  : (terminal.worktreePath ?? terminal.cwd)}
              </p>
              <span>
                {t("Attention")} ·{" "}
                {t(detail?.kind === "question" ? "Question" : "Approval")}
                {detail?.tool ? ` · ${detail.tool}` : ""}
              </span>
              {detail?.summary && <code>{detail.summary}</code>}
            </button>
          );
        })}
        {!attention.length && (
          <p className="mobile-home-empty">{t("No decisions waiting.")}</p>
        )}
      </section>
      {connectedHosts.some((host) => summaries[host] !== undefined) && (
        <section aria-labelledby="mobile-boards-heading">
          <h2 id="mobile-boards-heading">
            Boards <span>{boards.length}</span>
          </h2>
          {boards.length === 0 ? (
            <p className="mobile-boards-empty">
              {t("No open team conversations.")}
            </p>
          ) : (
            boards.map(({ item, summary, states }) => {
              const location = [
                item.host.hostName,
                basename(item.folder.workspacePath),
                item.worktree.branch,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <button
                  key={`${item.host.publicKey}:${item.worktree.path}`}
                  type="button"
                  className="mobile-worktree mobile-board"
                  data-iori-board-worktree={item.worktree.path}
                  onClick={() => onBoard(item, summary.conversation)}
                >
                  <div className="mobile-board-heading">
                    <strong>{basename(item.worktree.path)}</strong>
                    <CliElapsed
                      status={{ state: "idle", since: summary.lastActivityAt }}
                    />
                    <ArrowRight size={16} />
                  </div>
                  <p className="mobile-board-location" title={location}>
                    {location}
                  </p>
                  <div className="mobile-board-conversation">
                    <span>
                      {
                        terminalLists[item.host.publicKey]?.terminals.find(
                          (terminal) => terminal.id === summary.terminalId,
                        )?.title
                      }
                    </span>
                  </div>
                  <div className="mobile-board-states">
                    {states.map(({ label, state, count }) => (
                      <span key={label} className="mobile-board-state">
                        <StatusDot
                          state={state}
                          animated={state === "active"}
                          aria-label={label}
                        />
                        {label} {count}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })
          )}
        </section>
      )}
      <section>
        <h2>
          Running <span>{groups.length}</span>
        </h2>
        {groups.map(({ item, sessions }) => (
          <button
            key={`${item.host.publicKey}:${item.worktree.path}`}
            type="button"
            className="mobile-worktree"
            data-iori-running-worktree={item.worktree.path}
            onClick={() => onAttention(sessions[0])}
          >
            <div>
              <CliStateDot status={sessions[0].terminal.cliStatus} t={t} />
              <strong>{basename(item.worktree.path)}</strong>
              {item.worktree.branch && <span>{item.worktree.branch}</span>}
              <CliElapsed status={sessions[0].terminal.cliStatus} />
            </div>
            {sessions.map(({ terminal }) => (
              <div className="mobile-session-activity" key={terminal.id}>
                {terminal.cli && (
                  <CliIcon
                    hostKey={item.host.publicKey}
                    cli={terminal.cli}
                    size={14}
                  />
                )}
                <span>
                  {terminal.cli?.name}
                  {terminal.title !== terminal.cli?.name
                    ? ` · ${terminal.title}`
                    : ""}
                </span>
              </div>
            ))}
            <p>
              {item.host.hostName} · {basename(item.folder.workspacePath)}
            </p>
          </button>
        ))}
        {!groups.length && (
          <p className="mobile-home-empty">{t("No agents running.")}</p>
        )}
      </section>
      {groups.length === 0 && attention.length === 0 && (
        <section>
          <h2>
            Worktree <span>{worktrees.length}</span>
          </h2>
          {worktrees.map((item) => (
            <button
              key={`${item.host.publicKey}:${item.worktree.path}`}
              type="button"
              className="mobile-worktree"
              data-iori-home-worktree-path={item.worktree.path}
              onClick={() => onOpen(item)}
            >
              <div>
                <strong>{basename(item.worktree.path)}</strong>
                {item.worktree.branch && <span>{item.worktree.branch}</span>}
              </div>
              <p>
                {item.host.hostName} · {basename(item.folder.workspacePath)}
              </p>
            </button>
          ))}
          {!worktrees.length && (
            <p className="mobile-home-empty">
              {t("Open a folder from the sidebar.")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
