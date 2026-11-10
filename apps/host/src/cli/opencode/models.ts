import type { ModelAdapter } from "../models.ts";
import { modelCommand, plainModels } from "../models.ts";
export const isV2 = (version?: string) =>
  Number(version?.match(/(?:^|\s)v?(\d+)\./u)?.[1]) >= 2;
/** The TUI has no variant launch option; users select it inside OpenCode. */
export const models: ModelAdapter = async (shell, command, signal) => {
  const version = await modelCommand(shell, command + " --version", signal);
  const output = await modelCommand(
    shell,
    command + (isV2(version) ? " models --standalone" : " models"),
    signal,
  );
  return {
    models: plainModels(output).map((name) => ({ name, efforts: [] })),
    permissions: [
      {
        key: "permission",
        label: "Auto-approve permissions",
        options: ["Auto-approve permissions"],
      },
    ],
  };
};
