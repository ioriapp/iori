import type { ReactNode } from "react";
import type { CliSummary, HostInfo, Team, TerminalShell } from "@iori/protocol";
import { CliLauncher, type ShellStatus } from "../CliLauncher.tsx";
import { ScrollArea } from "../components/ui/scroll-area.tsx";
import { SidebarTrigger } from "../components/ui/sidebar.tsx";
import type { DropDirection } from "../DockLayout.tsx";
import type { createWorkspaceDockAdapter } from "../workspace-dock-adapter.ts";
import type { TeamToOpen } from "./types.ts";

export function WorkspaceLauncher({
  large,
  startTabId,
  launchingItem,
  reloadClis,
  currentHostKey,
  active,
  hosts,
  dock,
  shells,
  clis,
  cliError,
  defaultShellId,
  shellStatus,
  t,
  setShellPickerOpen,
  setTeamToOpen,
  openTeams,
  createTerminal,
  loadTerminals,
  chooseShell,
}: {
  large: boolean;
  startTabId?: string;
  launchingItem?: string;
  reloadClis: () => void;
  currentHostKey: string;
  active: boolean;
  hosts: HostInfo[];
  dock: ReturnType<typeof createWorkspaceDockAdapter>;
  shells: TerminalShell[];
  clis: CliSummary[];
  cliError?: boolean;
  defaultShellId?: string;
  shellStatus: ShellStatus;
  t: (key: string) => string;
  setShellPickerOpen: (open: boolean) => void;
  setTeamToOpen: (value: TeamToOpen | undefined) => void;
  openTeams: (host: HostInfo, page?: "agents" | "teams") => void;
  createTerminal: (
    shellId?: string,
    groupId?: string,
    direction?: DropDirection,
    cli?: CliSummary,
    team?: Team,
    startTabId?: string,
  ) => Promise<void>;
  loadTerminals: (hostKey: string) => Promise<void>;
  chooseShell: (shell: TerminalShell) => void;
}) {
  return (
    <CliLauncher
      pending={launchingItem}
      onOpen={reloadClis}
      hostKey={currentHostKey}
      active={active}
      onOpenTeams={(teamId) => {
        setShellPickerOpen(false);
        const host = hosts.find((item) => item.publicKey === currentHostKey);
        if (host) {
          setTeamToOpen(
            teamId
              ? { hostKey: host.publicKey, teamId, nonce: Date.now() }
              : undefined,
          );
          openTeams(host, "teams");
        }
      }}
      onTeam={(team) => {
        const pending = dock.pendingPosition;
        dock.pendingPosition = undefined;
        void createTerminal(
          undefined,
          pending?.groupId,
          pending?.direction,
          undefined,
          team,
          startTabId,
        );
      }}
      t={t}
      large={large}
      shells={shells}
      clis={clis}
      cliError={cliError}
      onCli={(cli) => {
        const pending = dock.pendingPosition;
        dock.pendingPosition = undefined;
        void createTerminal(
          undefined,
          pending?.groupId,
          pending?.direction,
          cli,
          undefined,
          startTabId,
        );
      }}
      onAddCli={() => {
        setShellPickerOpen(false);
        const host = hosts.find((item) => item.publicKey === currentHostKey);
        if (host) openTeams(host, "agents");
      }}
      defaultShellId={defaultShellId}
      status={shellStatus}
      onRetry={() => {
        if (currentHostKey) void loadTerminals(currentHostKey);
        void reloadClis();
      }}
      onShell={
        startTabId
          ? (shell) =>
              void createTerminal(
                shell.id,
                undefined,
                undefined,
                undefined,
                undefined,
                startTabId,
              )
          : chooseShell
      }
    />
  );
}

export function WorkspaceStartScreen({
  title,
  hostName,
  children,
}: {
  title: string;
  hostName: string;
  children: ReactNode;
}) {
  return (
    <ScrollArea
      type="auto"
      className="h-full min-h-0 w-full flex-1 [&_[data-slot=scroll-area-viewport]>div]:flex! [&_[data-slot=scroll-area-viewport]>div]:min-h-full"
    >
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-start gap-2 overflow-visible px-4 py-5 md:[justify-content:safe_center] md:p-8 [&>*]:shrink-0 [&_.cli-launcher]:w-full md:[&_.cli-launcher]:w-auto"
        data-iori-view="workspace-start"
      >
        <h1 className="mt-9 mb-0 font-heading text-xl font-semibold text-foreground md:mt-0">
          {title}
        </h1>
        <p className="m-0 mb-4 text-sm text-muted-foreground md:mb-5">
          {hostName}
        </p>
        {children}
      </section>
    </ScrollArea>
  );
}

export function WorkspaceEmptySurface({
  message,
  toggleLabel,
}: {
  message: string;
  toggleLabel: string;
}) {
  return (
    <>
      <SidebarTrigger
        className="absolute top-1 left-1 z-[2]"
        data-iori-action="sidebar-toggle"
        aria-label={toggleLabel}
      />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-start gap-2 overflow-auto px-4 py-5 md:[justify-content:safe_center] md:p-8 [&>*]:shrink-0">
        <p className="m-0 mb-4 text-sm text-muted-foreground md:mb-5">
          {message}
        </p>
      </section>
    </>
  );
}

export function WorkspaceInlineAlert({ children }: { children: ReactNode }) {
  return (
    <div
      className="m-2 flex items-center justify-between gap-3 rounded-md border border-status-failed-border bg-status-failed-bg/35 px-3 py-2 text-sm text-status-failed-text [&_p]:m-0"
      role="alert"
    >
      {children}
    </div>
  );
}
