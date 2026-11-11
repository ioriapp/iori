export async function firstCliModel(screen, cliId) {
  const response = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');return connection.requestHost(connection.getSnapshot().host.publicKey,'cli.models',{cliId:${JSON.stringify(cliId)}});})()`,
  );
  const model = response?.result?.models?.[0];
  if (!response?.ok || !model)
    throw new Error(
      `CLI ${cliId} のモデル一覧を取得できないか空です: ${JSON.stringify(response)}`,
    );
  return model;
}

export const modelItem = (cli, model) =>
  `[cmdk-item][data-cli=${JSON.stringify(cli)}][data-iori-model=${JSON.stringify(model.name)}]`;
