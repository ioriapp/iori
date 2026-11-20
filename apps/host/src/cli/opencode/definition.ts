import { isV2, models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
import { object } from "../hooks.ts";
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command, launch arguments and resume are in definition.json.
function existingConfig(): Record<string, unknown> {
  try {
    return object(JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}"));
  } catch {
    // The generated configuration must be valid even if the inherited JSON is not.
  }
  return {};
}
export const code: CliCode = {
  id: "opencode",
  deliversInstructions: true,
  waitForBracketedPaste: true,
  waitForInputCursor: true,
  modelCatalog: models,
  launchEffortForVersion: isV2,
  resumeWithTeamPrompt: isV2,
  launchArguments: (version) => (isV2(version) ? ["--standalone"] : []),
  teamArguments: (launch, file) => [
    ...file.permission,
    ...(isV2(launch.version) ? [] : file.model),
    ...(isV2(launch.version) ? [] : file.effort),
    ...file.instructionFile,
    ...file.directories,
    ...file.prompt,
  ],
  teamEnvironment: ({ teamFilesDirectory }) => ({
    IORI_TEAM_FILES_DIRECTORY: teamFilesDirectory,
  }),
  launchEnvironment: (launch): Record<string, string> => {
    if (!launch) return {};
    const { version, candidate, instructionFile } = launch;
    const model = isV2(version) && candidate.model;
    if (!instructionFile && !model) return {};
    const config = existingConfig();
    if (instructionFile)
      config.instructions = [
        ...(Array.isArray(config.instructions) ? config.instructions : []),
        instructionFile,
      ];
    if (model)
      config.model = candidate.effort ? `${model}#${candidate.effort}` : model;
    return { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) };
  },
  session: (payload) =>
    typeof payload.sessionID === "string" && payload.sessionID.trim()
      ? { id: payload.sessionID }
      : undefined,
  hooks,
};
