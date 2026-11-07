export type CliUsage = {
  windows: {
    remaining: number;
    minutes: number;
    resetsAt?: number;
    name?: string;
    /** Adapter-owned model ID patterns. Only * is a wildcard. Named windows
     * without a matching pattern are display-only. */
    modelPatterns?: string[];
  }[];
};
/** A Host/CLI may send a malformed window; keep only complete usable windows. */
export function parseCliUsage(value: unknown): CliUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.windows)) return undefined;
  const windows: CliUsage["windows"] = [];
  for (const value of input.windows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const window = value as Record<string, unknown>;
    if (
      typeof window.remaining !== "number" ||
      !Number.isFinite(window.remaining) ||
      window.remaining < 0 ||
      window.remaining > 100 ||
      typeof window.minutes !== "number" ||
      !Number.isFinite(window.minutes) ||
      window.minutes <= 0 ||
      (window.resetsAt !== undefined &&
        (typeof window.resetsAt !== "number" ||
          !Number.isFinite(window.resetsAt)))
    )
      continue;
    if (
      (window.name !== undefined && typeof window.name !== "string") ||
      (window.modelPatterns !== undefined &&
        (!Array.isArray(window.modelPatterns) ||
          !window.modelPatterns.every(
            (pattern) => typeof pattern === "string",
          )))
    )
      continue;
    windows.push({
      ...(typeof window.name === "string" ? { name: window.name } : {}),
      ...(Array.isArray(window.modelPatterns)
        ? { modelPatterns: window.modelPatterns as string[] }
        : {}),
      remaining: window.remaining,
      minutes: window.minutes,
      ...(typeof window.resetsAt === "number"
        ? { resetsAt: window.resetsAt }
        : {}),
    });
  }
  return windows.length ? { windows } : undefined;
}
export function usageAppliesToModel(
  window: CliUsage["windows"][number],
  model: string,
): boolean {
  if (!window.name) return true;
  return !!window.modelPatterns?.some((pattern) => {
    const parts = pattern.split("*");
    let rest = model.toLowerCase();
    if (!rest.startsWith(parts[0]!)) return false;
    rest = rest.slice(parts[0]!.length);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      if (i === parts.length - 1) return rest.endsWith(part);
      const position = rest.indexOf(part);
      if (position < 0) return false;
      rest = rest.slice(position + part.length);
    }
    return rest === "";
  });
}
export function belowUsageMinimum(
  minimum: string,
  usage?: CliUsage,
  model = "",
): boolean {
  return (
    minimum !== "" &&
    !!usage?.windows.some(
      (window) =>
        usageAppliesToModel(window, model) &&
        window.remaining < Number(minimum),
    )
  );
}
/** CLI identity and its icon are supplied by the Host's CLI definition. */
export interface CliSummary {
  /** Only the CLI list carries picker visibility. */
  hidden?: boolean;
  id: string;
  name: string;
  /** Bundled asset names, or content hashes read from the authenticated Host. */
  icon?: { light: string; dark?: string; source?: "host" };
  /** The definition has an icon that the user can reset. */
  customIcon?: boolean;
  version?: string;
  supportsUsage?: boolean;
  usage?: CliUsage;
  startupArguments?: string;
  /** Only the CLI list carries where the definition comes from. */
  source?: import("./cli-definitions.ts").CliDefinitionSource;
  /** A user's definition whose command this Host does not find. It is only
   * listed for the AI agents screen and cannot be launched. */
  missing?: boolean;
  support?: Record<
    import("./cli-definitions.ts").CliFeature,
    import("./cli-definitions.ts").CliSupport
  >;
  /** The JSON of the definition in use, for editing it. */
  definition?: string;
  /** Present when the definition was made from the name and command. */
  simple?: import("./cli-definitions.ts").CliSimpleDefinition;
}
export interface CliListResult {
  clis: (CliSummary & { hidden: boolean })[];
  shell?: string;
  lastUsedId?: string;
  /** Definitions in `cli-definitions/` that are not read, and why. */
  failed?: import("./cli-definitions.ts").CliDefinitionFailure[];
}

/** CLI-owned identity used to resume; conversation content remains in the CLI. */
export interface CliSession {
  id: string;
  file?: string;
}

/** Live hook state. It belongs to this Host process, never to saved sessions. */
export interface CliStatus {
  state: "active" | "waiting" | "done" | "stopped" | "idle";
  since: number;
  /** Beginning of the current continuous wait, independent of its contents. */
  waitingSince?: number;
  /** Latest assistant text from a CLI hook, kept only in this live state. */
  response?: string;
  outcome?: "failure";
  failure?: string;
  /** Work still running after a CLI response, as reported by its hooks. */
  backgroundTasks?: { command?: string; description?: string }[];
  activity?:
    { kind: "thinking" } | { kind: "tool"; tool: string; summary?: string };
  attention?: {
    kind: "approval" | "question";
    tool?: string;
    summary?: string;
  };
}

