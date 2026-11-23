import type { UsageDisplay } from "./usage/preferences.tsx";
/** Shared notation for provider windows and time until reset (minutes). */
export function formatUsage(
  windowMinutes: number,
  percentage: number,
  remainingMinutes?: number,
  display: UsageDisplay = "used",
) {
  const window = formatUsageLength(windowMinutes);
  const value = Math.round(
    display === "remaining" ? percentage : 100 - percentage,
  );
  const text = `${window} ${value}% ${display === "remaining" ? "left" : "used"}`;
  if (remainingMinutes === undefined) return text;
  return `${text} · resets ${formatUsageDuration(remainingMinutes)}`;
}

export function formatUsageLength(windowMinutes: number) {
  return windowMinutes >= 1440
    ? `${windowMinutes / 1440}d`
    : windowMinutes >= 60
      ? `${windowMinutes / 60}h`
      : `${windowMinutes}m`;
}

export function formatUsageDuration(remainingMinutes: number) {
  return remainingMinutes >= 1440
    ? `${Math.floor(remainingMinutes / 1440)}d ${Math.floor((remainingMinutes % 1440) / 60)}h`
    : remainingMinutes >= 60
      ? `${Math.floor(remainingMinutes / 60)}h ${Math.floor(remainingMinutes % 60)}m`
      : `${Math.floor(remainingMinutes)}m`;
}

export function usageDepletionMinutes(
  window: { minutes: number; remaining: number; resetsAt?: number },
  now = Date.now(),
): number | undefined {
  if (
    window.resetsAt === undefined ||
    !Number.isFinite(window.resetsAt) ||
    !Number.isFinite(window.minutes) ||
    window.minutes <= 0 ||
    !Number.isFinite(now)
  ) {
    return undefined;
  }
  if (!(window.remaining > 0 && window.remaining < 100)) {
    return undefined;
  }
  const remainingMinutes = (window.resetsAt - now) / 60000;
  if (!(remainingMinutes > 0)) {
    return undefined;
  }
  const elapsedMinutes = window.minutes - remainingMinutes;
  if (!(elapsedMinutes >= 15)) {
    return undefined;
  }
  const depletionMinutes =
    elapsedMinutes * (window.remaining / (100 - window.remaining));
  if (!(depletionMinutes < remainingMinutes)) {
    return undefined;
  }
  return Math.max(1, Math.floor(depletionMinutes));
}

export function formatUsagePace(
  window: { minutes: number; remaining: number; resetsAt?: number },
  language: string,
  now = Date.now(),
): string | undefined {
  const minutes = usageDepletionMinutes(window, now);
  if (minutes === undefined) return undefined;
  const duration = formatUsageDuration(minutes);
  return language.toLowerCase().startsWith("ja")
    ? `あと約 ${duration} で上限`
    : `Runs out in ~${duration}`;
}

export function formatUpdatedAt(
  at: number,
  language: string,
  now = Date.now(),
) {
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 1)
    return language.toLowerCase().startsWith("ja")
      ? "最終更新: たった今"
      : "Updated just now";
  if (minutes < 60)
    return language.toLowerCase().startsWith("ja")
      ? `最終更新: ${minutes}分前`
      : `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return language.toLowerCase().startsWith("ja")
    ? `最終更新: ${hours}時間前`
    : `Updated ${hours}h ago`;
}
