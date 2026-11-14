import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { hook } from "./send-hook.mjs";

const run = promisify(execFile);

if (process.argv.includes("--version") || process.argv.includes("--help")) {
  console.log("scripted-cli 1.0.0");
} else {
  process.stdin.setRawMode(true);
  const input = createInterface({ input: process.stdin, terminal: false });
  // readline only queues lines for an iterator that already exists.
  const lines = input[Symbol.asyncIterator]();
  const noReady = process.argv.includes("--no-ready");
  const resumeIndex = process.argv.indexOf("--resume");
  const sessionId =
    resumeIndex === -1 ? randomUUID() : process.argv[resumeIndex + 1];
  const startupId = randomUUID();
  // Claude Code and Codex SessionStart both use session_id/cwd/source.
  // Later steps can supply their CLI-specific fields through step.payload.
  const payload = {
    session_id: sessionId,
    cwd: process.cwd(),
    source: resumeIndex === -1 ? "startup" : "resume",
  };
  if (!noReady) await hook("SessionStart", payload);
  console.log(noReady ? "NO_READY_SCREEN" : "ACTOR_READY");
  console.log(`ACTOR_START:${startupId}`);
  if (process.argv.includes("--observe-environment")) {
    console.log(
      `ACTOR_LAUNCH_ENV:${process.env.IORI_CLI_HOOK_ADAPTER ? "present" : "missing"}`,
    );
    console.log(
      `ACTOR_TEAM_FILES_DIRECTORY:${process.env.IORI_TEAM_FILES_DIRECTORY ?? ""}`,
    );
  }
  console.log(`ACTOR_SHELL_STATE:${process.env.IORI_TEST_SHELL_STATE ?? ""}`);
  const instructionIndex = process.argv.indexOf("--instruction");
  if (instructionIndex !== -1)
    console.log(
      `ACTOR_INSTRUCTIONS:${startupId}:${JSON.stringify(await readFile(process.argv[instructionIndex + 1], "utf8"))}`,
    );
  let requests = 0;
  function handlePrompt(line) {
    if (process.argv.includes("--capture-prompts"))
      console.log(`ACTOR_INPUT:${JSON.stringify(line)}`);
    if (!noReady) {
      // Like a real CLI accepting a prompt: the Host writes the text and the
      // Enter separately, so tests wait for this before typing their own lines.
      console.log(`ACTOR_PROMPT:${startupId}`);
    } else if (line.startsWith("[iori] Parent ")) {
      console.log(`INITIAL_INPUT_COUNT=${requests}`);
    } else {
      requests++;
      console.log(`INITIAL_REQUEST_RECEIVED:${line}`);
    }
  }
  for await (let line of lines) {
    const commandStart = line.indexOf('{"id":');
    if (commandStart > 0) {
      handlePrompt(line.slice(0, commandStart));
      line = line.slice(commandStart);
    }
    if (line.startsWith("{")) {
      const step = JSON.parse(line);
      if (step.hook) {
        await hook(step.hook, { ...payload, ...step.payload });
        console.log(`ACTOR_HOOK:${step.id}`);
      } else if (step.command) {
        // Host-provided PATH/bin and authenticated route, just as real agents use.
        const { stdout } = await run(
          join(process.env.IORI_COMMAND_BIN, "iori"),
          [...step.command, "--json"],
        ).catch(() => ({ stdout: JSON.stringify({ ok: false }) }));
        console.log(
          `ACTOR_RESULT:${step.id}:${JSON.stringify(JSON.parse(stdout))}`,
        );
      }
    } else {
      handlePrompt(line);
    }
  }
}
