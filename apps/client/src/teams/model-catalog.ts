import { definitionOrder, modelProvider } from "@iori/protocol";

export { modelProvider, groupModels } from "@iori/protocol";

export function modelOrder(cliOrder: string[], language: string) {
  const compareCli = definitionOrder(cliOrder, language);
  return (
    a: { cli: string; model: string },
    b: { cli: string; model: string },
  ) =>
    compareCli(a.cli, b.cli) ||
    modelProvider(a.model).localeCompare(modelProvider(b.model), language) ||
    a.model.localeCompare(b.model, language);
}
