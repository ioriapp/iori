import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import type {
  FolderHistoryItem,
  HostInfo,
  TerminalEvent,
  TerminalListResult,
  Worktree,
} from "@iori/protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";
import { connection } from "../connection.ts";
import { FolderPicker } from "../FolderPicker.tsx";
import { samePath } from "../host-path.ts";
import { worktreesOf } from "../Navigation.tsx";
import type { LeaveGuard } from "../teams/TeamEditor.tsx";
import { TeamsScreen } from "../teams/TeamsScreen.tsx";
import type { WorkspaceTarget } from "../workspace-panel.tsx";
import { WorktreeCreator } from "../WorktreeCreator.tsx";
import { WorktreeRemoval } from "../WorktreeRemoval.tsx";
import type { useWorktreeRemovalFlow } from "../worktree-removal-flow.ts";
import type { AttentionRequest, CreationTarget, TeamToOpen } from "./types.ts";

export function WorkspaceTeamsOverlays({
  openedTeams,
  teamsHost,
  teamsInitialPage,
  teamsEntry,
  teamToOpen,
  setTeamToOpen,
  teamBacks,
  teamGuards,
  terminalLists,
  language,
  t,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  onOpenAttention,
  onClisChanged,
  onLeaveTeams,
}: {
  openedTeams: HostInfo[];
  teamsHost?: HostInfo;
  teamsInitialPage?: "agents" | "teams";
  teamsEntry: number;
  teamToOpen?: TeamToOpen;
  setTeamToOpen: (value: TeamToOpen | undefined) => void;
  teamBacks: RefObject<Map<string, () => boolean>>;
  teamGuards: RefObject<Map<string, LeaveGuard>>;
  terminalLists: Record<string, TerminalListResult>;
  language: string;
  t: (key: string) => string;
  onOpenIntegrations?: (hostKey: string) => void;
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
  onOpenAttention: (item: AttentionRequest) => void;
  onClisChanged: (hostKey: string) => void;
  onLeaveTeams: () => void;
}) {
  return (
    <>
      {openedTeams.map((host) => (
        <TeamsScreen
          key={host.publicKey}
          onOpenIntegrations={onOpenIntegrations}
          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
          host={host}
          active={teamsHost?.publicKey === host.publicKey}
          t={t}
          language={language}
          initialPage={teamsInitialPage}
          entry={teamsEntry}
          onRequestedTeamOpened={() => setTeamToOpen(undefined)}
          requestedTeam={
            teamToOpen?.hostKey === host.publicKey ? teamToOpen : undefined
          }
          registerBack={(back) => {
            teamBacks.current.set(host.publicKey, back);
          }}
          registerGuard={(guard) => {
            teamGuards.current.set(host.publicKey, guard);
          }}
          onOpenTerminal={(id) => {
            const terminal = terminalLists[host.publicKey]?.terminals.find(
              (item) => item.id === id,
            );
            if (terminal) onOpenAttention({ host, terminal });
          }}
          onClisChanged={onClisChanged}
          onBack={onLeaveTeams}
        />
      ))}
    </>
  );
}

