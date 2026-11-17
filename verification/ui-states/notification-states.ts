import type { UnifiedPushSettingsState } from "../../apps/client/src/unified-push.ts";

export const allStates = [
  {
    id: "push-missing-none",
    label: "アプリなし・受け取らない",
    reference: "1-{theme}-390.png",
  },
  {
    id: "push-missing-background",
    label: "アプリなし・バックグラウンドで接続を維持",
    reference: "2-{theme}-390.png",
  },
  { id: "push-single", label: "アプリが1つ", reference: "3-{theme}-390.png" },
  { id: "push-multiple", label: "アプリが2つ", reference: "4-{theme}-390.png" },
  {
    id: "push-multiple-open",
    label: "アプリの選択",
    reference: "4-open-{theme}-390.png",
  },
  {
    id: "push-permission-pending",
    label: "OSの許可を求めている間",
    reference: "5-{theme}-390.png",
  },
  {
    id: "push-permission-denied",
    label: "拒否されて前の選択へ戻った",
    reference: "6-{theme}-390.png",
  },
  {
    id: "push-registration-app",
    label: "登録失敗・アプリでの操作が必要",
    reference: "7-{theme}-390.png",
  },
  {
    id: "push-registration-network",
    label: "登録失敗・ネットワークなし",
    reference: "8-{theme}-390.png",
  },
  {
    id: "push-removed",
    label: "アプリが削除された",
    reference: "9-{theme}-390.png",
  },
  {
    id: "push-revoked",
    label: "登録が解除された",
    reference: "10-{theme}-390.png",
  },
  { id: "push-host-old", label: "古いHost", reference: "14-{theme}-390.png" },
];
export function notificationSettingsFixture(
  id: string,
): UnifiedPushSettingsState {
  const missing = id.includes("missing") || id === "push-removed";
  const background =
    id.includes("background") ||
    id === "push-permission-denied" ||
    id.startsWith("push-registration-");
  const mode = missing
    ? background
      ? "background"
      : "none"
    : background
      ? "background"
      : id === "push-revoked"
        ? "none"
        : "push";
  return {
    distributors: missing
      ? []
      : [
          { id: "ntfy", name: "ntfy" },
          ...(id.includes("multiple") ? [{ id: "sunup", name: "Sunup" }] : []),
        ],
    mode,
    distributor: mode === "push" ? "ntfy" : undefined,
    notice:
      id === "push-removed"
        ? { kind: "removed", app: "ntfy" }
        : id === "push-revoked"
          ? { kind: "unregistered", app: "ntfy" }
          : id === "push-registration-app"
            ? { kind: "action_required", app: "ntfy" }
            : id === "push-registration-network"
              ? { kind: "network", app: "ntfy" }
              : undefined,
    oldHosts: id === "push-host-old" ? ["自宅PC"] : [],
    choose() {},
  };
}
