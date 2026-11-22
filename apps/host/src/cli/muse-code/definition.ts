import { readFileSync } from "node:fs";
import { models } from "./models.ts";
import { monitorUsage } from "./usage.ts";
import type { CliCode } from "../definition-builder.ts";

export const code: CliCode = {
  id: "muse-code",
  teamArguments: (launch, file) => [
    ...(launch.trustWorkspace ? ["--trust-workspace"] : []),
    ...file.model,
    ...file.effort,
    ...file.permission,
    ...file.directories,
    ...file.instructionFile,
    ...file.prompt,
  ],
  // Keep the adapter available to running sessions across Host updates.
  launchEnvironment: () => ({
    IORI_CLI_HOOK_ADAPTER: `data:text/javascript;base64,${readFileSync(new URL("./hook-adapter.mjs", import.meta.url)).toString("base64")}`,
  }),
  modelCatalog: models,
  usageMonitor: monitorUsage,
};
