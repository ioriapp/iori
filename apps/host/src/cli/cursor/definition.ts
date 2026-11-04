import { models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command, launch arguments and resume are in definition.json.
export const code: CliCode = {
  id: "cursor",
  // Cursor CLI has no means to tell others that it waits for approval
  // (architecture.md「承認待ちと状態」).
  unavailable: ["attention"],
  modelCatalog: models,
  session: (payload) =>
    typeof payload.conversation_id === "string" &&
    payload.conversation_id.trim()
      ? { id: payload.conversation_id }
      : undefined,
  hooks,
};
