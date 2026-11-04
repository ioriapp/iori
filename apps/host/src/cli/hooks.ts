import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CliStatus } from "@iori/protocol";
import { notificationText } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";

export type HookPayload = Record<string, unknown>;
export type HookState = Omit<CliStatus, "since"> & {
  toolEvent?: { phase: "start" | "end"; id?: string };
};

/** Per-terminal tool lifecycle; IDs stay inside the Host. */
export class ToolActivity {
  readonly running = new Map<string, NonNullable<CliStatus["activity"]>>();
  update(next: HookState): Omit<CliStatus, "since"> {
    const { toolEvent, ...state } = next;
    if (["idle", "done", "stopped"].includes(state.state)) this.running.clear();
    if (!toolEvent) return state;
    if (!toolEvent.id) {
      this.running.clear();
      return state;
    }
    if (toolEvent.phase === "start" && state.activity?.kind === "tool") {
      this.running.delete(toolEvent.id);
      this.running.set(toolEvent.id, state.activity);
    } else if (toolEvent.phase === "end") this.running.delete(toolEvent.id);
    if (state.state === "active")
      state.activity = [...this.running.values()].at(-1) ?? {
        kind: "thinking",
      };
    return state;
  }
}
export function toolFinished(id: unknown): HookState {
  return {
    state: "active",
    activity: { kind: "thinking" },
    toolEvent: { phase: "end", ...(typeof id === "string" ? { id } : {}) },
  };
}
export interface CliObserver {
  // false preserves the observed state when an older hook is replayed.
  onHook: (payload: HookPayload) => Promise<void | false>;
  restore: (
    file: string | undefined,
    status: CliStatus | undefined,
  ) => Promise<void>;
  dispose: () => void;
}
export interface CliHooks {
  observe?: (emit: (state: HookState) => void) => CliObserver;
  env?: Record<string, string>;
  isSessionStart?: (payload: HookPayload) => boolean;
  install: (context: HookInstallContext) => Promise<void>;
  remove: (context: HookInstallContext) => Promise<void>;
  normalize: (
    payload: HookPayload,
    previous?: CliStatus,
    cwd?: string,
  ) => HookState | undefined;
  onInput?: (data: string, previous?: CliStatus) => HookState | undefined;
}
export interface HookInstallContext {
  /** The CLI whose hooks are written: iori's command carries it, and only
   * its items change in a file that other CLIs also write. */
  id: string;
  home: string;
  command: string;
  commandForEvent: (
    event: string,
    response?: Record<string, unknown>,
  ) => string;
  script: string;
  cliCommand: string;
  shell: ShellDefinition;
  signal?: AbortSignal;
  run: (script: string) => Promise<{ output: string; code: number | null }>;
  /** This Host's record of the hooks that definitions add (definition-hooks.ts).
   * Without one, definitions write no hooks. */
  writtenPath?: string;
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.slice(0, 4096)
    : undefined;
}
/** Only a command/path or the question's text is a preview; never forward raw
 * tool inputs (credentials, headers, environment or file contents). */
export function attention(
  kind: "approval" | "question",
  tool: unknown,
  input: unknown,
): HookState {
  let parsed = input;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = undefined;
    }
  }
  const fields = object(parsed);
  const question = Array.isArray(fields.questions)
    ? object(fields.questions[0]).question
    : fields.question;
  const preview =
    kind === "question"
      ? (question ?? fields.message)
      : (fields.command ?? fields.cmd ?? fields.file_path ?? fields.path);
  const summary =
    typeof preview === "string" && preview.trim()
      ? notificationText(preview)
      : undefined;
  return {
    state: "waiting",
    attention: {
      kind,
      ...(typeof tool === "string" && tool.trim()
        ? { tool: notificationText(tool) }
        : {}),
      ...(summary ? { summary } : {}),
    },
  };
}

export { HookReceiver } from "../terminal/daemon/hook-receiver.ts";

/** Select only the adapter's command, path or search preview, never raw inputs. */
export function toolActivity(
  tool: unknown,
  preview: { command?: unknown; path?: unknown; search?: unknown },
  cwd?: string,
  id?: unknown,
): HookState {
  if (typeof tool !== "string" || !tool.trim()) return { state: "active" };
  let summary: string | undefined;
  if (typeof preview.command === "string")
    summary = preview.command.split(/\r?\n/u)[0];
  else if (typeof preview.path === "string") {
    summary = preview.path;
    if (cwd) {
      const absolute = resolve(cwd, summary);
      const local = relative(cwd, absolute);
      summary =
        local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)
          ? absolute
          : local || ".";
    }
  } else if (typeof preview.search === "string") summary = preview.search;
  return {
    state: "active",
    toolEvent: { phase: "start", ...(typeof id === "string" ? { id } : {}) },
    activity: {
      kind: "tool",
      tool: notificationText(tool),
      ...(summary?.trim() ? { summary: notificationText(summary) } : {}),
    },
  };
}
export function toolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "string") return object(input);
  try {
    return object(JSON.parse(input));
  } catch {
    return {};
  }
}
export function patchPath(patch: unknown): string | undefined {
  return typeof patch === "string"
    ? /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/mu.exec(
        patch,
      )?.[1]
    : undefined;
}

/** A one-line error preview uses the same credential redaction as notifications.
 * 240 characters retains the actionable sentence; rows already ellipsize it. */
export function failureReason(...values: unknown[]): string | undefined {
  const value = values.find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (typeof value !== "string") return undefined;
  const line = notificationText(value).replace(/\s+/gu, " ").trim();
  return line.length > 240 ? line.slice(0, 239) + "…" : line;
}
export function cliFailure(...values: unknown[]): HookState {
  const failure = failureReason(...values);
  return { state: "done", outcome: "failure", ...(failure ? { failure } : {}) };
}
