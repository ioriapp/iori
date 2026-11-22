import type { CliCode } from "../definition-builder.ts";

export const code: CliCode = {
  id: "vibe",
  teamArguments: (launch, file) => [
    ...(launch.trustWorkspace ? ["--trust"] : []),
    ...file.model,
    ...file.effort,
    ...file.permission,
    ...file.directories,
    ...file.instructionFile,
    ...file.prompt,
  ],
};
