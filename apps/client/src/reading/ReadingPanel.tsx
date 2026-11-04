import { useMemo } from "react";
import type { WorkspacePanelProps } from "../workspace-panel.tsx";
import { basename } from "../workspace-panel.tsx";
import { FilesPane } from "../files/FilesPane.tsx";
import { GitPane } from "../git/GitPane.tsx";
import { IssuesPane } from "../issues/IssuesPane.tsx";
import { CiPane } from "../forge/CiPane.tsx";
import { createReadingTransport } from "./transport.ts";

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
        root={props.file?.root ?? props.cwd}
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
        {...forgeRecovery}
      />
    );
  return null;
}
