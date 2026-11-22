import type { HookState } from "../cli/hooks.ts";
import type { TeamChild } from "./records.ts";

export function childHasEnded(state: TeamChild["state"]): boolean {
  return state === "finished" || state === "stopped" || state === "failed";
}

export function responseAfterCliState(
  child: TeamChild,
  status: HookState,
): TeamChild["parentResponse"] {
  if (status.state === "active" && child.parentResponse === "pending")
    return "active";
  if (
    child.parentResponse === "active" &&
    child.state === "running" &&
    (status.state === "idle" || status.state === "done") &&
    !status.backgroundTasks?.length &&
    status.outcome !== "failure"
  )
    return "unreported";
  return child.parentResponse;
}

export function childAfterExit(
  state: TeamChild["state"],
  reason: "user" | "exit",
): Partial<TeamChild> | undefined {
  if (childHasEnded(state)) return;
  if (reason === "user") return { state: "stopped", stoppedBy: "user" };
  if (state === "reported") return { state: "stopped", stoppedBy: undefined };
  return { state: "failed", failure: "CLI exited without a report." };
}

export function childAfterStart(child: TeamChild, at: number) {
  return {
    state: "running" as const,
    startedAt: at,
    firstStartedAt: child.firstStartedAt ?? at,
    endedAt: undefined,
    waiting: undefined,
    stoppedBy: undefined,
  };
}

export function needsResume(state: TeamChild["state"], cliRunning: boolean) {
  return (state === "stopped" || state === "failed") && !cliRunning;
}
