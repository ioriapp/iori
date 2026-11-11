import type { CliUsage } from "@iori/protocol";

export type SavedUsage = {
  schema: 1;
  windowMinutes: number;
  weekly: { usedPercent: number; resetsAt: number };
  observedAt: number;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function savedUsage(value: unknown): SavedUsage | undefined {
  const data = record(value);
  const weekly = record(data.weekly);
  if (
    data.schema !== 1 ||
    !number(data.windowMinutes) ||
    data.windowMinutes <= 0 ||
    !number(data.observedAt) ||
    !number(weekly.usedPercent) ||
    weekly.usedPercent < 0 ||
    weekly.usedPercent > 100 ||
    !number(weekly.resetsAt)
  )
    return undefined;
  return {
    schema: 1,
    windowMinutes: data.windowMinutes,
    observedAt: data.observedAt,
    weekly: { usedPercent: weekly.usedPercent, resetsAt: weekly.resetsAt },
  };
}

export function displayUsage(
  value: unknown,
  saved: SavedUsage | undefined,
  subscription: boolean | undefined,
  now: number,
): { usage: CliUsage | undefined; saved: SavedUsage | undefined } {
  if (subscription === false) return { usage: undefined, saved: undefined };
  const data = record(value);
  const window = record(data.window);
  const weekly = record(data.weekly);
  const valid = (used: unknown): used is number =>
    number(used) && used >= 0 && used <= 100;
  const hasValue = valid(window.usedPercent) || valid(weekly.usedPercent);
  if (!hasValue && !subscription && !saved) return { usage: undefined, saved };
  const minutes =
    number(window.windowDurationMins) && window.windowDurationMins > 0
      ? window.windowDurationMins
      : hasValue
        ? 300
        : (saved?.windowMinutes ?? 300);
  const observedAt = hasValue
    ? number(data.observedAtMs)
      ? data.observedAtMs
      : now
    : (saved?.observedAt ?? now);
  const windows: CliUsage["windows"] = [];
  const add = (used: number, duration: number, reset: unknown) => {
    const expired = number(reset) && reset <= now;
    windows.push({
      remaining: expired ? 100 : 100 - used,
      minutes: duration,
      ...(number(reset) && !expired ? { resetsAt: reset } : {}),
    });
  };
  if (hasValue) {
    if (valid(window.usedPercent))
      add(window.usedPercent, minutes, window.resetsAtMs);
    if (valid(weekly.usedPercent))
      add(weekly.usedPercent, 10080, weekly.resetsAtMs);
    if (valid(weekly.usedPercent) && number(weekly.resetsAtMs))
      saved = {
        schema: 1,
        windowMinutes: minutes,
        weekly: {
          usedPercent: weekly.usedPercent,
          resetsAt: weekly.resetsAtMs,
        },
        observedAt,
      };
  } else {
    add(0, minutes, undefined);
    if (saved) add(saved.weekly.usedPercent, 10080, saved.weekly.resetsAt);
  }
  return { usage: { windows, observedAt }, saved };
}
