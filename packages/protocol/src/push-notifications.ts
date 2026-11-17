import { cliNotificationId, notificationText } from "./cli.ts";
import type { CliNotification } from "./cli.ts";
import type { FolderHistoryItem } from "./index.ts";
import type { TerminalSummary } from "./terminal.ts";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushNotificationSettings {
  subscription?: PushSubscription;
  language: "ja" | "en";
  waiting: boolean;
  done: boolean;
}
export interface PushNotificationPayload extends CliNotification {
  v: 1;
  target: { hostKey: string; terminalId: string };
}

// Based on Orca notification-options.ts; Copyright (c) 2026 Lovecast Inc.
// MIT license: ../../../apps/host/src/cli/ORCA-LICENSE.txt.
// Iterate Unicode characters so a notification never splits a surrogate pair.
export const notificationPreview = (value: string, maximum = 180) => {
  const characters = [...notificationText(value).replace(/\s+/gu, " ").trim()];
  return characters.length > maximum
    ? characters.slice(0, maximum - 1).join("") + "…"
    : characters.join("");
};

export const notificationLabels = {
  ja: {
    Failed: "失敗",
    Done: "完了",
    "Needs input": "入力待ち",
    "Waiting for approval": "承認待ち",
  },
  en: {
    Failed: "Failed",
    Done: "Done",
    "Needs input": "Needs input",
    "Waiting for approval": "Waiting for approval",
  },
};

const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) || path;

export function createCliNotification(
  hostKey: string,
  terminal: TerminalSummary,
  folders: FolderHistoryItem[],
  t: (key: keyof typeof notificationLabels.en) => string,
): CliNotification | undefined {
  const status = terminal.cliStatus;
  if (!terminal.cli || !status || !["waiting", "done"].includes(status.state))
    return undefined;
  const kind =
    status.state === "done"
      ? status.outcome === "failure"
        ? "Failed"
        : "Done"
      : status.attention?.kind === "question"
        ? "Needs input"
        : "Waiting for approval";
  const worktreePath = terminal.worktreePath ?? terminal.cwd;
  const folder = folders.find(
    (folder) =>
      folder.path === worktreePath ||
      folder.worktrees?.some((worktree) => worktree.path === worktreePath),
  );
  const context = [
    folder?.kind === "git" ? basename(folder.workspacePath) : undefined,
    basename(worktreePath),
  ]
    .filter(Boolean)
    .join(" / ");
  const target = { hostKey, terminalId: terminal.id };
  return {
    id: cliNotificationId(target),
    title: `${notificationPreview(context, 80)} - ${notificationPreview(terminal.cli.name, 40)} ${t(kind)}`,
    body: notificationPreview(
      (status.state === "done" ? status.response : status.attention?.summary) ||
        terminal.title,
    ),
    target,
  };
}
