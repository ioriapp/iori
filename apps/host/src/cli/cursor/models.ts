import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";
export const models: ModelAdapter = async (shell, command, signal) => {
  const output = await modelCommand(shell, command + " --list-models", signal);
  const names = output.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*([a-z0-9][a-z0-9._/-]*)\s+(?:-|–|\s)\s*\S/u.exec(line);
    return match ? [match[1]!] : [];
  });
  return {
    models: names.map((name) => ({ name, efforts: [] })),
    permissions: [],
  };
};
