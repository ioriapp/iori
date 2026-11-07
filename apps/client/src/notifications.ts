import { useEffect, useRef, useState } from "react";
import type {
  HostInfo,
  TerminalListResult,
  CliNotificationTarget,
  FolderHistoryItem,
  ChildSummary,
} from "@iori/protocol";
import { native } from "./native.ts";
import { connection } from "./connection.ts";
import { isClientWindowForeground } from "./window-presence.ts";
import {
  parseCliNotificationTarget,
  cliNotificationId,
  notificationText,
} from "@iori/protocol";
import { basename } from "./workspace-panel.tsx";

// Based on Orca notification-options.ts; Copyright (c) 2026 Lovecast Inc.
// MIT license: ../../host/src/cli/ORCA-LICENSE.txt.
// Iterate Unicode characters so a notification never splits a surrogate pair.
const notificationPreview = (value: string, maximum = 180) => {
  const characters = [...notificationText(value).replace(/\s+/gu, " ").trim()];
  return characters.length > maximum
    ? characters.slice(0, maximum - 1).join("") + "…"
    : characters.join("");
};

export type NotificationPreferences = {
  notifyWaiting: boolean;
  notifyDone: boolean;
  backgroundConnection: boolean;
};

/** Observe hook states, never terminal text. Mark a displayed or disabled event
 * as handled too, so hiding a pane or enabling a switch cannot replay it. */
