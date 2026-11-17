import { useEffect, useRef, useState } from "react";
import { native } from "./native.ts";
import { connection, type ConnectionState } from "./connection.ts";
import type { Preferences } from "./Settings.tsx";

import type {
  PushSubscription,
  PushNotificationSettings,
} from "@iori/protocol";
type PushDistributor = Awaited<
  ReturnType<typeof native.unifiedPush.distributors>
>[number];
export type ClosedAppMode = "none" | "background" | "push";
export const closedAppMode = (preferences: {
  backgroundConnection: boolean;
  unifiedPushDistributor?: string;
}): ClosedAppMode =>
  preferences.unifiedPushDistributor
    ? "push"
    : preferences.backgroundConnection
      ? "background"
      : "none";
export type PushNotice = {
  kind: "action_required" | "network" | "removed" | "unregistered";
  app: string;
};
export type UnifiedPushSettingsState = {
  distributors: PushDistributor[];
  mode: ClosedAppMode;
  distributor?: string;
  notice?: PushNotice;
  oldHosts: string[];
  choose(mode: ClosedAppMode, distributor?: string): void;
};

export function useUnifiedPush(
  enabled: boolean,
  state: ConnectionState,
  preferences: Preferences,
  changePreferences: (
    change: Partial<Preferences>,
  ) => Promise<boolean> | undefined,
  language: string,
): UnifiedPushSettingsState {
  const [distributors, setDistributors] = useState<PushDistributor[]>([]);
  const [subscription, setSubscription] = useState<PushSubscription>();
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<PushNotice>();
  const [pending, setPending] = useState<string>();
  const current = useRef({ preferences, changePreferences, distributors });
  current.current = { preferences, changePreferences, distributors };
  const selection = useRef<string | undefined>(
    preferences.unifiedPushDistributor,
  );
  const previous = useRef<
    | Pick<Preferences, "backgroundConnection" | "unifiedPushDistributor">
    | undefined
  >(undefined);
  const previousSubscription = useRef<PushSubscription | undefined>(undefined);
  const operation = useRef(0);
  const nativeQueue = useRef(Promise.resolve());
  const enqueue = (action: () => Promise<void>) => {
    const next = nativeQueue.current.catch(() => {}).then(action);
    nativeQueue.current = next;
    return next;
  };
  const nameOf = (id?: string) =>
    current.current.distributors.find((item) => item.id === id)?.name ??
    id ??
    "";
  const rollback = (persist = true) => {
    const saved = previous.current ?? {
      backgroundConnection: false,
      unifiedPushDistributor: undefined,
    };
    previous.current = undefined;
    selection.current = saved.unifiedPushDistributor;
    setPending(undefined);
    setSubscription(previousSubscription.current);
    previousSubscription.current = undefined;
    if (!persist) return;
    void current.current.changePreferences(saved);
    const distributor = saved.unifiedPushDistributor;
    void enqueue(() =>
      distributor
        ? native.unifiedPush.register(distributor)
        : native.unifiedPush.unregister(),
    ).catch(() => {});
  };
  const turnOff = (kind: "removed" | "unregistered") => {
    const selected = selection.current;
    if (!selected) return;
    operation.current++;
    setNotice({ kind, app: nameOf(selected) });
    selection.current = undefined;
    previous.current = undefined;
    setPending(undefined);
    setSubscription(undefined);
    void current.current.changePreferences({
      backgroundConnection: false,
      unifiedPushDistributor: undefined,
    });
    void enqueue(() => native.unifiedPush.unregister()).catch(() => {});
  };
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const stops: (() => void)[] = [];
    selection.current = current.current.preferences.unifiedPushDistributor;
    const refresh = async () => {
      const revision = operation.current;
      const [apps, saved] = await Promise.all([
        native.unifiedPush.distributors(),
        native.unifiedPush.state(),
      ]);
      if (!active) return;
      setDistributors(apps);
      current.current.distributors = apps;
      const selected = selection.current;
      setReady(true);
      if (!selected || revision !== operation.current) return;
      if (!apps.some((app) => app.id === selected)) turnOff("removed");
      else if (previous.current) return;
      else if (saved.distributor === selected)
        setSubscription(saved.subscription);
      else if (!saved.distributor) turnOff("unregistered");
    };
    void (async () => {
      const apps = await native.unifiedPush.distributors();
      if (!active) return;
      setDistributors(apps);
      current.current.distributors = apps;
      if (
        selection.current &&
        !apps.some((app) => app.id === selection.current)
      )
        turnOff("removed");
      const stop = await native.onUnifiedPush((event) => {
        if (!active || !selection.current) return;
        if (event.kind === "endpoint") {
          operation.current++;
          previousSubscription.current = undefined;
          setReady(true);
          setSubscription(event.subscription);
          setPending(undefined);
          previous.current = undefined;
          setNotice(undefined);
        } else if (event.kind === "unregistered") {
          turnOff("unregistered");
        } else {
          if (["action_required", "network"].includes(event.reason))
            setNotice({
              kind: event.reason as "action_required" | "network",
              app: nameOf(selection.current),
            });
          rollback();
        }
      });
      if (!active) {
        stop();
        return;
      }
      stops.push(stop);
      const foregroundStop = await native.onForeground((foreground) => {
        if (foreground) void refresh().catch(() => {});
      });
      if (!active) {
        foregroundStop();
        return;
      }
      stops.push(foregroundStop);
      await refresh();
    })().catch(() => {});
    return () => {
      active = false;
      for (const stop of stops) stop();
    };
  }, [enabled]);

  const sent = useRef(new Map<string, string>());
  const hostQueues = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    if (!enabled || !ready) return;
    const params: PushNotificationSettings = {
      ...(preferences.unifiedPushDistributor && subscription
        ? { subscription }
        : {}),
      language: language.toLowerCase().startsWith("ja") ? "ja" : "en",
      waiting: preferences.notifyWaiting,
      done: preferences.notifyDone,
    };
    for (const key of sent.current.keys())
      if (!state.connectedHosts.includes(key)) sent.current.delete(key);
    for (const host of state.initial?.hosts ?? []) {
      const key = host.publicKey;
      const observed = state.observedHosts[key];
      const id = connection.connectionIdOf(key);
      if (
        !state.connectedHosts.includes(key) ||
        !observed?.pushNotifications ||
        !id
      )
        continue;
      const signature = JSON.stringify([id, params]);
      if (sent.current.get(key) === signature) continue;
      sent.current.set(key, signature);
      const next = (hostQueues.current.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          if (
            !connection.getSnapshot().connectedHosts.includes(key) ||
            connection.connectionIdOf(key) !== id
          )
            return;
          const result = await connection.requestHost(
            key,
            "notifications.push.set",
            params,
          );
          if (!result?.ok) throw new Error("Push registration failed");
        });
      hostQueues.current.set(key, next);
      void next.catch(() => {
        if (sent.current.get(key) === signature) sent.current.delete(key);
      });
    }
  }, [
    enabled,
    ready,
    preferences.unifiedPushDistributor,
    subscription,
    preferences.notifyWaiting,
    preferences.notifyDone,
    language,
    state.connectedHosts,
    state.initial?.hosts,
    state.observedHosts,
  ]);

  const choose = (mode: ClosedAppMode, distributor?: string) => {
    const selected = distributor ?? distributors[0]?.id;
    if (mode === "push" && (!selected || pending === selected)) return;
    const revision = ++operation.current;
    setNotice(undefined);
    if (mode !== "push") {
      selection.current = undefined;
      previous.current = undefined;
      setPending(undefined);
      setSubscription(undefined);
      void (async () => {
        const saved = await changePreferences({
          backgroundConnection: mode === "background",
          unifiedPushDistributor: undefined,
        });
        if (revision !== operation.current) return;
        if (saved) await enqueue(() => native.unifiedPush.unregister());
        else {
          selection.current = preferences.unifiedPushDistributor;
          setSubscription(subscription);
        }
      })().catch(() => {});
      return;
    }
    if (!selected) return;
    previousSubscription.current = subscription;
    previous.current = {
      backgroundConnection: preferences.backgroundConnection,
      unifiedPushDistributor: preferences.unifiedPushDistributor,
    };
    selection.current = selected;
    setPending(selected);
    void (async () => {
      const permission = await native.notificationPermission();
      const granted =
        permission === "granted" ||
        (await native.requestNotificationPermission()) === "granted";
      if (revision !== operation.current) return;
      if (!granted) {
        rollback(false);
        return;
      }
      setSubscription(undefined);
      const saved = await changePreferences({
        backgroundConnection: false,
        unifiedPushDistributor: selected,
        notificationPrompted: true,
      });
      if (revision !== operation.current) return;
      if (!saved) {
        rollback(false);
        return;
      }
      await enqueue(() => native.unifiedPush.register(selected));
    })().catch(() => {
      if (revision === operation.current) rollback();
    });
  };
  return {
    distributors,
    mode: pending ? "push" : closedAppMode(preferences),
    distributor: pending ?? preferences.unifiedPushDistributor,
    notice,
    oldHosts:
      preferences.unifiedPushDistributor || pending
        ? (state.initial?.hosts ?? [])
            .filter((host) => {
              const observed = state.observedHosts[host.publicKey];
              return observed && !observed.pushNotifications;
            })
            .map((host) => host.hostName)
        : [],
    choose,
  };
}
