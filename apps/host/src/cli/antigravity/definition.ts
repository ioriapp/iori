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
  deliversInstructions: true,
  launchEnvironment: (launch): Record<string, string> => ({
    AGY_CLI_OSC7501: "on",
    ...(!launch?.resume && launch?.instructionFile
      ? {
          IORI_CLI_HOOK_INSTRUCTION_FILE: launch.instructionFile,
          IORI_CLI_HOOK_INSTRUCTION_CLI: "antigravity",
          IORI_CLI_HOOK_INSTRUCTION_EVENT: "SessionStart",
          IORI_CLI_HOOK_INSTRUCTION_FORMAT: "inject-steps",
        }
      : {}),
  }),
  modelCatalog: models,
  session: (payload) =>
    typeof payload.conversationId === "string" && payload.conversationId.trim()
      ? { id: payload.conversationId }
      : undefined,
  hooks,
  // Antigravity asks to trust each new folder before it reads input, which
  // would hold a team child in its workspace. The trust is for this launch
  // only; Antigravity's own settings stay as they are.
  teamArguments: (launch, file) => [
    ...file.model,
    ...file.effort,
    ...file.permission,
    ...file.directories,
    ...file.instructionFile,
    ...(launch.cwd && launch.trustWorkspace
      ? ["--settings", JSON.stringify({ trustedWorkspaces: [launch.cwd] })]
      : []),
    ...file.prompt,
  ],
};
