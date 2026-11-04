import {
  forgeCiState,
  type ForgeCiStatus,
  type ForgeCiStatusOf,
} from "@iori/protocol";

/** The Forge's state words, in English in both languages (forge.md). */
const ciStatusLabels: Record<Exclude<ForgeCiStatus, "other">, string> = {
  passed: "Passed",
  neutral: "Neutral",
  failed: "Failed",
  error: "Error",
  warning: "Warning",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  startup_failure: "Startup failure",
  action_required: "Action required",
  stale: "Stale",
  running: "Running",
  queued: "Queued",
  waiting: "Waiting",
  pending: "Pending",
  blocked: "Blocked",
  skipped: "Skipped",
};

/** A state's word; one iori does not know shows as the Forge wrote it. */
export function ciStatusLabel(item: ForgeCiStatusOf): string | undefined {
  return item.status === "other" ? item.word : ciStatusLabels[item.status];
}

/** How long a run, job or step took, or a running one has taken so far: "4m 51s". */
export function ciDuration(
  item: { startedAt?: number; completedAt?: number; status: ForgeCiStatus },
  now: number,
): string | undefined {
  const end =
    item.completedAt ??
    (forgeCiState(item.status) === "running" ? now : undefined);
  if (item.startedAt === undefined || end === undefined) return undefined;
  const seconds = Math.max(0, Math.floor((end - item.startedAt) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${pad(Math.floor((seconds % 3600) / 60))}m`;
}
