import type { CliUsage } from "@iori/protocol";
import { object } from "../hooks.ts";
import { runInShell } from "../shell-command.ts";
import { monitorUsageCommand } from "../usage.ts";

function datePartsAsUtc(parts: Intl.DateTimeFormatPart[]) {
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
}

function timeInUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number | undefined {
  const localTime = new Date(Date.UTC(year, month, day, hour, minute));
  if (localTime.getUTCMonth() !== month) return undefined;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-nu-latn", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
  } catch {
    return undefined;
  }
  let utcTime = localTime.getTime();
  const candidates = new Set<number>();
  while (!candidates.has(utcTime)) {
    candidates.add(utcTime);
    const formattedTime = datePartsAsUtc(
      formatter.formatToParts(new Date(utcTime)),
    );
    const nextUtcTime = utcTime + localTime.getTime() - formattedTime;
    if (nextUtcTime === utcTime) break;
    utcTime = nextUtcTime;
  }
  return datePartsAsUtc(formatter.formatToParts(new Date(utcTime))) ===
    localTime.getTime()
    ? utcTime
    : undefined;
}

/** /usage is returned as text in the CLI's JSON result, with TZ=UTC. */
export function readUsage(
  value: unknown,
  now = Date.now(),
): CliUsage | undefined {
  const text = object(value).result;
  if (typeof text !== "string") return undefined;
  const windows: CliUsage["windows"] = [];
  for (const line of text.split(/\r?\n/u)) {
    const match =
      /^Current (session|week \(([^)]+)\)): (\d+(?:\.\d+)?)% used · resets ([A-Z][a-z]{2}) (\d{1,2}), (?:(\d{4}), )?(\d{1,2})(?::(\d{2}))?(am|pm) \(([^()]+)\)$/u.exec(
        line,
      );
    if (!match) continue;
    const used = Number(match[3]);
    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].indexOf(match[4]!);
    const day = Number(match[5]),
      hour = Number(match[7]),
      minute = Number(match[8] ?? 0);
    if (
      used > 100 ||
      month < 0 ||
      day < 1 ||
      day > 31 ||
      hour < 1 ||
      hour > 12 ||
      minute > 59
    )
      continue;
    const year = match[6] ? Number(match[6]) : new Date(now).getUTCFullYear();
    const localHour = (hour % 12) + (match[9] === "pm" ? 12 : 0);
    const resetsAt = timeInUtc(year, month, day, localHour, minute, match[10]!);
    if (resetsAt === undefined) continue;
    const name = match[2] && match[2] !== "all models" ? match[2] : undefined;
    windows.push({
      remaining: 100 - used,
      minutes: match[1] === "session" ? 300 : 10080,
      resetsAt,
      ...(name
        ? {
            name,
            ...(name.toLowerCase() === "fable"
              ? {
                  modelPatterns: [
                    "fable",
                    "fable-*",
                    "claude-fable-*",
                    "claude-fable",
                  ],
                }
              : {}),
          }
        : {}),
    });
  }
  return windows.length ? { windows } : undefined;
}
export const monitorUsage = monitorUsageCommand(
  async (shell, command, signal) => {
    const result = await runInShell(
      shell,
      command +
        ' -p "/usage" --output-format json --no-session-persistence --safe-mode --strict-mcp-config',
      signal,
      undefined,
      true,
      { TZ: "UTC" },
    );
    return result.code === 0 ? readUsage(JSON.parse(result.output)) : undefined;
  },
  60000, // The CLI reports reset times with minute precision.
);