export function useCliNotifications(
  hosts: HostInfo[],
  lists: Record<string, TerminalListResult>,
  childrenByHost: Record<string, ChildSummary[]>,
  connectedHosts: string[],
  folders: { host: HostInfo; folder: FolderHistoryItem }[],
  preferences: NotificationPreferences | undefined,
  t: (key: string) => string,
  open: (target: CliNotificationTarget) => void,
) {
  const handled = useRef(new Map<string, string>());
  const firstChildren = useRef(new Set<string>());
  const firstLists = useRef(new Set<string>());
  const [loaded, setLoaded] = useState(false);
  const [targets, setTargets] = useState<CliNotificationTarget[]>([]);
  const saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    void native
      .loadView<unknown>("notification-seen")
      .then((saved) => {
        if (!active) return;
        if (saved && typeof saved === "object" && !Array.isArray(saved))
          for (const [key, value] of Object.entries(saved))
            if (typeof value === "string") handled.current.set(key, value);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void native
      .onNotification((value) => {
        const target = parseCliNotificationTarget(value);
        if (target) setTargets((current) => [...current, target]);
      })
      .then((listener) => {
        if (disposed) listener();
        else stop = listener;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (!connection.getSnapshot().initial || !targets.length) return;
    const waiting: CliNotificationTarget[] = [];
    for (const target of targets) {
      if (!hosts.some((host) => host.publicKey === target.hostKey)) continue;
      if (!connectedHosts.includes(target.hostKey)) {
        waiting.push(target);
        continue;
      }
      openRef.current(target);
    }
    if (waiting.length !== targets.length) setTargets(waiting);
  }, [targets, hosts, connectedHosts]);
  useEffect(() => {
    if (!preferences || !loaded || !connection.getSnapshot().initial) return;
    let changed = false;
    const prefixes = hosts.map(
      (host) => JSON.stringify([host.publicKey]).slice(0, -1) + ",",
    );
    for (const key of handled.current.keys())
      if (!prefixes.some((prefix) => key.startsWith(prefix))) {
        handled.current.delete(key);
        changed = true;
      }
    for (const host of hosts) {
      if (!connectedHosts.includes(host.publicKey)) continue;
      const list = lists[host.publicKey];
      const children = childrenByHost[host.publicKey];
      if (!list) continue;
      const prefix = JSON.stringify([host.publicKey]).slice(0, -1) + ",";
      const seed =
        !firstLists.current.has(host.publicKey) &&
        ![...handled.current.keys()].some((key) => key.startsWith(prefix));
      firstLists.current.add(host.publicKey);
      const childPrefix =
        JSON.stringify([host.publicKey, "child"]).slice(0, -1) + ",";
      const childSeed =
        children !== undefined &&
        !firstChildren.current.has(host.publicKey) &&
        ![...handled.current.keys()].some((key) => key.startsWith(childPrefix));
      if (children !== undefined) firstChildren.current.add(host.publicKey);
      const live = new Set([
        ...list.terminals.map((terminal) =>
          JSON.stringify([host.publicKey, terminal.id]),
        ),
        ...(children ?? []).map((child) =>
          JSON.stringify([host.publicKey, "child", child.id]),
        ),
      ]);
      for (const key of handled.current.keys())
        if (
          key.startsWith(prefix) &&
          !live.has(key) &&
          (children !== undefined || !key.startsWith(childPrefix))
        ) {
          handled.current.delete(key);
          changed = true;
        }
      for (const child of children ?? []) {
        if (!child.notified) continue;
        const key = JSON.stringify([host.publicKey, "child", child.id]);
        if (handled.current.has(key)) continue;
        handled.current.set(key, "candidate");
        changed = true;
        if (
          childSeed ||
          !preferences.notifyWaiting ||
          child.state !== "waiting" ||
          child.waiting !== "candidates"
        )
          continue;
        const clientState = connection.getSnapshot();
        if (
          clientState.initial?.mobile &&
          !clientState.foreground &&
          !preferences.backgroundConnection
        )
          continue;
        const displayed = [
          ...document.querySelectorAll<HTMLElement>(
            `.team-surface:not([hidden]) .team-save-header[data-iori-team-id]`,
          ),
        ].some(
          (element) =>
            element.dataset.ioriTeamId === child.teamId &&
            !!element.closest(`[data-iori-teams-host="${host.publicKey}"]`),
        );
        if (clientState.foreground && displayed && isClientWindowForeground())
          continue;
        const target = {
          hostKey: host.publicKey,
          terminalId: child.id,
          teamId: child.teamId,
        };
        void native
          .notificationPermission()
          .then((permission) => {
            if (
              permission !== "granted" ||
              !connection.getSnapshot().connectedHosts.includes(host.publicKey)
            )
              return;
            return native.notify({
              id: cliNotificationId(target),
              title: notificationPreview(
                `${child.role} · ${child.title} - ${t("No available candidate")}`,
              ),
              body: t("Set candidates in the team editor."),
              target,
            });
          })
          .catch(() => {});
      }
      for (const terminal of list.terminals) {
        const status = terminal.cliStatus;
        if (!terminal.cli || !status) continue;
        const key = JSON.stringify([host.publicKey, terminal.id]);
        const event = JSON.stringify([
          status.state,
          status.since,
          status.attention,
          ...(status.waitingSince === undefined ? [] : [status.waitingSince]),
        ]);
        const previous = handled.current.get(key);
        if (previous === event) continue;
        handled.current.set(key, event);
        changed = true;
        // A new approval/question inside one continuous wait must not alert
        // again. Keep the first OS notification; the UI still gets each event.
        // Record working/idle states too, so the next wait can alert again.
        const previousWaitingSince: unknown = previous?.startsWith(
          '["waiting",',
        )
          ? JSON.parse(previous)[3]
          : undefined;
        if (
          seed ||
          !["waiting", "done"].includes(status.state) ||
          (status.state === "waiting" &&
            previous?.startsWith('["waiting",') &&
            (status.waitingSince === undefined ||
              previousWaitingSince === status.waitingSince))
        )
          continue;
        if (
          status.state === "waiting"
            ? !preferences.notifyWaiting
            : !preferences.notifyDone
        )
          continue;
        const clientState = connection.getSnapshot();
        if (
          clientState.initial?.mobile &&
          !clientState.foreground &&
          !preferences.backgroundConnection
        )
          continue;
        const displayed = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-iori-view="terminal"][data-iori-displayed="true"]',
          ),
        ].some(
          (pane) =>
            pane.dataset.ioriTerminalId === terminal.id &&
            pane.dataset.ioriHostKey === host.publicKey,
        );
        if (clientState.foreground && displayed && isClientWindowForeground())
          continue;
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
          (entry) =>
            entry.host.publicKey === host.publicKey &&
            (entry.folder.path === worktreePath ||
              entry.folder.worktrees?.some(
                (worktree) => worktree.path === worktreePath,
              )),
        )?.folder;
        const context = [
          folder?.kind === "git" ? basename(folder.workspacePath) : undefined,
          basename(worktreePath),
        ]
          .filter(Boolean)
          .join(" / ");
        const notification = {
          id: cliNotificationId({
            hostKey: host.publicKey,
            terminalId: terminal.id,
          }),
          title: `${notificationPreview(context, 80)} - ${notificationPreview(terminal.cli.name, 40)} ${t(kind)}`,
          body: notificationPreview(
            (status.state === "done"
              ? status.response
              : status.attention?.summary) || terminal.title,
          ),
          target: { hostKey: host.publicKey, terminalId: terminal.id },
        };
        void native
          .notificationPermission()
          .then((permission) => {
            if (
              permission !== "granted" ||
              !connection.getSnapshot().connectedHosts.includes(host.publicKey)
            )
              return;
            return native.notify(notification);
          })
          .catch(() => {
            /* OS permission/settings are recovered in Notifications. */
          });
      }
    }
    if (changed) {
      const saved = Object.fromEntries(handled.current);
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(() => native.saveView("notification-seen", saved));
      void saveQueue.current.catch(() => {});
    }
  }, [
    hosts,
    lists,
    childrenByHost,
    connectedHosts,
    folders,
    preferences,
    t,
    loaded,
  ]);
}
