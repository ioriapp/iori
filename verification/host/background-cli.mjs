import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ioriCommand } from "./environment.mjs";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hook } from "./send-hook.mjs";

if (process.argv.includes("--version") || process.argv.includes("--help")) {
  console.log("1.5.9");
  process.exit(0);
}
const antigravity = process.argv.includes("--antigravity");
const payload = { session_id: randomUUID(), conversationId: randomUUID() };
const control = join(process.env.HOME, `background-${process.pid}.cmd`);
await writeFile(control, "");
let respond = false;
let heartbeat;
let stops = 0;
let queue = Promise.resolve();
async function stop() {
  clearInterval(heartbeat);
  await hook("Stop", {
    ...payload,
    fullyIdle: false,
    background_tasks: [{ status: "running", command: "background command" }],
  });
  console.log(`BACKGROUND_STOP:${++stops}`);
}
async function command(line) {
  if (line === "ACTIVE") {
    await hook(antigravity ? "PreInvocation" : "UserPromptSubmit", payload);
    heartbeat = setInterval(() => console.log("BACKGROUND_WORKING"), 180);
    heartbeat.unref();
    console.log("BACKGROUND_ACTIVE");
  } else if (line === "REPORT") {
    await promisify(execFile)(ioriCommand(process.env.IORI_COMMAND_BIN), [
      "report",
      "--body",
      "Background work is continuing.",
    ]);
    console.log("BACKGROUND_REPORTED");
  } else if (line === "STOP") await stop();
  else if (line === "RESPOND") {
    respond = true;
    console.log("BACKGROUND_WILL_RESPOND");
  } else if (line.startsWith("[iori] Your background command")) {
    console.log(`BACKGROUND_RECEIVED:${line}`);
    if (respond) {
      await hook(antigravity ? "PreInvocation" : "UserPromptSubmit", payload);
      await hook("Stop", { ...payload, fullyIdle: true });
      console.log("BACKGROUND_RESPONSE_ENDED");
    }
  }
}
let offset = 0;
const watcher = watch(control, () => {
  queue = queue.then(async () => {
    const data = await readFile(control, "utf8");
    const lines = data.slice(offset).trim().split("\n").filter(Boolean);
    offset = data.length;
    for (const line of lines) await command(line);
  });
});
watcher.unref();
process.stdin.setRawMode(true);
let buffer = "";
process.stdin.on("data", (data) => {
  buffer += data
    .toString()
    .replaceAll("\x1b[200~", "")
    .replaceAll("\x1b[201~", "");
  const lines = buffer.split(/[\r\n]+/u);
  buffer = lines.pop();
  for (const line of lines.filter(Boolean))
    queue = queue.then(() => command(line));
});
process.stdout.write("\x1b[?2004h");
await hook("SessionStart", payload);
// The first request is supplied as a CLI argument by the built-in definition.
await hook(antigravity ? "PreInvocation" : "UserPromptSubmit", payload);
await stop();
console.log(`BACKGROUND_CONTROL:${control}`);
process.stdin.resume();
