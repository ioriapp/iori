import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";
export const models: ModelAdapter = async (shell, command, signal) => {
  const [output, help] = await Promise.all([
    modelCommand(shell, command + " --list-models", signal),
    modelCommand(shell, command + " --help", signal),
  ]);
  const efforts =
    help
      .match(/--thinking[^\n]*\n?[^\n]*?(off,\s*minimal[^\n]*)/u)?.[1]
      ?.match(/\b(?:off|minimal|low|medium|high|xhigh|max)\b/gu) ?? [];
  const rows = output
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter(
      (parts) =>
        parts.length >= 5 &&
        parts[0] !== "provider" &&
        /^(?:yes|no|true|false)$/iu.test(parts[4] ?? ""),
    );
  return {
    models: rows.map((parts) => ({
      name: parts[0] + "/" + parts[1],
      efforts: parts[4]?.match(/yes|true/iu) ? efforts : [],
    })),
    permissions: [
      {
        key: "tools",
        label: "Tools",
        options: ["read", "bash", "edit", "write", "grep", "find", "ls"],
        multiple: true,
      },
    ],
    permissionNote: "Pi runs without confirmation.",
  };
};
