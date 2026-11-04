// Derived from Orca cursor hook-service.ts and cursor-events.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
import { join } from "node:path";
import { readConfig, writeConfig, editHookFile } from "../hook-config.ts";
import { writeHooks } from "../definition-hooks.ts";
import { cliFailure, text, type CliHooks } from "../hooks.ts";
// Gate hooks require permission replies. Register only observation hooks.
const events = [
  "beforeSubmitPrompt",
  "postToolUse",
  "postToolUseFailure",
  "afterAgentResponse",
  "stop",
];
export const hooks: CliHooks = {
  async install(ctx) {
    const file = join(ctx.home, ".cursor", "hooks.json");
    const config = await readConfig(file);
    if (config.version === undefined)
      await writeConfig(file, { ...config, version: 1 });
    await writeHooks(
      {
        ...ctx,
        commandForEvent: (event) =>
          ctx.commandForEvent(
            event,
            event === "beforeSubmitPrompt" ? { continue: true } : {},
          ),
      },
      {
        file,
        syntax: "json",
        namesEvent: true,
        place: {
          format: "events",
          at: ["hooks"],
          entry: (_event, command) => ({ command }),
        },
      },
      events,
    );
  },
  remove: (ctx) =>
    editHookFile(
      join(ctx.home, ".cursor", "hooks.json"),
      "json",
      ctx.id,
      undefined,
      [],
      ctx.writtenPath,
    ),
  normalize(payload, previous) {
    if (payload.hook_event_name === "stop" && payload.status === "error")
      return { ...cliFailure(), response: previous?.response };
    if (payload.hook_event_name === "stop")
      return {
        response: previous?.response,

        state:
          payload.status &&
          payload.status !== "completed" &&
          payload.status !== "error"
            ? "stopped"
            : "done",
      };
    if (
      payload.hook_event_name === "afterAgentResponse" &&
      previous?.state !== "active"
    )
      return previous?.state === "done"
        ? {
            state: "done",
            outcome: previous.outcome,
            failure: previous.failure,
            response: text(payload.text),
          }
        : undefined;
    if (events.includes(String(payload.hook_event_name)))
      return {
        state: "active",
        ...(payload.hook_event_name === "afterAgentResponse"
          ? { response: text(payload.text) }
          : {}),
      };
    return undefined;
  },
};