export function WorkspaceDialogs({
  terminalCloseDialog,
  removalTarget,
  setRemovalTarget,
  creationTarget,
  setCreationTarget,
  creationOpen,
  setCreationOpen,
  folderHostKey,
  setFolderHostKey,
  shellPickerOpen,
  setShellPickerOpen,
  hosts,
  selectedTarget,
  teamsHostRef,
  t,
  openTarget,
  refreshHistory,
  setVisitedTargets,
  openTeams,
  setTeamToOpen,
  applyTerminalEventFor,
  setAttentionToOpen,
  openAttention,
  leaveTeams,
  openFolder,
  shellPickerContent,
}: {
  terminalCloseDialog: ReactNode;
  removalTarget: ReturnType<typeof useWorktreeRemovalFlow>["target"];
  setRemovalTarget: (
    target: ReturnType<typeof useWorktreeRemovalFlow>["target"],
  ) => void;
  creationTarget?: CreationTarget;
  setCreationTarget: (target: CreationTarget | undefined) => void;
  creationOpen: boolean;
  setCreationOpen: (open: boolean) => void;
  folderHostKey?: string;
  setFolderHostKey: (hostKey?: string) => void;
  shellPickerOpen: boolean;
  setShellPickerOpen: (open: boolean) => void;
  hosts: HostInfo[];
  selectedTarget?: WorkspaceTarget;
  teamsHostRef: RefObject<HostInfo | undefined>;
  t: (key: string) => string;
  openTarget: (
    host: HostInfo,
    folder: FolderHistoryItem,
    worktree?: Worktree,
    rememberPrevious?: boolean,
    closeDrawer?: boolean,
  ) => void;
  refreshHistory: (hostKey: string) => Promise<void>;
  setVisitedTargets: Dispatch<SetStateAction<WorkspaceTarget[]>>;
  openTeams: (host: HostInfo, page?: "agents" | "teams") => void;
  setTeamToOpen: (value: TeamToOpen | undefined) => void;
  applyTerminalEventFor: (hostKey: string, event: TerminalEvent) => void;
  setAttentionToOpen: (item: AttentionRequest | undefined) => void;
  openAttention: (item?: AttentionRequest) => Promise<void>;
  leaveTeams: (action: () => void) => void;
  openFolder: (hostKey: string, path: string) => Promise<string | undefined>;
  shellPickerContent: ReactNode;
}) {
  return (
    <>
      {terminalCloseDialog}
      {removalTarget && (
        <WorktreeRemoval
          key={`${removalTarget.host.publicKey}:${removalTarget.path}:${removalTarget.failures ? "retry" : "initial"}`}
          {...removalTarget}
          t={t}
          onClose={() => setRemovalTarget(undefined)}
          onStarted={(paths) => {
            if (
              selectedTarget?.host.publicKey === removalTarget.host.publicKey &&
              paths.includes(selectedTarget.worktree.path)
            ) {
              openTarget(
                selectedTarget.host,
                selectedTarget.folder,
                selectedTarget.folder.worktrees?.find((item) => item.primary),
                false,
              );
            }
          }}
          onRemoved={(paths) => {
            void refreshHistory(removalTarget.host.publicKey);
            setVisitedTargets((targets) =>
              targets.filter(
                (item) =>
                  item.host.publicKey !== removalTarget.host.publicKey ||
                  !paths.includes(item.worktree.path),
              ),
            );
          }}
        />
      )}
      {creationTarget && (
        <WorktreeCreator
          key={`${creationTarget.host.publicKey}:${creationTarget.folder.workspacePath}:${creationTarget.prefill?.id ?? ""}`}
          {...creationTarget}
          open={creationOpen}
          onOpenChange={setCreationOpen}
          t={t}
          onAddCli={() => {
            setCreationOpen(false);
            openTeams(creationTarget.host, "agents");
          }}
          onOpenTeams={(teamId) => {
            setCreationOpen(false);
            setTeamToOpen(
              teamId
                ? {
                    hostKey: creationTarget.host.publicKey,
                    teamId,
                    nonce: Date.now(),
                  }
                : undefined,
            );
            openTeams(creationTarget.host, "teams");
          }}
          onStarted={(terminal, path, setupWorktree) => {
            applyTerminalEventFor(creationTarget.host.publicKey, {
              type: "terminal.created",
              terminal,
            });
            void refreshHistory(creationTarget.host.publicKey);
            const item = {
              host: creationTarget.host,
              terminal,
              started: true,
            };
            if (setupWorktree) {
              const worktree = worktreesOf(creationTarget.folder).find(
                (entry) => samePath(entry.path, path),
              ) ?? { path, detached: false, primary: false };
              const select = () => {
                setAttentionToOpen(item);
                openTarget(
                  creationTarget.host,
                  creationTarget.folder,
                  worktree,
                );
              };
              if (teamsHostRef.current) leaveTeams(select);
              else select();
            } else void openAttention(item);
            setCreationTarget(undefined);
          }}
        />
      )}
      <FolderPicker
        t={t}
        hosts={hosts}
        hostKey={folderHostKey}
        onHostChange={(hostKey) => {
          void connection.selectHost(hostKey);
          setFolderHostKey(hostKey);
        }}
        onClose={() => setFolderHostKey(undefined)}
        onOpen={openFolder}
      />
      <Dialog open={shellPickerOpen} onOpenChange={setShellPickerOpen}>
        <DialogContent
          className="folder-dialog w-[min(35rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] border border-border bg-popover shadow-md"
          data-iori-view="shell-picker"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{t("New tab")}</DialogTitle>
          </DialogHeader>
          {shellPickerContent}
        </DialogContent>
      </Dialog>
    </>
  );
}
