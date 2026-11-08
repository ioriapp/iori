import { join } from "node:path";
import { fileURLToPath } from "node:url";

const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;

export async function registerResponseCli(client, dataRoot) {
  const command = [
    process.execPath,
    fileURLToPath(new URL("./response-cli.mjs", import.meta.url)),
  ]
    .map(quote)
    .join(" ");
  const result = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: "response-cli",
      name: "Response CLI",
      command: { shell: command },
      resume: { args: ["--resume", "{sessionId}"] },
      hooks: {
        format: "claude-settings",
        file: join(dataRoot, "response-settings.json"),
        sessionId: "session_id",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "UserPromptSubmit", state: "active" },
          { event: "Stop", state: "done" },
        ],
      },
    }),
  });
  if (!result.cliId) throw new Error("台本CLIの定義を登録できません");
  return result.cliId;
}
