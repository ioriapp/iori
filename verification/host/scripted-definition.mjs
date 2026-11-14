import { join } from "node:path";
import { fileURLToPath } from "node:url";

const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;

/** Register via the public definition API, never by replacing Host adapters. */
export async function registerScriptedCli(
  client,
  dataRoot,
  {
    id: requestedId,
    noReady = false,
    resumable = false,
    observeEnvironment = false,
    waiting = false,
  } = {},
) {
  const id = requestedId ?? (noReady ? "scripted-no-ready" : "scripted-parent");
  const command = [
    process.execPath,
    fileURLToPath(new URL("./scripted-cli.mjs", import.meta.url)),
    ...(noReady ? ["--no-ready"] : []),
    ...(observeEnvironment ? ["--observe-environment"] : []),
  ]
    .map(quote)
    .join(" ");
  const result = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id,
      name: id,
      command: { shell: command },
      ...(resumable
        ? {
            launch: { instructionFile: ["--instruction", "{instructionFile}"] },
            resume: { args: ["--resume", "{sessionId}"] },
          }
        : {}),
      ...(!noReady
        ? {
            hooks: {
              format: "claude-settings",
              file: join(dataRoot, "scripted-settings.json"),
              sessionId: "session_id",
              rules: [
                { event: "SessionStart", state: "idle" },
                { event: "UserPromptSubmit", state: "active" },
                ...(waiting
                  ? [
                      {
                        event: "PermissionRequest",
                        state: "waiting",
                        attention: "approval",
                        tool: "tool_name",
                      },
                    ]
                  : []),
                { event: "Stop", state: "done" },
              ],
            },
          }
        : {}),
    }),
  });
  if (!result.cliId) throw new Error("台本CLIの定義を登録できません");
  return result.cliId;
}

export async function actorCommand(terminal, id, command) {
  await terminal.input(JSON.stringify({ id, command }) + "\r");
  const prefix = `ACTOR_RESULT:${id}:`;
  const { output } = await terminal.waitFor(({ output }) => {
    const start = output.indexOf(prefix);
    return start !== -1 && output.indexOf("\n", start) !== -1;
  });
  const start = output.indexOf(prefix) + prefix.length;
  const result = JSON.parse(output.slice(start, output.indexOf("\n", start)));
  if (!result.ok) throw new Error(`iori ${command[0]} failed`);
  return result;
}
