import * as v from "valibot";
import { cliNotificationId, notificationText } from "./cli.ts";
import type { CliNotification } from "./cli.ts";
import type { FolderHistoryItem } from "./host-values.ts";
import type { TerminalSummary } from "./terminal.ts";

const pushSubscription = v.object({
  endpoint: v.pipe(
    v.string(),
    v.maxLength(2048),
    v.check((text) => new URL(text).protocol === "https:"),
  ),
  keys: v.object({
    // Unpadded canonical base64url for an uncompressed P-256 point and a 16-byte secret.
    p256dh: v.pipe(
      v.string(),
      v.regex(/^[A-Za-z0-9_-]{86}[AEIMQUYcgkosw048]$/u),
      v.check(
        (key) =>
          atob(key.replaceAll("-", "+").replaceAll("_", "/")).charCodeAt(0) ===
          4,
      ),
    ),
    auth: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{21}[AQgw]$/u)),
  }),
});
export const pushSettings = v.object({
  language: v.picklist(["ja", "en"]),
  waiting: v.boolean(),
  done: v.boolean(),
  subscription: v.optional(pushSubscription),
});
export type PushSubscription = v.InferOutput<typeof pushSubscription>;
export type PushNotificationSettings = v.InferOutput<typeof pushSettings>;
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
