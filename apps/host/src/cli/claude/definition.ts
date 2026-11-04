import { monitorUsage } from "./usage.ts";
import { teamCommandPermissions } from "./team-permissions.ts";
import { sessionTokens } from "./session-tokens.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command, launch arguments and resume are in definition.json.
// Its managedArguments drop the user's --allowedTools and --add-dir: Claude
// Code may merge repeated values there, but that is unconfirmed; keep the
// role's tools and directories authoritative until it is.
export const code: CliCode = {
  id: "claude",
  supportsUsage: true,
  usageMonitor: monitorUsage,
  waitForBracketedPaste: true,
  modelCatalog: models,
  sessionTokens,
  teamCommandDirectory: () =>
    join(
      process.env.CLAUDE_CODE_TMPDIR ??
        (process.platform === "darwin" ? "/tmp" : tmpdir()),
      process.platform === "win32" ? "claude" : `claude-${process.getuid!()}`,
    ),
  observedModel: (payload) =>
    typeof payload.model === "string" ? payload.model : undefined,
  teamArguments: ({ commandDirectory }, file) => [
    ...file.model,
    ...file.effort,
    ...file.permission,
    ...file.instructionFile,
    ...(commandDirectory
      ? [
          "--allowedTools",
          ...teamCommandPermissions(
            commandDirectory,
            process.platform === "win32",
          ),
        ]
      : []),
    ...file.directories,
    // Variadic options must end before a prompt; resume flags remain options.
    ...file.prompt,
  ],
  session: (payload) =>
    typeof payload.session_id === "string" && payload.session_id.trim()
      ? {
          id: payload.session_id,
          ...(typeof payload.transcript_path === "string"
            ? { file: payload.transcript_path }
            : {}),
        }
      : undefined,
  hooks,
};
