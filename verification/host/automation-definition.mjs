import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const quote = (word) => `'${word.replaceAll("'", "'\\''")}'`;
export async function registerAutomationCli(client, dataRoot) {
  const { cliId } = await client.request("cli.definition.save", {
    definition: JSON.stringify({
      schema: 1,
      id: "automation-cli",
      name: "Automation CLI",
      command: {
        shell: [
          process.execPath,
          fileURLToPath(new URL("./automation-cli.mjs", import.meta.url)),
        ]
          .map(quote)
          .join(" "),
      },
      launch: {
        initialPrompt: { mode: "argument", args: ["--prompt", "{prompt}"] },
      },
      hooks: {
        format: "claude-settings",
        file: join(dataRoot, "automation-settings.json"),
        sessionId: "session_id",
        rules: [
          { event: "SessionStart", state: "idle" },
          { event: "UserPromptSubmit", state: "active" },
          { event: "Stop", state: "done" },
        ],
      },
    }),
  });
  if (!cliId) throw new Error("自動化の台本CLIを登録できません");
  return cliId;
}
export const plainOutput = (output) =>
  stripVTControlCharacters(output).replaceAll(/\r?\n/gu, "");
export async function delivered(terminal, kind = "BODY") {
  const pattern = new RegExp(
    `AUTOMATION_${kind}:([A-Za-z0-9+/=]+):END_${kind}`,
    "u",
  );
  const { output } = await terminal.waitFor(({ output }) =>
    pattern.test(plainOutput(output)),
  );
  return Buffer.from(pattern.exec(plainOutput(output))[1], "base64").toString(
    "utf8",
  );
}
export async function automationCommand(terminal, id, command) {
  await terminal.input(JSON.stringify({ id, command }) + "\r");
  const pattern = new RegExp(
    `COMMAND_RESULT:${id}:([A-Za-z0-9+/=]+):END_RESULT`,
    "u",
  );
  const { output } = await terminal.waitFor(({ output }) =>
    pattern.test(plainOutput(output)),
  );
  return JSON.parse(
    Buffer.from(pattern.exec(plainOutput(output))[1], "base64").toString(
      "utf8",
    ),
  );
}
export const automationDefinition = (cli, cwd, changes = {}) => ({
  name: "Automation",
  instruction: 'Read "quotes"\nand\ttabs.',
  cwd,
  target: {
    kind: "cli",
    candidate: { id: "candidate", cli, model: "", tools: [], minimum: "" },
  },
  schedule: { kind: "manual" },
  missed: "latest",
  enabled: true,
  ...changes,
});
export async function launchedRun(client, id, predicate = () => true) {
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");
  for (;;) {
    const seen = events.values.length;
    const { runs } = await client.request("automation.history", { id });
    const run = runs.find(
      (run) => predicate(run) && (run.terminalId || run.launchError),
    );
    if (run) {
      if (run.launchError) throw new Error(run.launchError);
      return run;
    }
    await events.waitFor(() => events.values.length > seen);
  }
}
