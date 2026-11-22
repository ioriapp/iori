import { useEffect, useState } from "react";
import { Search, Terminal, Plus, Users, X } from "lucide-react";
import type { TerminalShell, CliSummary, TeamList, Team } from "@iori/protocol";
import { cn } from "cn";
import { Button } from "./components/ui/button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "./components/ui/input-group.tsx";
import { pickerTeams } from "./teams/team-data.ts";
import {
  requestTeamsList,
  subscribeTeamsList,
} from "./teams/teams-list-cache.ts";
import { viewIcons } from "./workspace-panel.tsx";
import { CliIcon } from "./CliIcon.tsx";

export type ShellStatus = "loading" | "loaded" | "error";

type Props = {
  hostKey: string;
  onTeam: (team: Team) => void;
  t: (key: string) => string;
  shells: TerminalShell[];
  clis: CliSummary[];
  cliError?: boolean;
  onCli: (cli: CliSummary) => void;
  onAddCli: () => void;
  onOpenTeams: (teamId?: string) => void;
  onClosePane?: () => void;
  defaultShellId?: string;
  status: ShellStatus;
  large?: boolean;
  active?: boolean;
  onOpen?: () => void;
  onRetry: () => void;
  onShell: (shell: TerminalShell) => void;
  readingViews?: ("files" | "git" | "board")[];
  onView?: (kind: "files" | "git" | "board") => void;
  /** The item (`cli:…`, `team:…`, `shell:…`) whose start waits for the Host. */
  pending?: string;
  /** Teams already fetched by the parent dialog to avoid duplicate `teams.list` calls. */
  preloadedTeams?: TeamList;
  className?: string;
};

