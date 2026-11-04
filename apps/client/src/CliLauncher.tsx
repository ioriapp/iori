import { useEffect, useState } from "react";
import { Search, Terminal, Plus, Users, X } from "lucide-react";
import type { TerminalShell, CliSummary, TeamList, Team } from "@iori/protocol";
import { Button } from "./components/ui/button.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "./components/ui/input-group.tsx";
import "./cli-launcher.css";
import { pickerTeams } from "./teams/team-data.ts";
import { connection } from "./connection.ts";
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
  onRetry: () => void;
  onShell: (shell: TerminalShell) => void;
  readingViews?: ("files" | "git" | "board")[];
  onView?: (kind: "files" | "git" | "board") => void;
  /** The item (`cli:…`, `team:…`, `shell:…`) whose start waits for the Host. */
  pending?: string;
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
  onRetry,
  onShell,
  readingViews,
  onView,
  pending,
}: Props) {
  const [teamList, setTeamList] = useState<{ host: string; value: TeamList }>();
  const [teamError, setTeamError] = useState(false);
  const [teamReload, setTeamReload] = useState(0);
  useEffect(() => {
    let current = true;
    setTeamError(false);
    if (hostKey && active)
      void connection
        .requestHost(hostKey, "teams.list", {})
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
  }, [hostKey, teamReload, active]);
  const teams =
    teamList?.host === hostKey && teamList.value.enabled
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
  return (
    <div
      className={`cli-launcher ${large ? "cli-launcher-large" : ""}`}
      data-iori-teams-loaded={teamList?.host === hostKey ? "true" : "false"}
    >
      <InputGroup className="cli-launcher-search">
        <InputGroupAddon>
          <Search size={14} aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search")}
          aria-label={t("Search")}
        />
      </InputGroup>
      {clis.length > 0 && (
        <section className="cli-launcher-section">
          <div className="cli-launcher-heading">CLI</div>
          <div className="cli-launcher-options">
            {clis
              .filter((cli) => cli.name.toLocaleLowerCase().includes(needle))
              .map((cli) => (
                <Button
                  key={cli.id}
                  variant="ghost"
                  className="cli-launcher-item"
                  data-iori-cli-id={cli.id}
                  disabled={Boolean(pending)}
                  pending={pending === `cli:${cli.id}`}
                  onClick={() => onCli(cli)}
                >
                  <CliIcon hostKey={hostKey} cli={cli} size={large ? 20 : 16} />
                  <span>{cli.name}</span>
                </Button>
              ))}
          </div>
        </section>
      )}
      {teamList?.host === hostKey && teamList.value.enabled && (
        <section className="cli-launcher-section">
          <div className="cli-launcher-heading">{t("Teams")}</div>
          {!teamError && teams.length === 0 && (
            <div className="cli-launcher-recovery">
              <span>{t("No teams yet")}</span>
              <Button
                variant="outline"
                size="sm"
                data-iori-action="launcher-open-teams"
                onClick={() => onOpenTeams()}
              >
                {t("AI Agents/Teams")}
              </Button>
            </div>
          )}
          <div className="cli-launcher-options">
            {teams
              .filter((team) =>
                `${team.name} ${team.description}`
                  .toLocaleLowerCase()
                  .includes(needle),
              )
              .map((team) => (
                <Button
                  key={team.id}
                  variant="ghost"
                  className={`cli-launcher-item cli-launcher-team ${team.parent.cli ? "" : "cli-launcher-team-unconfigured"}`}
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
                  <span className="cli-launcher-team-copy">
                    <span className="cli-launcher-team-name">{team.name}</span>
                    {!team.parent.cli && (
                      <span className="cli-launcher-team-hint">
                        {t("Choose a parent CLI")}
                      </span>
                    )}
                  </span>
                </Button>
              ))}
          </div>
        </section>
      )}
      {teamError && (
        <div className="cli-launcher-recovery" role="alert">
          <span>{t("Could not load teams. Retry.")}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTeamReload((v) => v + 1)}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      {cliError && (
        <div className="cli-launcher-recovery" role="alert">
          <span>{t("Could not load CLIs. Retry.")}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("Retry")}
          </Button>
        </div>
      )}
      <section className="cli-launcher-section cli-launcher-shells">
        <div className="cli-launcher-heading">{t("Terminal")}</div>
        {status === "error" ? (
          <div className="cli-launcher-recovery" role="alert">
            <span>{t("Could not load shells. Retry.")}</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("Retry")}
            </Button>
          </div>
        ) : status === "loaded" && matches.length === 0 ? (
          <p className="cli-launcher-empty">
            {t(shells.length ? "No shells found" : "No shells on this Host")}
          </p>
        ) : (
          <div className="cli-launcher-options">
            {matches.map((shell) => (
              <Button
                key={shell.id}
                variant="ghost"
                className="cli-launcher-item"
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
        className="cli-launcher-add"
        data-iori-action="add-cli"
        onClick={onAddCli}
      >
        <Plus size={15} aria-hidden="true" />
        {t("Add CLI")}…
      </Button>
      {readingViews && (
        <section className="cli-launcher-section cli-launcher-shells">
          <div className="cli-launcher-options">
            {readingViews.map((kind) => {
              const Icon = viewIcons[kind];
              return (
                <Button
                  key={kind}
                  variant="ghost"
                  className="cli-launcher-item"
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
          className="cli-launcher-add"
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
