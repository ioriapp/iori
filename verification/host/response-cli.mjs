import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { hook } from "./send-hook.mjs";

const run = promisify(execFile);

if (process.argv.includes("--version") || process.argv.includes("--help")) {
  console.log("response-cli 1.0.0");
} else {
  process.stdin.setRawMode(true);
  const resumeIndex = process.argv.indexOf("--resume");
  const payload = {
    session_id:
      resumeIndex === -1 ? randomUUID() : process.argv[resumeIndex + 1],
    cwd: process.cwd(),
    source: resumeIndex === -1 ? "startup" : "resume",
  };
  await hook("SessionStart", payload);
  console.log(`RESPONSE_READY:${payload.source}`);
  console.log(`RESPONSE_SESSION:${payload.session_id}`);
  async function command(args) {
    try {
      return (await run(join(process.env.IORI_COMMAND_BIN, "iori"), args))
        .stdout;
    } catch (error) {
      return error.stdout || JSON.stringify({ ok: false, text: error.message });
    }
  }
  let turns = 0;
  let interrupted = false;
  for await (const line of createInterface({
    input: process.stdin,
    terminal: false,
  })) {
    if (line.startsWith("{")) {
      const step = JSON.parse(line);
      const result = await command([...step.command, "--json"]);
      console.log(`ACTOR_RESULT:${step.id}:${result.trim()}`);
      continue;
    }
    if (interrupted) {
      interrupted = false;
      await hook("Stop", payload);
      console.log(`RESPONSE_TURN_DONE:${++turns}`);
      continue;
    }
    const match = line.match(
      /[Oo]pen the file (.+?) with your file-reading tool/u,
    );
    const body = match ? await readFile(match[1], "utf8") : line;
    if (match) console.log(`RESPONSE_BODY:${JSON.stringify(body)}`);
    await hook("UserPromptSubmit", payload);
    if (body.includes("AUTO_INTERRUPT")) {
      interrupted = true;
      console.log("RESPONSE_ACTIVE");
      continue;
    }
    if (body.includes("AUTO_REPORT_FIRST"))
      console.log(
        `RESPONSE_COMMAND:${await command([
          "report",
          "--body",
          "First report.",
          "--json",
        ])}`,
      );
    if (body.includes("AUTO_REPORT_COMPLETED"))
      console.log(
        `RESPONSE_COMMAND:${await command([
          "report",
          "--body",
          "Completed the work.",
          "--json",
        ])}`,
      );
    if (body.includes("AUTO_ASK"))
      console.log(
        `RESPONSE_COMMAND:${await command([
          "ask",
          "--body",
          "May I finish?",
          "--json",
        ])}`,
      );
    if (body.includes("AUTO_REPORT_AGAIN"))
      console.log(
        `RESPONSE_COMMAND:${await command([
          "report",
          "--body",
          "Checked again.",
          "--json",
        ])}`,
      );
    await hook("Stop", payload);
    console.log(`RESPONSE_TURN_DONE:${++turns}`);
  }
}