export function parseCliStatus(value: unknown): CliStatus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const state = input.state;
  if (
    state !== "active" &&
    state !== "waiting" &&
    state !== "done" &&
    state !== "stopped" &&
    state !== "idle"
  )
    return undefined;
  if (typeof input.since !== "number") return undefined;
  let attention: CliStatus["attention"];
  if (
    state === "waiting" &&
    input.attention &&
    typeof input.attention === "object"
  ) {
    const item = input.attention as Record<string, unknown>;
    if (item.kind === "approval" || item.kind === "question") {
      attention = {
        kind: item.kind,
        ...(typeof item.tool === "string"
          ? { tool: item.tool.slice(0, 4096) }
          : {}),
        ...(typeof item.summary === "string"
          ? { summary: item.summary.slice(0, 4096) }
          : {}),
      };
    }
  }
  const item =
    input.activity && typeof input.activity === "object"
      ? (input.activity as Record<string, unknown>)
      : undefined;
  const activity: CliStatus["activity"] =
    state !== "active"
      ? undefined
      : item?.kind === "thinking"
        ? { kind: "thinking" }
        : item?.kind === "tool" && typeof item.tool === "string"
          ? {
              kind: "tool",
              tool: item.tool.slice(0, 4096),
              ...(typeof item.summary === "string"
                ? { summary: item.summary.slice(0, 4096) }
                : {}),
            }
          : undefined;
  return {
    state,
    since: input.since,
    ...(state === "waiting" &&
    typeof input.waitingSince === "number" &&
    Number.isFinite(input.waitingSince)
      ? { waitingSince: input.waitingSince }
      : {}),
    ...(Array.isArray(input.backgroundTasks)
      ? {
          backgroundTasks: input.backgroundTasks.flatMap((task: unknown) => {
            if (!task || typeof task !== "object") return [];
            const item = task as Record<string, unknown>;
            return [
              {
                ...(typeof item.command === "string"
                  ? { command: item.command }
                  : {}),
                ...(typeof item.description === "string"
                  ? { description: item.description }
                  : {}),
              },
            ];
          }),
        }
      : {}),
    ...(activity ? { activity } : {}),
    ...(attention ? { attention } : {}),
    ...(typeof input.response === "string"
      ? { response: input.response.slice(0, 4096) }
      : {}),
    ...(input.outcome === "failure" ? { outcome: "failure" as const } : {}),
    ...(typeof input.failure === "string"
      ? { failure: notificationText(input.failure) }
      : {}),
  };
}

/** Local OS notification routing; IDs are never inferred from titles or paths. */
export interface CliNotificationTarget {
  hostKey: string;
  terminalId: string;
  teamId?: string;
}
export interface CliNotification {
  id: number;
  title: string;
  body: string;
  target: CliNotificationTarget;
}

/** Stable Android notification ID; 1 belongs to the connection service. */
export function cliNotificationId(target: CliNotificationTarget): number {
  let hash = 2166136261;
  for (const character of JSON.stringify([target.hostKey, target.terminalId]))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return 2 + ((hash >>> 0) % 2147483646);
}

/** Text exposed in OS notifications: strip controls and redact credentials. */
export function notificationText(value: string): string {
  return value
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(
      /((?:token|password|secret|api[_-]?key|authorization)(?:\s*[=:]\s*|\s+)|Bearer\s+)(?:"[^"]*"|'[^']*'|\S+)/giu,
      "$1[redacted]",
    )
    .slice(0, 4096);
}

/** Notification targets can arrive through an external OS protocol URL. */
export function parseCliNotificationTarget(
  value: unknown,
): CliNotificationTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.hostKey !== "string" ||
    !/^[0-9a-fA-F]{64}$/u.test(input.hostKey) ||
    typeof input.terminalId !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(
      input.terminalId,
    )
  )
    return undefined;
  if (
    input.teamId !== undefined &&
    (typeof input.teamId !== "string" ||
      !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(
        input.teamId,
      ))
  )
    return undefined;
  return {
    ...(typeof input.teamId === "string"
      ? { teamId: input.teamId.toLowerCase() }
      : {}),
    hostKey: input.hostKey.toLowerCase(),
    terminalId: input.terminalId.toLowerCase(),
  };
}
