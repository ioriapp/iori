import { models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command, launch arguments, the first instruction and resume are
// in definition.json.
export const code: CliCode = {
  id: "antigravity",
  // Later team input is pasted once the prompt enables bracketed paste.
  waitForBracketedPaste: true,
  modelCatalog: models,
  session: (payload) =>
    typeof payload.conversationId === "string" && payload.conversationId.trim()
      ? { id: payload.conversationId }
      : undefined,
  hooks,
  // Antigravity asks to trust each new folder before it reads input, which
  // would hold a child in a worktree that iori created for it. The trust is
  // for this launch only; Antigravity's own settings stay as they are.
  teamArguments: (launch, file) => [
    ...file.model,
    ...file.effort,
    ...file.permission,
    ...file.directories,
    ...file.instructionFile,
    ...(launch.createdWorktree && launch.cwd
      ? ["--settings", JSON.stringify({ trustedWorkspaces: [launch.cwd] })]
      : []),
    ...file.prompt,
  ],
};
