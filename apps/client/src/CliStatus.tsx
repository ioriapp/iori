import { useEffect, useState } from "react";
import type { CliStatus } from "@iori/protocol";
import { StatusDot } from "./components/StatusDot.tsx";

export function CliStateDot({
  status,
  t,
}: {
  status?: CliStatus;
  t: (key: string) => string;
}) {
  if (!status) return null;
  return (
    <StatusDot
      state={
        status.outcome === "failure"
          ? "failed"
          : status.state === "idle"
            ? "stopped"
            : status.state
      }
      animated={status.state === "active"}
      aria-label={
        status.state === "idle"
          ? "Idle"
          : status.state === "active"
            ? "Running"
            : status.state === "waiting"
              ? t("Attention")
              : status.state === "done"
                ? status.outcome === "failure"
                  ? "Failed"
                  : "Done"
                : "Stopped"
      }
    />
  );
}

export function CliElapsed({ status }: { status?: CliStatus }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!status) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status?.since]);
  if (!status) return null;
  const seconds = Math.max(0, Math.floor((now - status.since) / 1000));
  const label =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m`
        : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return (
    <time
      className="cli-elapsed"
      title={new Date(status.since).toLocaleString(
        document.documentElement.lang,
      )}
    >
      {label}
    </time>
  );
}
