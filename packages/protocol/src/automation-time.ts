const dayMs = 86_400_000;
export function localParts(at: number, zone: string): number[] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return ["year", "month", "day", "hour", "minute", "second"].map((key) =>
    Number(parts.find((p) => p.type === key)!.value),
  );
}
function localEpoch(parts: number[]): number {
  return Date.UTC(
    parts[0]!,
    parts[1]! - 1,
    parts[2]!,
    parts[3] ?? 0,
    parts[4] ?? 0,
    parts[5] ?? 0,
  );
}
export function resolveLocal(local: number, zone: string): number {
  // Inspect both sides of a timezone transition. In a repeated hour choose the
  // earlier occurrence; in a missing hour move forward by the clock change,
  // matching Date/Temporal's compatible disambiguation.
  const offsets = new Set(
    [-dayMs, 0, dayMs].map(
      (delta) => localEpoch(localParts(local + delta, zone)) - (local + delta),
    ),
  );
  const candidates = [...offsets]
    .map((offset) => local - offset)
    .sort((a, b) => a - b);
  const exact = candidates.find(
    (at) => localEpoch(localParts(at, zone)) === local,
  );
  return (
    exact ??
    candidates
      .filter((at) => localEpoch(localParts(at, zone)) > local)
      .sort((a, b) => a - b)[0]!
  );
}
export function automationDateTime(at: number, zone: string): string {
  const [year, month, day, hour, minute] = localParts(at, zone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
export function automationDateTimeAt(value: string, zone: string): number {
  return resolveLocal(Date.parse(value + ":00Z"), zone);
}