export function CliLauncher({
  hostKey,
  onTeam,
  t,
  shells,
  clis,
  cliError,
  onCli,
  onAddCli,
  onOpenTeams,
  onClosePane,
  defaultShellId,
  status,
  large = false,
  active = true,
  onOpen,
  onRetry,
  onShell,
  readingViews,
  onView,
  pending,
  preloadedTeams,
  className,
}: Props) {
  useEffect(() => {
    if (active) onOpen?.();
  }, [active, onOpen]);
  const [teamList, setTeamList] = useState<
    { host: string; value: TeamList } | undefined
  >(() =>
    preloadedTeams ? { host: hostKey, value: preloadedTeams } : undefined,
  );
  const [teamError, setTeamError] = useState(false);
  const [teamReload, setTeamReload] = useState(0);
  useEffect(() => {
    if (preloadedTeams) {
      setTeamList({ host: hostKey, value: preloadedTeams });
      setTeamError(false);
    }
  }, [hostKey, preloadedTeams]);
  useEffect(() => {
    if (!hostKey) return;
    return subscribeTeamsList(hostKey, (value) => {
      setTeamList({ host: hostKey, value });
      setTeamError(false);
    });
  }, [hostKey]);
  useEffect(() => {
    if (preloadedTeams && teamReload === 0) return;
    let current = true;
    setTeamError(false);
    if (hostKey && active)
      void requestTeamsList(hostKey)
        .then((response) => {
          if (!current) return;
          if (response?.ok)
            setTeamList({ host: hostKey, value: response.result });
          else setTeamError(true);
        })
        .catch(() => {
          if (current) setTeamError(true);
        });
    return () => {
      current = false;
    };
  }, [hostKey, teamReload, active, preloadedTeams]);
  const teams =
    teamList?.host === hostKey
      ? pickerTeams(teamList.value.teams)
          .map((r) => r.saved)
          .sort(
            (a, b) =>
              Number(b.id === teamList.value.defaultTeam) -
              Number(a.id === teamList.value.defaultTeam),
          )
      : [];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = shells
    .filter((shell) =>
      `${shell.label} ${shell.id}`.toLocaleLowerCase().includes(needle),
    )
    .sort(
      (a, b) =>
        Number(b.id === defaultShellId) - Number(a.id === defaultShellId),
    );
  const sectionClass = large ? "p-0 [&+section]:mt-8" : "py-1";
  const dividerSectionClass = large
    ? "mt-6 p-0"
    : "mt-1.5 border-t border-border-subtle pt-2 pb-1";
  const headingClass = large
    ? "px-0 pb-2 text-xs font-medium text-muted-foreground"
    : "px-2.5 pt-1 pb-1.5 text-2xs font-medium text-muted-foreground";
  const optionsClass = large
    ? "grid grid-cols-2 gap-2 max-[480px]:grid-cols-1"
    : "grid gap-0.5";
  const itemClass = cn(
    "w-full justify-start font-normal hover:bg-accent [@media(pointer:coarse)]:min-h-11 [&_svg]:shrink-0",
    large
      ? "h-[3.25rem] gap-3 rounded-md border border-border bg-transparent px-4 text-sm max-[480px]:h-[2.875rem]"
      : "h-8 gap-2.5 px-2.5 text-xs",
  );
  const recoveryClass = cn(
    "m-0 flex items-center justify-between gap-3 text-muted-foreground",
    large ? "p-0 text-sm" : "px-2.5 py-1 text-xs",
  );
  const emptyClass = cn(
    "m-0 text-muted-foreground",
    large ? "p-0 text-sm" : "px-2.5 py-1 text-xs",
  );
  const footerActionClass = cn(
    "mt-1.5 h-[2.125rem] justify-start gap-2.5 px-2.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:min-h-11",
    large ? "mt-4.5 w-auto" : "w-full",
  );
  return (
    <div
      className={cn(
        "cli-launcher max-w-full text-foreground in-[[data-iori-view=shell-picker]]:w-full",
        large ? "w-[40rem]" : "w-[17.5rem]",
        className,
      )}
      data-iori-teams-loaded={teamList?.host === hostKey ? "true" : "false"}
    >
      <InputGroup
        className={cn(
          "cli-launcher-search flex items-center gap-1.5 px-0 text-muted-foreground",
          large ? "mb-4 h-10 rounded-md bg-muted" : "mb-2",
        )}
      >
        <InputGroupAddon>
          <Search size={14} aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          className="h-7 min-w-0 border-0 bg-transparent px-2 text-xs shadow-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search")}
          aria-label={t("Search")}
        />
      </InputGroup>
      {(() => {
        const filteredClis = clis.filter((cli) =>
          cli.name.toLocaleLowerCase().includes(needle),
        );
        return (
          filteredClis.length > 0 && (
            <section className={sectionClass}>
              <div className={headingClass}>CLI</div>
              <div className={optionsClass}>
                {filteredClis.map((cli) => (
                  <Button
                    key={cli.id}
                    variant="ghost"
                    className={itemClass}
                    data-iori-cli-id={cli.id}
                    disabled={Boolean(pending)}
                    pending={pending === `cli:${cli.id}`}
                    onClick={() => onCli(cli)}
                  >
                    <CliIcon
                      hostKey={hostKey}
                      cli={cli}
                      size={large ? 20 : 16}
                    />
                    <span>{cli.name}</span>
                  </Button>
                ))}
              </div>
            </section>
          )
        );
      })()}
      {(() => {
        const filteredTeams = teams.filter((team) =>
          `${team.name} ${team.description}`
            .toLocaleLowerCase()
            .includes(needle),
        );
        const showEmptyTeams = !needle && !teamError && teams.length === 0;
        return (
          teamList?.host === hostKey &&
          ((large && showEmptyTeams) || filteredTeams.length > 0) && (
            <section className={sectionClass}>
              <div className={headingClass}>{t("Teams")}</div>
              {showEmptyTeams && (
                <div className={recoveryClass}>
                  <span>{t("No teams yet")}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="[@media(pointer:coarse)]:min-h-10"
                    data-iori-action="launcher-open-teams"
                    onClick={() => onOpenTeams()}
                  >
                    {t("AI Agents/Teams")}
                  </Button>
                </div>
              )}
              <div className={optionsClass}>
                {filteredTeams.map((team) => (
                  <Button
                    key={team.id}
                    variant="ghost"
                    className={cn(
                      itemClass,
                      "min-w-0 [&>.inline-flex]:w-full [&>.inline-flex]:min-w-0",
                      !team.parent.cli &&
                        (large
                          ? "min-h-[3.25rem] max-[480px]:min-h-[2.875rem]"
                          : "h-auto min-h-10 py-1"),
                    )}
                    title={
                      team.description
                        ? `${team.name}\n${team.description}`
                        : team.name
                    }
                    data-iori-team-id={team.id}
                    disabled={Boolean(pending)}
                    pending={pending === `team:${team.id}`}
                    onClick={() =>
                      team.parent.cli ? onTeam(team) : onOpenTeams(team.id)
                    }
                  >
                    <Users size={large ? 20 : 16} aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col items-start text-left leading-tight">
                      <span className="block max-w-full truncate">
                        {team.name}
                      </span>
                      {!team.parent.cli && (
                        <span className="max-w-full truncate text-xs text-muted-foreground">
                          {t("Choose an orchestrator CLI")}
                        </span>
                      )}
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          )
        );
      })()}
      {teamError && (
        <div className={recoveryClass} role="alert">
          <span className="text-status-failed-text">
            {t("Could not load teams. Retry.")}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-10"
            onClick={() => setTeamReload((v) => v + 1)}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      {cliError && (
        <div className={recoveryClass} role="alert">
          <span className="text-status-failed-text">
            {t("Could not load CLIs. Retry.")}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="[@media(pointer:coarse)]:min-h-10"
            onClick={onRetry}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      <section className={dividerSectionClass}>
        <div className={headingClass}>{t("Terminal")}</div>
        {status === "error" ? (
          <div className={recoveryClass} role="alert">
            <span className="text-status-failed-text">
              {t("Could not load shells. Retry.")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="[@media(pointer:coarse)]:min-h-10"
              onClick={onRetry}
            >
              {t("Retry")}
            </Button>
          </div>
        ) : status === "loaded" && matches.length === 0 ? (
          <p className={emptyClass}>
            {t(shells.length ? "No shells found" : "No shells on this Host")}
          </p>
        ) : (
          <div className={optionsClass}>
            {matches.map((shell) => (
              <Button
                key={shell.id}
                variant="ghost"
                className={itemClass}
                title={shell.id}
                data-iori-shell-id={shell.id}
                disabled={Boolean(pending)}
                pending={pending === `shell:${shell.id}`}
                onClick={() => onShell(shell)}
              >
                <Terminal size={large ? 20 : 16} aria-hidden="true" />
                <span>{shell.label}</span>
              </Button>
            ))}
          </div>
        )}
      </section>
      <Button
        variant="outline"
        className={footerActionClass}
        data-iori-action="add-cli"
        onClick={onAddCli}
      >
        <Plus size={15} aria-hidden="true" />
        {t("Add CLI")}…
      </Button>
      {readingViews && (
        <section className={dividerSectionClass}>
          <div className={optionsClass}>
            {readingViews.map((kind) => {
              const Icon = viewIcons[kind];
              return (
                <Button
                  key={kind}
                  variant="ghost"
                  className={itemClass}
                  data-iori-action={`workspace-open-${kind}`}
                  onClick={() => onView?.(kind)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    {kind === "files"
                      ? "Files"
                      : kind === "git"
                        ? "Git"
                        : "Board"}
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
      )}
      {onClosePane && (
        <Button
          variant="ghost"
          className={footerActionClass}
          data-iori-action="workspace-close-pane"
          onClick={onClosePane}
        >
          <X size={15} aria-hidden="true" />
          {t("Close pane")}
        </Button>
      )}
    </div>
  );
}
