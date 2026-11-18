import type { CliModel } from "@iori/protocol";
import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";

export function parseCodebuddyModels(output: string): CliModel[] {
  const section =
    /(?:^|\n) {0,4}(?:-[^\s,]+,\s*)?--model\b[\s\S]*?(?=\n {0,4}-|\n\s*\n|$)/u.exec(
      output,
    )?.[0] ?? "";
  const match = /Currently\s+supported:\s*\(([^)]+)\)/u.exec(section);
  if (!match) return [];
  return match[1]!
    .replace(/\s+/gu, " ")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((name) => ({ name, efforts: [] }));
}

export const models: ModelAdapter = async (shell, command, signal) => ({
  models: parseCodebuddyModels(
    await modelCommand(shell, command + " --help", signal),
  ),
  permissions: [],
});
