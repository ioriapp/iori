import type { CliCode } from "../definition-builder.ts";

export const code: CliCode = {
  id: "kimi-code",
  teamEnvironment: (launch): Record<string, string> =>
    launch.trustWorkspace ? { KIMI_CODE_TRUST_WORKSPACE: "1" } : {},
};
