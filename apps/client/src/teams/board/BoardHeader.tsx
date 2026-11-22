import { MessageSquare, Users } from "lucide-react";
import type { BoardAgent, BoardConversation, Changes } from "@iori/protocol";
import { StatusIndicator } from "../../components/StatusIndicator.tsx";
import { Button } from "../../components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.tsx";
import { ChangeAmount } from "../ChangeAmount.tsx";
import { compactNumber, recordMeasurement } from "../board-i18n.ts";
import { agentIndicatorStatus, summarizeAgentStates } from "./board-state.tsx";

export function BoardHeader({
  conversations,
  conversation,
  teamName,
  agents,
  completedTasks,
  totalTasks,
  changeTotal,
  measuredAgents,
  language,
  t,
  onSelectConversation,
  onOpenConversation,
  onEditTeam,
}: {
  conversations: BoardConversation[];
  conversation: BoardConversation;
  teamName: string;
  agents: BoardAgent[];
  completedTasks: number;
  totalTasks: number;
  changeTotal?: Changes;
  measuredAgents: BoardAgent[];
  language: string;
  t: (key: string) => string;
  onSelectConversation: (id: string) => void;
  onOpenConversation: (terminalId: string) => void;
  onEditTeam: (teamId: string) => void;
}) {
  const statusCounts = summarizeAgentStates(agents);
  const totalTokens = measuredAgents.reduce(
    (sum, agent) => sum + agent.tokens!.input + agent.tokens!.output,
    0,
  );
  const tokenSummary =
    measuredAgents.length > 0
      ? recordMeasurement(
          t("{count} tokens").replace("{count}", compactNumber(totalTokens)),
          measuredAgents.length,
          agents.length,
          language,
        )
      : undefined;

  return (
    <header className="shrink-0 bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 @3xl:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {conversations.length > 1 && (
            <Select
              value={conversation.id}
              onValueChange={onSelectConversation}
            >
              <SelectTrigger
                aria-label={t("Conversation")}
                className="max-w-full min-w-0 [@media(pointer:coarse)]:min-h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {conversations.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name && `${item.name} · `}
                    {new Date(item.createdAt).toLocaleString(language, {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-11"
            data-iori-action="board-open-conversation"
            onClick={() => onOpenConversation(conversation.terminalId)}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {t("Open conversation")}
          </Button>
          {teamName && (
            <Button
              variant="ghost"
              size="sm"
              className="max-w-full min-w-0 [@media(pointer:coarse)]:min-h-11"
              data-iori-action="board-edit-team"
              aria-label={`${t("Edit team")}: ${teamName}`}
              onClick={() => onEditTeam(conversation.teamId)}
            >
              <Users className="size-3.5" aria-hidden="true" />
              <span className="truncate">{teamName}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-4 py-2 text-xs tabular-nums @3xl:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {totalTasks > 0 && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="font-medium text-foreground">Plan</span>
              <span>
                {t("{completed} of {total} done")
                  .replace("{completed}", String(completedTasks))
                  .replace("{total}", String(totalTasks))}
              </span>
            </span>
          )}
          {totalTasks > 0 && (
            <span className="text-border" aria-hidden="true">
              |
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="font-medium text-foreground">Agents</span>
            <span>{agents.length}</span>
          </span>
          {statusCounts.map(({ state, count }) => {
            const indicator = agentIndicatorStatus(state);
            return (
              <span
                key={state}
                className="inline-flex items-center gap-1.5 text-muted-foreground"
              >
                <StatusIndicator
                  status={indicator}
                  animated={indicator === "running"}
                  label={t(state)}
                  showTitle={false}
                />
                <span>{t(state)}</span>
                <span className="font-medium text-foreground">{count}</span>
              </span>
            );
          })}
        </div>

        {(changeTotal || tokenSummary) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            {changeTotal && (
              <ChangeAmount changes={changeTotal} language={language} />
            )}
            {tokenSummary && (
              <span title={t("Tokens (input + output)")}>{tokenSummary}</span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
