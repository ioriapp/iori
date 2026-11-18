import type { CliModel } from "@iori/protocol";
import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";

export function parseQoderModels(output: string): CliModel[] {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] === "MODEL") lines.shift();
  return lines.map((line) => {
    const match = /^(.+?)\s+\(([^()]+)\)$/u.exec(line);
    if (!match) return { name: line, efforts: [] };
    const displayName = match[1]!.trim();
    const key = match[2]!.trim();
    if (key.endsWith("…")) {
      return { name: displayName, label: displayName, efforts: [] };
    }
    return { name: key, label: displayName, efforts: [] };
  });
}

export const models: ModelAdapter = async (shell, command, signal) => ({
  models: parseQoderModels(
    await modelCommand(shell, command + " --list-models", signal),
  ),
  permissions: [],
});
