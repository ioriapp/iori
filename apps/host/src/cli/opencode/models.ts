import type { ModelAdapter } from "../models.ts";
import { modelCommand, plainModels } from "../models.ts";
export const isV2 = (version?: string) =>
  Number(version?.match(/(?:^|\s)v?(\d+)\./u)?.[1]) >= 2;
export const models: ModelAdapter = async (shell, command, signal) => {
  const version = await modelCommand(shell, command + " --version", signal);
  const output = await modelCommand(
    shell,
    command + (isV2(version) ? " api --standalone model.list" : " models"),
    signal,
  );
  return {
    models: isV2(version)
      ? parseV2Models(output)
      : plainModels(output).map((name) => ({ name, efforts: [] })),
    permissions: [
      {
        key: "permission",
        label: "Auto-approve permissions",
        options: ["Auto-approve permissions"],
      },
    ],
  };
};

export function parseV2Models(output: string) {
  const parsed = JSON.parse(output) as {
    data: Array<{
      id: string;
      providerID: string;
      variants: Array<{ id: string }>;
    }>;
  };
  return parsed.data.map((model) => ({
    name: `${model.providerID}/${model.id}`,
    efforts: model.variants.map((variant) => variant.id),
  }));
}
