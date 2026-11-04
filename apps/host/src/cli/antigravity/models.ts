import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";
export const models: ModelAdapter = async (shell, command, signal) => {
  const [output, help] = await Promise.all([
    modelCommand(shell, command + " models", signal),
    modelCommand(shell, command + " --help", signal),
  ]);
  const efforts =
    help
      .match(/--effort[^\n]*\n?[^\n]*?(low[^\n]*)/u)?.[1]
      ?.match(/\b(?:low|medium|high|xhigh|max)\b/gu) ?? [];
  return {
    models: output.split(/\r?\n/u).flatMap((line) => {
      const match = /^\s*([a-z0-9][a-z0-9._/-]*)\s+\S/u.exec(line);
      return match ? [{ name: match[1]!, efforts }] : [];
    }),
    permissions: [],
  };
};
