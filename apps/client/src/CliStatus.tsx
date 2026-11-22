import { useEffect, useState } from "react";
import type { CliStatus } from "@iori/protocol";
import { StatusDot } from "./components/StatusDot.tsx";
import { elapsedTime } from "./teams/board-i18n.ts";

export function isStalledCliStatus(
  status?: CliStatus,
): status is CliStatus & { state: "active"; stalledSince: number } {
  return status?.state === "active" && status.stalledSince !== undefined;
}

export function useTick(active: boolean, key?: unknown) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, key]);
  return now;
}

export function stalledDescription(
  status: CliStatus | undefined,
  t: (key: string) => string,
  now: number,
) {
  if (!isStalledCliStatus(status)) return undefined;
  return `${t("Not responding")} · ${elapsedTime(now - status.stalledSince)}`;
}

export function withStalledDescription(
  label: string,
  status: CliStatus | undefined,
  t: (key: string) => string,
  now: number,
) {
  const stalled = stalledDescription(status, t, now);
  return stalled ? `${label} · ${stalled}` : label;
}

export function CliStateDot({
  status,
  t,
}: {
  status?: CliStatus;
  t: (key: string) => string;
}) {
  if (!status) return null;
  const stalled = isStalledCliStatus(status);
  const label = stalled
    ? t("Not responding")
    : status.state === "idle"
      ? t("Idle")
      : status.state === "active"
        ? t("Running")
        : status.state === "waiting"
          ? t("Attention")
          : status.state === "done"
            ? status.outcome === "failure"
              ? t("Failed")
              : t("Done")
            : t("Stopped");
  return (
    <StatusDot
      state={
        status.outcome === "failure"
          ? "failed"
          : stalled
            ? "waiting"
            : status.state === "idle"
              ? "stopped"
              : status.state
      }
      animated={status.state === "active" && !stalled}
      t={t}
      label={label}
    />
  );
}

export function CliElapsed({ status }: { status?: CliStatus }) {
  const now = useTick(Boolean(status), status?.since);
  if (!status) return null;
  return (
    <time
      className="cli-elapsed shrink-0 self-center text-xs tabular-nums text-muted-foreground"
      title={new Date(status.since).toLocaleString(
        document.documentElement.lang,
      )}
    >
      {elapsedTime(now - status.since)}
    </time>
  );
}
