// Derived from Orca claude-managed-hook-events.ts and claude-events.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { join } from "node:path";
import { observeTurns } from "./turn-observer.ts";
import { notificationText } from "@iori/protocol";
import { editHookFile } from "../hook-config.ts";
import { claudeSettingsTarget, writeHooks } from "../definition-hooks.ts";
import {
  cliFailure,
  toolActivity,
  toolFinished,
  toolInput,
  attention,
  object,
  text,
  type CliHooks,
} from "../hooks.ts";
const events = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "PostCompact",
  "Notification",
];
const path = (home: string) =>
  join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json");
export const hooks: CliHooks = {
  observe: observeTurns,
  isSessionStart: (payload) => payload.hook_event_name === "SessionStart",
  install: (ctx) =>
    writeHooks(ctx, claudeSettingsTarget(path(ctx.home)), events),
  remove: (ctx) =>
    editHookFile(
      path(ctx.home),
      "json",
      ctx.id,
      undefined,
      [],
      ctx.writtenPath,
    ),
  // Orca also reconciles interruption from terminal input. Claude does not
  // reliably emit a hook when an approval is declined; only clear a pending
  // decision on a plain Esc or Ctrl+C actually sent to this PTY. Kitty key-up
  // and modified Escape must not dismiss attention.
  onInput(data, previous) {
    if (
      previous?.state === "waiting" &&
      /^(?:\u001b|\u0003|\u001b\[27(?:;1(?::[12])?)?u|\u001b\[99;5(?::[12])?u)$/u.test(
        data,
      )
    )
      return { state: "idle" };
    return undefined;
  },
  normalize(payload, previous, cwd) {
    const event = payload.hook_event_name;
    const question = payload.tool_name === "AskUserQuestion";
    if (event === "Notification") {
      if (payload.notification_type === "idle_prompt")
        return {
          state: "idle",
          ...(previous?.backgroundTasks?.length
            ? { backgroundTasks: previous.backgroundTasks }
            : {}),
        };
      if (previous?.state === "waiting") return undefined;
    }
    if (event === "PreToolUse" && question)
      return attention("question", payload.tool_name, payload.tool_input);
    if (event === "PermissionRequest")
      return attention(
        question ? "question" : "approval",
        payload.tool_name,
        payload.tool_input,
      );
    if (
      event === "Notification" &&
      payload.notification_type === "permission_prompt"
    )
      return attention("approval", undefined, { message: payload.message });
    if (["PostToolUse", "PostToolUseFailure"].includes(String(event)))
      return toolFinished(payload.tool_use_id);
    if (event === "PreToolUse") {
      const tool = payload.tool_name;
      const input = payload.tool_input;
      const fields = toolInput(input);
      return toolActivity(
        tool,
        {
          command: ["Bash"].includes(String(tool)) ? fields.command : undefined,
          path: ["Read", "Edit", "Write", "NotebookEdit"].includes(String(tool))
            ? (fields.file_path ?? fields.notebook_path)
            : undefined,
          search: ["Grep", "Glob"].includes(String(tool))
            ? fields.pattern
            : undefined,
        },
        cwd,
        payload.tool_use_id,
      );
    }
    // Compaction can happen during a response; it does not end that response.
    // https://code.claude.com/docs/en/hooks#sessionstart
    if (
      event === "PostCompact" ||
      (event === "SessionStart" && payload.source === "compact")
    )
      return undefined;
    if (event === "SessionStart") return { state: "idle" };
    if (event === "SessionEnd") return { state: "stopped" };
    if (event === "StopFailure")
      return cliFailure(
        payload.last_assistant_message,
        payload.error_details,
        payload.error,
      );
    if (event === "Stop" && !object(payload).stop_hook_active) {
      // The response ended, but the CLI can wake itself when this work
      // completes. Teams use that distinction when checking for a report.
      // https://code.claude.com/docs/en/hooks#stop-input
      const backgroundTasks = Array.isArray(payload.background_tasks)
        ? payload.background_tasks.flatMap((value: unknown) => {
            const task = object(value);
            return task.status === "running"
              ? [
                  {
                    ...(typeof task.command === "string"
                      ? { command: notificationText(task.command) }
                      : {}),
                    ...(typeof task.description === "string"
                      ? { description: notificationText(task.description) }
                      : {}),
                  },
                ]
              : [];
          })
        : [];
      return {
        state: "done",
        response: text(payload.last_assistant_message),
        ...(backgroundTasks.length ? { backgroundTasks } : {}),
      };
    }
    if (
      [
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
      ].includes(String(event))
    )
      return { state: "active", activity: { kind: "thinking" } };
    return undefined;
  },
};
