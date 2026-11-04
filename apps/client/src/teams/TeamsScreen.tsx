import { CliIconHost } from "../CliIcon.tsx";
import { PageBody, PageHeader } from "../components/page-layout.tsx";
import type { OpenTeamTerminal } from "./TaskHistory.tsx";
import { useCallback, useEffect, useState, useRef } from "react";
import type { CliModels, HostInfo, TeamList, Team } from "@iori/protocol";
import { native } from "../native.ts";
import { connection } from "../connection.ts";
import { useCliList } from "../cli-list.ts";
import { Button } from "../components/ui/button.tsx";
import { SidebarTrigger } from "../components/ui/sidebar.tsx";
import { TeamContext } from "./context.tsx";
import { TeamEditor, type LeaveGuard } from "./TeamEditor.tsx";

export function TeamsScreen({
  host,
  active,
  t,
  language,
  registerGuard,
  registerBack,
  onOpenTerminal,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onClisChanged,
  initialPage,
  requestedTeam,
  onRequestedTeamOpened,
  entry,
}: {
  host: HostInfo;
  active: boolean;
  t: (key: string) => string;
  language: string;
  registerGuard: (guard: LeaveGuard) => void;
  registerBack: (back: () => boolean) => void;
  onOpenTerminal: OpenTeamTerminal;
  onOpenIntegrations?: (hostKey: string) => void;
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
  onClisChanged: (hostKey: string) => void;
  initialPage?: "teams" | "agents";
  requestedTeam?: { teamId: string; roleId?: string; nonce: number };
  onRequestedTeamOpened: () => void;
  entry: number;
}) {
  const {
    list,
    all,
    error: cliListError,
    reload,
  } = useCliList(host.publicKey, `${active}:${entry}`);
  const names = useRef<Record<string, string>>({});
  for (const cli of list.clis) names.current[cli.id] = cli.name;
  const [initial, setInitial] = useState<TeamList>();
  const [drafts, setDrafts] = useState<Record<string, Team>>({});
  const [failed, setFailed] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, CliModels>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>(
    {},
  );
  const modelRequests = useRef(new Map<string, Promise<void>>());
  const load = useCallback(async () => {
    try {
      const [stored, result] = await Promise.all([
        native.loadView<Record<string, Team>>(`teams:${host.publicKey}:drafts`),
        connection.requestHost(host.publicKey, "teams.list", {}),
      ]);
      if (result?.ok) {
        setDrafts(stored ?? {});
        setInitial(result.result);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [host.publicKey]);
  useEffect(() => {
    if (active && !initial) void load();
  }, [active, initial, load]);
  const loadModels = useCallback(
    (id: string) => {
      const pending = modelRequests.current.get(id);
      if (pending) return pending;
      setLoadingModels((current) => ({ ...current, [id]: true }));
      const request = (async () => {
        try {
          const result = await connection.requestHost(
            host.publicKey,
            "cli.models",
            { cliId: id },
          );
          setCatalogs((current) => ({
            ...current,
            [id]: result?.ok
              ? result.result
              : {
                  models: current[id]?.models ?? [],
                  permissions: current[id]?.permissions ?? [],
                  error: "command_failed",
                },
          }));
        } catch {
          setCatalogs((current) => ({
            ...current,
            [id]: {
              models: current[id]?.models ?? [],
              permissions: current[id]?.permissions ?? [],
              error: "command_failed",
            },
          }));
        } finally {
          modelRequests.current.delete(id);
          setLoadingModels((current) => ({ ...current, [id]: false }));
        }
      })();
      modelRequests.current.set(id, request);
      return request;
    },
    [host.publicKey],
  );
  const cliIds = list.clis.map((cli) => cli.id).join("\0");
  useEffect(() => {
    setCatalogs((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) =>
          list.clis.some((cli) => cli.id === id),
        ),
      ),
    );
    if (active) for (const cli of list.clis) void loadModels(cli.id);
  }, [active, cliIds, loadModels]);
  const refreshUsage = useCallback(() => {
    void reload(true);
  }, [reload]);
  const changed = async () => {
    await reload();
    for (const cli of list.clis) void loadModels(cli.id);
    onClisChanged(host.publicKey);
  };
  return (
    <div
      className="team-surface"
      hidden={!active}
      data-iori-teams-host={host.publicKey}
    >
      {initial ? (
        <CliIconHost.Provider value={host.publicKey}>
          <TeamContext.Provider
            value={{
              t,
              language,
              clis: list.clis,
              catalogs,
              usageClis: initial.usageClis,
              loadingModels,
              hostName: host.hostName,
              cliNames: {
                ...initial.cliNames,
                ...Object.fromEntries(
                  Object.values(drafts)
                    .flatMap((team) => [
                      team.parent,
                      ...team.roles.flatMap((role) =>
                        Object.values(role.candidates).flat(),
                      ),
                    ])
                    .filter((candidate) => candidate.cliName)
                    .map((candidate) => [candidate.cli, candidate.cliName!]),
                ),
                ...names.current,
              },
            }}
          >
            <TeamEditor
              onOpenTerminal={onOpenTerminal}
              onOpenIntegrations={onOpenIntegrations}
              onOpenWorkspaceSettings={onOpenWorkspaceSettings}
              host={host.publicKey}
              active={active}
              initial={initial}
              initialPage={initialPage}
              requestedTeam={requestedTeam}
              onRequestedTeamOpened={onRequestedTeamOpened}
              entry={entry}
              initialDrafts={drafts}
              registerGuard={registerGuard}
              registerBack={registerBack}
              onClisChanged={changed}
              onAgentsOpened={refreshUsage}
              onRetryModels={loadModels}
              cliListError={cliListError}
              onRetryClis={() => void reload()}
              allClis={all.clis}
              failedDefinitions={all.failed ?? []}
            />
          </TeamContext.Provider>
        </CliIconHost.Provider>
      ) : (
        <PageBody width="editor" className="team-content">
          <SidebarTrigger
            className="team-loading-sidebar"
            aria-label={t("Open sidebar")}
            title={t("Open sidebar")}
            data-iori-action="sidebar-toggle"
          />
          <PageHeader title={t("AI Agents/Teams")} />
          {failed && (
            <p role="alert">
              {t("Could not load teams. Retry.")}{" "}
              <Button variant="outline" onClick={() => void load()}>
                {t("Retry")}
              </Button>
            </p>
          )}
        </PageBody>
      )}
    </div>
  );
}
