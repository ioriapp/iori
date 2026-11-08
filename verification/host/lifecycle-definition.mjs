import { join } from "node:path";
import { fileURLToPath } from "node:url";

const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;
export async function registerLifecycleCli(client, dataRoot, action) {
  const command =
    `IORI_TEST_RELEASE_DIR=${quote(dataRoot)} ` +
    [
      process.execPath,
      fileURLToPath(new URL("./lifecycle-cli.mjs", import.meta.url)),
      "--action",
      action,
    ]
      .map(quote)
      .join(" ");
  const result = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: `lifecycle-${action}`,
      name: `Lifecycle ${action}`,
      command: { shell: command },
      resume: { args: ["--resume", "{sessionId}"] },
      hooks: {
        format: "claude-settings",
        file: join(dataRoot, `lifecycle-${action}.json`),
        sessionId: "session_id",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "UserPromptSubmit", state: "active" },
          {
            event: "PermissionRequest",
            state: "waiting",
            attention: "approval",
            tool: "tool_name",
          },
          { event: "Stop", state: "done" },
          {
            event: "StopFailure",
            state: "done",
            outcome: "failure",
            failure: ["error"],
          },
        ],
      },
    }),
  });
  if (!result.cliId) throw new Error("台本CLIの定義を登録できません");
  return result.cliId;
}
