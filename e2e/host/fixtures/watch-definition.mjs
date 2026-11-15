import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteShellWord } from "../../../verification/host/environment.mjs";

export async function registerWatchCli(
  client,
  dataRoot,
  id = "watch-cli",
  args = [],
) {
  const command = [
    process.execPath,
    fileURLToPath(new URL("./watch-cli.mjs", import.meta.url)),
    ...args,
  ]
    .map(quoteShellWord)
    .join(" ");
  const result = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id,
      name: `Watch CLI (${id})`,
      command: { shell: command },
      resume: { args: ["--resume", "{sessionId}"] },
      hooks: {
        format: "claude-settings",
        file: join(dataRoot, `${id}-settings.json`),
        sessionId: "session_id",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "UserPromptSubmit", state: "active" },
          {
            event: "PermissionRequest",
            state: "waiting",
            attention: "approval",
          },
          { event: "Stop", state: "done" },
        ],
      },
    }),
  });
  if (!result.cliId) throw new Error("監視試験用の台本CLIを登録できません");
  return result.cliId;
}
