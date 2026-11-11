import { useEffect } from "react";
import { connection } from "../connection.ts";

const interval = 5 * 60 * 1000;
type Clock = {
  users: number;
  lastRequest: number;
  timer?: ReturnType<typeof setTimeout>;
  visibility?: () => void;
};
// Workspaces and panes share one clock for each Host in this Client.
const clocks = new Map<string, Clock>();
function schedule(hostKey: string, clock: Clock) {
  clearTimeout(clock.timer);
  if (!clock.users || document.hidden) return;
  const remaining = interval - (Date.now() - clock.lastRequest);
  if (remaining <= 0) {
    void refreshUsage(hostKey);
    return;
  }
  clock.timer = setTimeout(() => void refreshUsage(hostKey), remaining);
}
export async function refreshUsage(hostKey: string, cliId?: string) {
  const clock = clocks.get(hostKey);
  if (clock && cliId === undefined) {
    clock.lastRequest = Date.now();
    schedule(hostKey, clock);
  }
  try {
    await connection.requestHost(
      hostKey,
      "cli.usage.refresh",
      cliId ? { cliId } : {},
    );
  } catch {
    // Older Hosts do not know this request; retain their last values.
  }
}
export function useUsageRefresh(hostKey: string, connected: boolean) {
  useEffect(() => {
    if (!hostKey || !connected) return;
    let clock = clocks.get(hostKey);
    if (!clock) {
      clock = { users: 0, lastRequest: Date.now() };
      clocks.set(hostKey, clock);
    }
    clock.users++;
    if (clock.users === 1) {
      const current = clock;
      clock.visibility = () => schedule(hostKey, current);
      document.addEventListener("visibilitychange", clock.visibility);
      schedule(hostKey, clock);
    }
    return () => {
      clock.users--;
      if (!clock.users) {
        clearTimeout(clock.timer);
        if (clock.visibility)
          document.removeEventListener("visibilitychange", clock.visibility);
      }
    };
  }, [hostKey, connected]);
}
