// Derived from Orca hooks-json-bundle.ts, hook-events.ts and antigravity-events.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { join } from "node:path";
import { editHookFile } from "../hook-config.ts";
import { writeHooks } from "../definition-hooks.ts";
import {
  cliFailure,
  attention,
  object,
  text,
  type CliHooks,
  type HookInstallContext,
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
export const hooks: CliHooks = {
  isSessionStart: (payload) => payload.hook_event_name === "SessionStart",
  install: (ctx) => edit(ctx, true),
  remove: (ctx) => edit(ctx, false),
  normalize(payload, previous) {
    const event = payload.hook_event_name;
    const tool = object(payload.toolCall);
    if (
      event === "PreToolUse" &&
      (tool.name === "ask_question" || tool.name === "ask_permission")
    )
      return attention(
        tool.name === "ask_permission" ? "approval" : "question",
        tool.name,
        tool.args,
      );
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
