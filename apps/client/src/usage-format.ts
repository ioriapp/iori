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

export type UsagePaceInfo = {
  /** Marker position on the bar (0..100), aligned with `display`. */
  markerPercent: number;
  /** Rounded ideal percentage (0..100), aligned with `display`. */
  idealPercent: number;
  /** Whether actual usage strictly exceeds elapsed fraction (with 0 < remaining < 100). */
  overPace: boolean;
  /** Signed rounded difference `actualRounded - idealPercent` when overPace, else 0. */
  diffPercent: number;
  /** Estimated minutes until exhaustion (>= 1) when overPace and elapsed >= 15m. */
  depletionMinutes?: number;
};

export function usagePaceInfo(
  window: { minutes: number; remaining: number; resetsAt?: number },
  display: UsageDisplay,
  now = Date.now(),
): UsagePaceInfo | undefined {
  if (
    window.resetsAt === undefined ||
    !Number.isFinite(window.resetsAt) ||
    !Number.isFinite(window.minutes) ||
    window.minutes <= 0 ||
    !Number.isFinite(now)
  ) {
    return undefined;
  }
  const remainingMinutes = (window.resetsAt - now) / 60000;
  if (!(remainingMinutes > 0)) {
    return undefined;
  }
  const elapsedMinutes = window.minutes - remainingMinutes;
  if (!(elapsedMinutes >= 0)) {
    return undefined;
  }
  const expectedUsed = Math.min(
    100,
    Math.max(0, (elapsedMinutes / window.minutes) * 100),
  );
  const markerPercent =
    display === "remaining" ? 100 - expectedUsed : expectedUsed;
  const idealPercent = Math.round(markerPercent);
  const used = 100 - window.remaining;
  const overPace =
    window.remaining > 0 &&
    window.remaining < 100 &&
    elapsedMinutes > 0 &&
    used > expectedUsed;
  const actualRounded = Math.round(
    display === "remaining" ? window.remaining : used,
  );
  const diffPercent = overPace ? actualRounded - idealPercent : 0;
  let depletionMinutes: number | undefined;
  if (overPace && elapsedMinutes >= 15) {
    const depletion = elapsedMinutes * (window.remaining / used);
    if (depletion < remainingMinutes) {
      depletionMinutes = Math.max(1, Math.floor(depletion));
    }
  }
  return {
    markerPercent,
    idealPercent,
    overPace,
    diffPercent,
    ...(depletionMinutes !== undefined ? { depletionMinutes } : {}),
  };
}

export function formatUsageIdeal(
  idealPercent: number,
  language: string,
): string {
  return language.toLowerCase().startsWith("ja")
    ? `理想 ${idealPercent}%`
    : `Ideal ${idealPercent}%`;
}

export function formatUsageOverPace(
  info: UsagePaceInfo,
  language: string,
): string | undefined {
  if (!info.overPace) return undefined;
  const parts: string[] = [];
  if (info.diffPercent !== 0) {
    parts.push(`${info.diffPercent > 0 ? "+" : ""}${info.diffPercent}%`);
  }
  if (info.depletionMinutes !== undefined) {
    const duration = formatUsageDuration(info.depletionMinutes);
    parts.push(
      language.toLowerCase().startsWith("ja")
        ? `あと約 ${duration} で上限`
        : `Runs out in ~${duration}`,
    );
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
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
