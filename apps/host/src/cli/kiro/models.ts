import type { CliModel } from "@iori/protocol";
import type { ModelAdapter } from "../models.ts";
import { modelCommand } from "../models.ts";

export function parseKiroModels(output: string): CliModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.values(parsed).find(Array.isArray)
      : undefined;
  if (!items) return [];
  return items.flatMap((item): CliModel[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const id = (item as Record<string, unknown>).model_id;
    return typeof id === "string" && id.trim()
      ? [{ name: id.trim(), efforts: [] }]
      : [];
  });
}

export const models: ModelAdapter = async (shell, command, signal) => ({
  models: parseKiroModels(
    await modelCommand(
      shell,
      command + " --no-interactive --list-models --format json",
      signal,
    ),
  ),
  permissions: [],
});
