import type { BoardAgent } from "@iori/protocol";
import { StatusIndicator } from "../../components/StatusIndicator.tsx";
import { Button } from "../../components/ui/button.tsx";
import { elapsedTime } from "../board-i18n.ts";

export type BoardAttentionItem = {
  owner: "You";
  kind: "Approval" | "Question" | "No candidate";
  agent: BoardAgent;
  at?: number;
  detail: string;
};

export function BoardAttention({
  items,
  teamId,
  now,
  t,
  onOpenTerminal,
  onEditTeam,
}: {
  items: BoardAttentionItem[];
  teamId: string;
  now: number;
  t: (key: string) => string;
  onOpenTerminal: (terminalId: string) => void;
  onEditTeam: (teamId: string, roleId?: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Attention"
      className="border-b border-border px-4 py-3 @3xl:px-6"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-heading text-xs font-semibold text-status-waiting-text">
          <StatusIndicator status="waiting" t={t} showTitle={false} />
          Attention
          <span className="font-normal tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((turn) => (
          <div
            key={turn.agent.id}
            data-iori-board-attention={turn.kind
              .toLowerCase()
              .replaceAll(" ", "-")}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-status-waiting-border bg-status-waiting-bg/50 px-3 py-2 text-xs"
          >
            <span className="w-12 shrink-0 text-2xs font-medium text-status-waiting-text">
              {t(turn.owner)}
            </span>
            <button
              type="button"
              onClick={() =>
                turn.kind === "No candidate"
                  ? onEditTeam(teamId, turn.agent.roleId)
                  : turn.agent.terminalId &&
                    onOpenTerminal(turn.agent.terminalId)
              }
              className="group flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-xs text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:justify-center"
            >
              <span className="text-xs text-foreground group-hover:underline group-hover:underline-offset-3 [overflow-wrap:anywhere]">
                <strong className="font-medium">{t(turn.kind)}</strong> ·{" "}
                {turn.agent.role} · {turn.agent.title}
              </span>
              {turn.detail && (
                <small className="text-2xs leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                  {turn.detail}
                </small>
              )}
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {turn.kind === "No candidate" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="[@media(pointer:coarse)]:min-h-11"
                  onClick={() => onEditTeam(teamId, turn.agent.roleId)}
                >
                  {t("Edit team")}
                </Button>
              )}
              {turn.at !== undefined && (
                <time className="text-2xs tabular-nums text-muted-foreground">
                  {elapsedTime(now - turn.at)}
                </time>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
