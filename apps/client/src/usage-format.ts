/** Shared notation for provider windows and time until reset (minutes). */
export function formatUsage(
  windowMinutes: number,
  percentage: number,
  remainingMinutes?: number,
) {
  const window =
    windowMinutes >= 1440
      ? `${windowMinutes / 1440}d`
      : windowMinutes >= 60
        ? `${windowMinutes / 60}h`
        : `${windowMinutes}m`;
  const text = `${window} ${percentage}%`;
  if (remainingMinutes === undefined) return text;
  const duration =
    remainingMinutes >= 1440
      ? `${Math.floor(remainingMinutes / 1440)}d ${Math.floor((remainingMinutes % 1440) / 60)}h`
      : remainingMinutes >= 60
        ? `${Math.floor(remainingMinutes / 60)}h ${Math.floor(remainingMinutes % 60)}m`
        : `${Math.floor(remainingMinutes)}m`;
  return `${text} · resets ${duration}`;
}
