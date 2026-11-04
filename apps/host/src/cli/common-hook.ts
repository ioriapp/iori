import { notificationText } from "@iori/protocol";
import type { CliSession, TokenUsage } from "@iori/protocol";
import { tokenUsage } from "./definition-script.ts";
import type { HookPayload, HookState } from "./hooks.ts";

/** The JSON that a CLI's own plugin sends to the hook URL
 * (docs/design/cli-definitions.md「iori に知らせる共通の形」). The values come
 * from outside iori, so their forms are checked here. */
export interface CommonHook {
  state?: HookState;
  tokens?: TokenUsage;
  model?: string;
  session?: CliSession;
}
const states: HookState["state"][] = [
  "active",
  "waiting",
  "done",
  "stopped",
  "idle",
];
/** The displayed text is cut by `notificationText`; ids and paths keep their
 * full value. */
function value(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  return input.trim() || undefined;
}
function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}
/** What the common shape says about a Terminal, or nothing when the payload is
 * not the common shape. Unknown items are dropped. */
export function readCommonHook(payload: HookPayload): CommonHook | undefined {
  if (payload.iori !== 1) return undefined;
  const state = states.find((known) => known === payload.state);
  const attention = record(payload.attention);
  const kind =
    attention.kind === "approval" || attention.kind === "question"
      ? attention.kind
      : undefined;
  const tool = value(attention.tool);
  const response = value(payload.response);
  const failure = value(payload.failure);
  const model = value(payload.model);
  const sessionId = value(payload.sessionId);
  const transcript = value(payload.transcript);
  const usage = tokenUsage(payload.tokens);
  const next: HookState | undefined = state
    ? {
        state,
        ...(kind
          ? {
              attention: {
                kind,
                ...(tool ? { tool: notificationText(tool) } : {}),
              },
            }
          : {}),
        ...(payload.outcome === "failure"
          ? {
              outcome: "failure" as const,
              ...(failure ? { failure: notificationText(failure) } : {}),
            }
          : {}),
        ...(response ? { response: notificationText(response) } : {}),
      }
    : undefined;
  const session: CliSession | undefined = sessionId
    ? { id: sessionId, ...(transcript ? { file: transcript } : {}) }
    : undefined;
  if (!next && !usage && !model && !session) return undefined;
  return {
    ...(next ? { state: next } : {}),
    ...(usage ? { tokens: usage } : {}),
    ...(model ? { model } : {}),
    ...(session ? { session } : {}),
  };
}
