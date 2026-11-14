// Derived from Orca hooks-json-bundle.ts, hook-events.ts and antigravity-events.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { join } from "node:path";
import type { CliStatus } from "@iori/protocol";
import { editHookFile } from "../hook-config.ts";
import { writeHooks } from "../definition-hooks.ts";
import {
  cliFailure,
  attention,
  object,
  text,
  type CliHooks,
  type CliObserver,
  type HookInstallContext,
  type HookState,
} from "../hooks.ts";
const events = [
  "SessionStart",
  "PreInvocation",
  "PostInvocation",
  "PreToolUse",
  "PostToolUse",
  "Stop",
];
async function edit(ctx: HookInstallContext, install: boolean) {
  const path = join(ctx.home, ".gemini", "config", "hooks.json");
  if (!install)
    return editHookFile(path, "json", ctx.id, undefined, [], ctx.writtenPath);
  await writeHooks(
    {
      ...ctx,
      commandForEvent: (event) =>
        ctx.commandForEvent(
          event,
          // Ask preserves Antigravity's permission policy; never return allow.
          event === "PreToolUse"
            ? { decision: "ask" }
            : event === "Stop"
              ? { decision: "" }
              : {},
        ),
    },
    {
      file: path,
      syntax: "json",
      namesEvent: true,
      place: {
        format: "events",
        at: ["iori-status"],
        entry: (event, command) =>
          event.includes("ToolUse")
            ? { matcher: "*", hooks: [{ type: "command", command }] }
            : { type: "command", command },
      },
    },
    events,
  );
}
type Osc7501State = "idle" | "working" | "blocked" | "done" | "failed";

const oscStates = new Set<string>([
  "idle",
  "working",
  "blocked",
  "done",
  "failed",
]);

/** Decode strict UTF-8 from standard base64; return undefined when malformed. */
function decodeBase64Utf8(raw: string): string | undefined {
  if (raw === "") return "";
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|[A-Za-z0-9+/]{4})?$/u.test(
      raw,
    )
  )
    return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(raw, "base64"),
    );
  } catch {
    return undefined;
  }
}

/** Parse Antigravity's `key=value:...` OSC 7501 payload, dropping malformed input. */
function parseOsc7501(data: string):
  | {
      state: Osc7501State;
      kind?: string;
      message?: string;
    }
  | undefined {
  if (!data) return undefined;
  const fields = new Map<string, string>();
  for (const part of data.split(":")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return undefined;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const state = fields.get("state");
  if (!state || !oscStates.has(state)) return undefined;
  const app = fields.get("app");
  if (app !== undefined && app !== "antigravity") return undefined;
  const rawMessage = fields.get("msg");
  let message: string | undefined;
  if (rawMessage !== undefined) {
    message = decodeBase64Utf8(rawMessage);
    if (message === undefined) return undefined;
  }
  return {
    state: state as Osc7501State,
    kind: fields.get("kind"),
    message,
  };
}

/** Track per-terminal OSC 7501 blocks without mixing stale non-blocked output. */
function observeOsc7501(): CliObserver {
  let oscBlocked = false;
  return {
    async onHook() {},
    onOsc(
      number: number,
      data: string,
      previous?: CliStatus,
    ): HookState | undefined {
      if (number !== 7501) return undefined;
      const parsed = parseOsc7501(data);
      if (!parsed) return undefined;
      if (parsed.state === "blocked") {
        if (parsed.kind === "permission") {
          oscBlocked = true;
          return attention(
            "approval",
            undefined,
            parsed.message !== undefined
              ? { command: parsed.message }
              : undefined,
          );
        }
        if (parsed.kind === "question") {
          oscBlocked = true;
          if (
            previous?.state === "waiting" &&
            previous.attention?.kind === "question"
          )
            return undefined;
          return attention(
            "question",
            undefined,
            parsed.message !== undefined
              ? { message: parsed.message }
              : undefined,
          );
        }
        return undefined;
      }
      if (!oscBlocked) return undefined;
      oscBlocked = false;
      if (previous?.state !== "waiting") return undefined;
      return { state: parsed.state === "working" ? "active" : "idle" };
    },
    async restore(_file, status) {
      oscBlocked = status?.state === "waiting" && !status.attention?.tool;
    },
    dispose() {},
  };
}

export const hooks: CliHooks = {
  observe: observeOsc7501,
  isSessionStart: (payload) => payload.hook_event_name === "SessionStart",
  install: (ctx) => edit(ctx, true),
  remove: (ctx) => edit(ctx, false),
  normalize(payload, previous) {
    const event = payload.hook_event_name;
    const tool = object(payload.toolCall);
    if (
      event === "PreToolUse" &&
      (tool.name === "ask_question" || tool.name === "ask_permission")
    ) {
      if (
        tool.name === "ask_question" &&
        previous?.state === "waiting" &&
        previous.attention?.kind === "question"
      )
        return undefined;
      return attention(
        tool.name === "ask_permission" ? "approval" : "question",
        tool.name,
        tool.args,
      );
    }
    if (event === "SessionStart") return { state: "idle" };
    if (
      event === "Stop" &&
      String(payload.terminationReason).toLowerCase() === "error"
    )
      return cliFailure(payload.error);
    if (event === "Stop")
      return {
        response: text(payload.last_assistant_message),
        state:
          payload.fullyIdle === false || payload.fully_idle === false
            ? "active"
            : "done",
      };
    if (
      event === "PostToolUse" &&
      (previous?.state === "done" || previous?.state === "idle")
    )
      return undefined;
    if (events.includes(String(event))) return { state: "active" };
    return undefined;
  },
};
