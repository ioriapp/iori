import { useMemo, useSyncExternalStore } from "react";
import type { WorkspacePanelProps } from "../workspace-panel.tsx";
import { basename } from "../workspace-panel.tsx";
import { FilesPane } from "../files/FilesPane.tsx";
import { GitPane } from "../git/GitPane.tsx";
import { IssuesPane } from "../issues/IssuesPane.tsx";
import { CiPane } from "../forge/CiPane.tsx";
import { createReadingTransport } from "./transport.ts";
import { connection } from "../connection.ts";
import { native } from "../native.ts";
import {
  isSameMachineHost,
  revealInFileManagerLabelKey,
} from "./local-file-manager.ts";

/** The Files, Git, Issues and CI Views of a worktree tab, over the frame's Host connection. */
export function ReadingPanel({
  locale,
  onOpenIntegrations,
  onOpenWorkspaceSettings,
  ...props
}: WorkspacePanelProps & {
  locale: string;
  /** Recovery from a failed Forge read: the Host's Integrations settings. */
  onOpenIntegrations?: (hostKey: string) => void;
  /** Recovery from a failed Forge read: the workspace's Git settings. */
  onOpenWorkspaceSettings?: (hostKey: string, workspacePath: string) => void;
}) {
  const hostKey = props.host.publicKey;
  const clientOs = useSyncExternalStore(
    connection.subscribe,
    () => connection.getSnapshot().initial?.clientOs,
  );
  const localHostKey = useSyncExternalStore(
    connection.subscribe,
    () => connection.getSnapshot().localHostKey,
  );
  const host = useSyncExternalStore(
    connection.subscribe,
    () => connection.getSnapshot().observedHosts[hostKey] ?? props.host,
  );
  const root = props.file?.root ?? props.cwd;
  const revealInFileManager =
    clientOs &&
    isSameMachineHost({
      clientOs,
      localHostKey,
      host,
      path: props.file?.absolutePath ?? root,
    })
      ? {
          labelKey: revealInFileManagerLabelKey(clientOs),
          open: native.revealInFileManager,
        }
      : undefined;
  const transport = useMemo(() => createReadingTransport(hostKey), [hostKey]);
  const label =
    props.worktrees.find((item) => item.path === props.worktreePath)?.label ??
    basename(props.worktreePath);
  const forgeRecovery = {
    onOpenIntegrations:
      onOpenIntegrations && (() => onOpenIntegrations(hostKey)),
    onOpenWorkspaceSettings:
      onOpenWorkspaceSettings &&
      (() => onOpenWorkspaceSettings(hostKey, props.workspacePath)),
  };
  if (props.kind === "files" || props.kind === "file")
    return (
      <FilesPane
        transport={transport}
        hostKey={hostKey}
        root={root}
        revealInFileManager={revealInFileManager}
        standalone={props.file}
        openRequest={props.fileOpenRequest}
        onFileOpened={props.onFileOpened}
        onOpenFile={props.onOpenFile}
        label={label}
        worktrees={props.worktrees}
        onSelectWorktree={props.onSelectWorktree}
        locale={locale}
        visible={props.visible}
        viewState={props.viewState}
        onViewState={props.onViewState}
        onBackHandler={props.onBackHandler}
        onFileHistory={props.file ? undefined : props.onFileHistory}
        onOpenDiff={props.file ? undefined : props.onOpenDiff}
        onSendPathToTerminal={props.onSendPathToTerminal}
        onOpenTerminalInFolder={
          props.file ? undefined : props.onOpenTerminalInFolder
        }
        searchRequest={props.file ? undefined : props.workspaceSearchRequest}
        onSearchRequestShown={
          props.file ? undefined : props.onWorkspaceSearchShown
        }
      />
    );
  if (props.kind === "git")
    return (
      <GitPane
        transport={transport}
        hostKey={hostKey}
        root={props.cwd}
        label={label}
        worktrees={props.worktrees}
        onSelectWorktree={props.onSelectWorktree}
        locale={locale}
        visible={props.visible}
        viewState={props.viewState}
        onViewState={props.onViewState}
        onBackHandler={props.onBackHandler}
        fileHistoryRequest={props.fileHistoryRequest}
        onFileHistoryShown={props.onFileHistoryShown}
        diffOpenRequest={props.diffOpenRequest}
        onDiffOpened={props.onDiffOpened}
        onOpenFile={props.onOpenFile}
        agentTargets={props.agentTargets}
        onSendTextToTerminal={props.onSendTextToTerminal}
      />
    );
  if (props.kind === "issues")
    return (
      <IssuesPane
        hostKey={hostKey}
        path={props.cwd}
        locale={locale}
        visible={props.visible}
        viewState={props.viewState}
        onViewState={props.onViewState}
        onBackHandler={props.onBackHandler}
        onStartIssue={props.onStartIssue}
        {...forgeRecovery}
      />
    );
  if (props.kind === "ci")
    return (
      <CiPane
        hostKey={hostKey}
        root={props.cwd}
        label={label}
        worktrees={props.worktrees}
        onSelectWorktree={props.onSelectWorktree}
        locale={locale}
        visible={props.visible}
        viewState={props.viewState}
        onViewState={props.onViewState}
        onBackHandler={props.onBackHandler}
        openRequest={props.ciOpenRequest}
        onOpenRequestShown={props.onCiOpenShown}
        onOpenFile={props.onOpenFile}
        onOpenDiff={props.onOpenDiff}
        agentTargets={props.agentTargets}
        onSendTextToTerminal={props.onSendTextToTerminal}
        {...forgeRecovery}
      />
    );
  return null;
}
