import type { CliModel } from "@iori/protocol";
import type { ModelAdapter } from "../models.ts";
import { modelDialogue, ModelCommandError } from "../models.ts";

export const models: ModelAdapter = async (shell, command, signal) => {
  let models: CliModel[] | undefined;
  const result = await modelDialogue(
    shell,
    command + " serve",
    signal,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "iori", version: "1" } },
    },
    (value, send, end) => {
      if (value.error) {
        end();
        throw new Error("command_failed");
      }
      if (value.id === 1) {
        send({ jsonrpc: "2.0", method: "initialized" });
        send({ jsonrpc: "2.0", id: 2, method: "model/list", params: {} });
      }
      if (value.id === 2) {
        const result = value.result as {
          models: {
            modelId: string;
            displayLabel?: string;
            variants?: string[] | "unknown";
          }[];
        };
        models = result.models.map((model) => ({
          name: model.modelId,
          label: model.displayLabel,
          efforts: Array.isArray(model.variants) ? model.variants : [],
        }));
        end();
      }
    },
    true,
  );
  if (!models) throw new ModelCommandError(result.stderr || result.output);
  return { models, permissions: [] };
};
