import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const hookScript = fileURLToPath(
  new URL("../../apps/host/src/cli/hook-script.mjs", import.meta.url),
);
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
if (process.argv.includes("--version") || process.argv.includes("--help")) {
  console.log("lifecycle-cli 1.0.0");
} else {
  process.stdin.setRawMode(true);
  const action = process.argv[process.argv.indexOf("--action") + 1];
  const resume = process.argv.indexOf("--resume");
  const payload = {
    session_id: resume < 0 ? randomUUID() : process.argv[resume + 1],
    cwd: process.cwd(),
    source: resume < 0 ? "startup" : "resume",
  };
  await hook("SessionStart", payload);
  console.log(`LIFECYCLE_READY:${payload.source}`);
  let turn = 0;
  for await (const line of createInterface({
    input: process.stdin,
    terminal: false,
  })) {
    if (line.startsWith("{")) {
      const step = JSON.parse(line);
      const result = await run(join(process.env.IORI_COMMAND_BIN, "iori"), [
        ...step.command,
        "--json",
      ]).catch((error) => ({
        stdout:
          error.stdout || JSON.stringify({ ok: false, text: error.message }),
      }));
      console.log(`ACTOR_RESULT:${step.id}:${result.stdout.trim()}`);
      continue;
    }
    if (action === "parent") {
      if (line === "EXIT_NOW") process.exit(0);
      console.log(`LIFECYCLE_PARENT_INPUT:${line}`);
      continue;
    }
    if (action === "capture-initial")
      console.log(`LIFECYCLE_INITIAL:${JSON.stringify(line)}`);
    const match = line.match(
      /[Oo]pen the file (.+?) with your file-reading tool/u,
    );
    const body = match ? await readFile(match[1], "utf8") : line;
    console.log(`LIFECYCLE_REQUEST:${JSON.stringify(body)}`);
    await hook("UserPromptSubmit", payload);
    if (action === "failure") {
      await hook("StopFailure", { ...payload, error: "Model unavailable" });
      console.log(`LIFECYCLE_FAILED:${++turn}`);
    } else if (action === "approval" && resume < 0 && turn === 0) {
      await hook("PermissionRequest", {
        ...payload,
        tool_name: "Bash",
        tool_input: { command: "test" },
      });
      console.log("LIFECYCLE_APPROVAL");
      turn++;
    } else {
      if (action === "report-later") {
        await new Promise((resolve, reject) => {
          const watcher = watch(
            process.env.IORI_TEST_RELEASE_DIR,
            (_event, name) => {
              if (name === "release") {
                watcher.close();
                resolve();
              }
            },
          );
          watcher.once("error", reject);
          console.log("LIFECYCLE_WORKING");
        });
      }
      if (body.includes("AUTO_REPORT_COMPLETED"))
        await run(join(process.env.IORI_COMMAND_BIN, "iori"), [
          "report",
          "--body",
          "Completed the work.",
          "--json",
        ]).catch((error) => {
          console.log(
            `LIFECYCLE_COMMAND:${error.stdout || JSON.stringify({ ok: false, text: error.message })}`,
          );
        });
      await hook("Stop", payload);
      console.log(`LIFECYCLE_DONE:${++turn}`);
    }
  }
}
