import { otherHostUses } from "../hook-hosts.ts";
import { observeTurns } from "./turn-observer.ts";
import { removeHookFile } from "../hook-files.ts";
// Derived from Orca codex-hook-definition.ts and codex-events.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { editHookFile, writeText } from "../hook-config.ts";
import { claudeSettingsTarget, writeHooks } from "../definition-hooks.ts";
import {
  toolActivity,
  toolFinished,
  toolInput,
  patchPath,
  attention,
  text,
  type CliHooks,
} from "../hooks.ts";
import { trustHooks, removeTrust } from "./hook-trust.ts";
const events = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Stop",
  "Interrupt",
];
const homePath = (home: string) =>
  process.env.CODEX_HOME ?? join(home, ".codex");
export const hooks: CliHooks = {
  observe: observeTurns,
  isSessionStart: (payload) => payload.hook_event_name === "SessionStart",
  env: {
    IORI_CLI_HOOK_ADAPTER: pathToFileURL(
      join(homedir(), ".iori", "hooks", "iori-codex-transcript.mjs"),
    ).href,
  },
  async install(ctx) {
    const directory = homePath(ctx.home);
    await writeText(
      join(ctx.home, ".iori", "hooks", "iori-codex-transcript.mjs"),
      await readFile(new URL("./hook-transcript.mjs", import.meta.url), "utf8"),
    );
    await writeHooks(
      ctx,
      claudeSettingsTarget(join(directory, "hooks.json")),
      events,
    );
    await trustHooks(ctx, directory);
  },
  async remove(ctx) {
    const directory = homePath(ctx.home);
    await editHookFile(
      join(directory, "hooks.json"),
      "json",
      ctx.id,
      undefined,
      [],
      ctx.writtenPath,
    );
    if (
      ctx.writtenPath &&
      (await otherHostUses(dirname(ctx.writtenPath), ctx.id))
    )
      return;
    await removeTrust(directory);
    await removeHookFile(
      join(ctx.home, ".iori", "hooks", "iori-codex-transcript.mjs"),
    );
  },
  normalize(payload, _previous, cwd) {
    const event = payload.hook_event_name;
    const tool = payload.tool_name ?? payload.name;
    const input = payload.tool_input ?? payload.input ?? payload.arguments;
    if (
      event === "PreToolUse" &&
      ["request_user_input", "ask_user_question"].includes(String(tool))
    )
      return attention("question", tool, input);
    if (event === "PermissionRequest") {
      if (
        payload.approvals_reviewer === "auto_review" ||
        payload.approvals_reviewer === "guardian_subagent"
      )
        return { state: "active" };
      return attention("approval", tool, input);
    }
    if (event === "PostToolUse") return toolFinished(payload.tool_use_id);
    if (event === "PreToolUse") {
      const fields = toolInput(input);
      return toolActivity(
        tool,
        {
          command: ["Bash", "exec_command", "shell", "shell_command"].includes(
            String(tool),
          )
            ? (fields.cmd ?? fields.command)
            : undefined,
          path:
            tool === "apply_patch"
              ? patchPath(
                  typeof input === "string"
                    ? input
                    : (fields.command ?? fields.patch ?? fields.input),
                )
              : undefined,
        },
        cwd,
        payload.tool_use_id,
      );
    }
    if (event === "SessionStart") return { state: "idle" };
    if (event === "Stop")
      return { state: "done", response: text(payload.last_assistant_message) };
    if (event === "Interrupt") return { state: "stopped" };
    if (
      ["UserPromptSubmit", "PreToolUse", "PostToolUse"].includes(String(event))
    )
      return { state: "active", activity: { kind: "thinking" } };
    return undefined;
  },
};
