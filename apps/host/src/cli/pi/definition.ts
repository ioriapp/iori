import { sessionTokens } from "./session-tokens.ts";
import { models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command and launch arguments are in definition.json. Pi resumes
// by session file, which a definition's resume cannot name.
export const code: CliCode = {
  id: "pi",
  waitForBracketedPaste: true,
  modelCatalog: models,
  sessionTokens,
  observedModel: (payload) =>
    typeof payload.model === "string" ? payload.model : undefined,
  teamArguments: ({ candidate: c }, file) => [
    ...file.model,
    ...file.effort,
    ...(c.tools.length ? ["--tools", c.tools.join(",")] : []),
    ...file.instructionFile,
    ...file.prompt,
  ],
  session: (payload) =>
    typeof payload.session_id === "string" && payload.session_id.trim()
      ? {
          id: payload.session_id,
          ...(typeof payload.session_file === "string"
            ? { file: payload.session_file }
            : {}),
        }
      : undefined,
  resumeArguments: (session) =>
    session.file ? ["--session", session.file] : undefined,
  hooks,
};
