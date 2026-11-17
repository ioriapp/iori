import { fileURLToPath } from "node:url";
import { quoteShellWord } from "../../../verification/host/environment.mjs";

export async function registerApprovalCli(client, cli = "claude") {
  const command = [
    process.execPath,
    fileURLToPath(new URL("./approval-cli.mjs", import.meta.url)),
    cli,
  ]
    .map(quoteShellWord)
    .join(" ");
  await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: cli,
      name: cli,
      command: { shell: command },
    }),
  });
  return cli;
}
