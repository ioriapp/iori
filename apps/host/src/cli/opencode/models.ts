import type { ModelAdapter } from "../models.ts";
import { modelCommand, plainModels } from "../models.ts";
/** The TUI has no variant launch option; users select it inside OpenCode. */
export const models: ModelAdapter = async (shell, command, signal) => {
  const output = await modelCommand(shell, command + " models", signal);
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
