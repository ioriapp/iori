import type {
  AutomationSchedule,
  AutomationRun,
  Automation,
} from "@iori/protocol";
import { localParts, resolveLocal } from "@iori/protocol";
const dayMs = 86_400_000;
/** First occurrence strictly after `after`, in the Host's named timezone. */
export function nextSchedule(
  schedule: AutomationSchedule,
  after: number,
  zone: string,
): number | undefined {
  if (schedule.kind === "manual") return undefined;
  if (schedule.kind === "once")
    return schedule.at > after ? schedule.at : undefined;
  const [hour, minute] = schedule.time.split(":").map(Number);
  const parts = localParts(after, zone);
  let local = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, hour!, minute!);
  for (;;) {
    if (
      schedule.kind === "daily" ||
      schedule.days.includes(new Date(local).getUTCDay())
    ) {
      const at = resolveLocal(local, zone);
      if (at > after) return at;
    }
    local += dayMs;
  }
}
export function missedSchedule(
  scheduledAt: number,
  now: number,
  starting: boolean,
): boolean {
  return starting
    ? scheduledAt < now
    : Math.floor(scheduledAt / 60_000) < Math.floor(now / 60_000);
}
/** All due occurrences, with at most the latest selected for execution. */
export function dueSchedules(
  automation: Automation,
  now: number,
  zone: string,
  starting: boolean,
): { at: number; reason?: AutomationRun["reason"] }[] {
  const due: { at: number; reason?: AutomationRun["reason"] }[] = [];
  let at = automation.nextAt;
  while (at !== undefined && at <= now) {
    due.push({ at, reason: automation.enabled ? "offline" : "disabled" });
    at = nextSchedule(automation.schedule, at, zone);
  }
  const last = due.at(-1);
  if (
    last &&
    automation.enabled &&
    (!missedSchedule(last.at, now, starting) || automation.missed === "latest")
  )
    delete last.reason;
  return due;
}
