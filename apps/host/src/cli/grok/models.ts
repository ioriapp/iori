import type { CliModel } from "@iori/protocol";
import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";

export function parseGrokModels(output: string): CliModel[] {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === "Available models:");
  if (start < 0) return [];
  const found: CliModel[] = [];
  for (const raw of lines.slice(start + 1)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const name = trimmed
      .replace(/^[-*]\s*/u, "")
      .replace(/\s*\(default\)$/u, "")
      .trim();
    if (name) found.push({ name, efforts: [] });
  }
  return found;
}

export const models: ModelAdapter = async (shell, command, signal) => ({
  models: parseGrokModels(
    await modelCommand(shell, command + " models", signal),
  ),
  permissions: [],
});
