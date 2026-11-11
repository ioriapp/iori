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
