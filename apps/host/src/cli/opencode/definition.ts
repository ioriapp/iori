import { isV2, models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command, launch arguments and resume are in definition.json.
export const code: CliCode = {
  id: "opencode",
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
  launchEnvironment: (version, model, effort): Record<string, string> => {
    if (!isV2(version) || !model) return {};
    try {
      const config: unknown = JSON.parse(
        process.env.OPENCODE_CONFIG_CONTENT ?? "{}",
      );
      if (!config || typeof config !== "object" || Array.isArray(config))
        return {};
      return {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          ...config,
          model: effort ? `${model}#${effort}` : model,
        }),
      };
    } catch {
      return {};
    }
  },
  teamEnvironment: ({ teamFilesDirectory }) => ({
    IORI_TEAM_FILES_DIRECTORY: teamFilesDirectory,
  }),
  session: (payload) =>
    typeof payload.sessionID === "string" && payload.sessionID.trim()
      ? { id: payload.sessionID }
      : undefined,
  hooks,
};
