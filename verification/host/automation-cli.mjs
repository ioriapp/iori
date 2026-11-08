import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const hookScript = fileURLToPath(
  new URL("../../apps/host/src/cli/hook-script.mjs", import.meta.url),
);
const run = promisify(execFile);
async function hook(event, payload) {
  const child = spawn(process.execPath, [hookScript, event, "-"], {
    stdio: ["pipe", "ignore", "inherit"],
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("hook sender failed")),
    );
  });
  child.stdin.end(JSON.stringify(payload));
  await exited;
}

if (process.argv.includes("--version")) {
  console.log("automation-cli 1.0.0");
} else {
  process.stdin.setRawMode(true);
  const lines = createInterface({ input: process.stdin, terminal: false })[
    Symbol.asyncIterator
  ]();
  const payload = {
    session_id: randomUUID(),
    cwd: process.cwd(),
    source: "startup",
  };
  await hook("SessionStart", payload);
  console.log(`AUTOMATION_PID:${process.pid}`);
  const promptIndex = process.argv.indexOf("--prompt");
  const prompt = promptIndex === -1 ? "" : process.argv[promptIndex + 1];
  const instruction = /^Read (.+) and follow its instructions\.$/u.exec(
    prompt,
  )?.[1];
  if (instruction) {
    await hook("UserPromptSubmit", payload);
    const body = await readFile(instruction, "utf8");
    console.log(
      `AUTOMATION_FILE:${Buffer.from(instruction).toString("base64")}:END_FILE`,
    );
    console.log(
      `AUTOMATION_BODY:${Buffer.from(body).toString("base64")}:END_BODY`,
    );
  }
  console.log("AUTOMATION_READY");
  for await (const line of lines) {
    const step = JSON.parse(line);
    if (step.exit) {
      process.exit(0);
    } else if (step.hook) {
      await hook(step.hook, payload);
      console.log(`ACTOR_HOOK:${step.id}`);
    } else if (step.command) {
      const result = await run(
        join(process.env.IORI_COMMAND_BIN, "iori"),
        step.command,
      )
        .then(({ stdout }) => ({ code: 0, stdout }))
        .catch((error) => ({ code: error.code, stdout: error.stdout }));
      console.log(
        `COMMAND_RESULT:${step.id}:${Buffer.from(JSON.stringify(result)).toString("base64")}:END_RESULT`,
      );
    }
  }
}
