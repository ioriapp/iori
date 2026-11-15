import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ioriCommand } from "../../../verification/host/environment.mjs";
import { hook } from "../../../verification/host/send-hook.mjs";

const run = promisify(execFile);

if (process.argv.includes("--version") || process.argv.includes("--help")) {
  console.log("watch-cli 1.0.0");
  process.exit(0);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);

const resumeIndex = process.argv.indexOf("--resume");
const payload = {
  session_id: resumeIndex === -1 ? randomUUID() : process.argv[resumeIndex + 1],
  cwd: process.cwd(),
  source: resumeIndex === -1 ? "startup" : "resume",
};

const controlFile = join(
  process.env.HOME ?? process.cwd(),
  `watch-control-${process.pid}.cmd`,
);
await writeFile(controlFile, "", "utf8");

let captureRaw = false;
let heartbeatTimer;
let stoppedChild;

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
}

function cleanupStoppedChild() {
  stopHeartbeat();
  if (!stoppedChild) return;
  const pid = stoppedChild.pid;
  stoppedChild = undefined;
  if (!pid) return;
  try {
    process.kill(pid, "SIGCONT");
  } catch {
    /* Already exited. */
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* Already exited. */
  }
}

for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"]) {
  process.on(signal, () => {
    cleanupStoppedChild();
    process.exit(0);
  });
}
process.on("exit", cleanupStoppedChild);

async function runIori(args) {
  try {
    return (await run(ioriCommand(process.env.IORI_COMMAND_BIN), args)).stdout;
  } catch (error) {
    return error.stdout || JSON.stringify({ ok: false, text: error.message });
  }
}

async function waitForLinuxStopped(pid) {
  if (process.platform !== "linux") return;
  for (let i = 0; i < 100; i++) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      if (close >= 0) {
        const state = stat.slice(close + 1).trimStart()[0];
        if (state === "T") return;
      }
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

let queue = Promise.resolve();
const enqueue = (task) => {
  queue = queue.then(task).catch((error) => {
    console.error("WATCH_ERROR:" + (error?.message ?? String(error)));
  });
  return queue;
};

async function handleInstruction(text) {
  if (text === "CAPTURE_RAW") {
    captureRaw = true;
    console.log("RAW_CAPTURE_READY");
    return;
  }
  if (text.includes("CAPTURE_RAW")) captureRaw = true;
  if (text.includes("BEHAVIOR_PASSIVE")) {
    console.log("WATCH_PASSIVE");
    return;
  }
  if (text.includes("BEHAVIOR_WORKING_HEARTBEAT")) {
    await hook("UserPromptSubmit", payload);
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      process.stdout.write("WORKING\n");
    }, 180);
    heartbeatTimer.unref();
    console.log("WATCH_WORKING");
    return;
  }
  if (text.includes("STOP_HEARTBEAT")) {
    stopHeartbeat();
    console.log("HEARTBEAT_STOPPED");
    return;
  }
  if (
    text.includes("BEHAVIOR_STAY_ACTIVE") ||
    text.includes("BEHAVIOR_SILENT_STALL")
  ) {
    await hook("UserPromptSubmit", payload);
    console.log("WATCH_ACTIVE");
    return;
  }
  if (text.includes("BEHAVIOR_STOPPED_CHILD")) {
    await hook("UserPromptSubmit", payload);
    cleanupStoppedChild();
    stoppedChild = spawn(
      process.execPath,
      [
        "-e",
        "setInterval(() => {}, 1000); process.kill(process.pid, 'SIGSTOP');",
      ],
      { stdio: "ignore" },
    );
    await waitForLinuxStopped(stoppedChild.pid);
    heartbeatTimer = setInterval(() => {
      process.stdout.write("HEARTBEAT\n");
    }, 50);
    heartbeatTimer.unref();
    console.log(`STOPPED_CHILD_STARTED:${stoppedChild.pid}`);
    return;
  }
  if (text.includes("BEHAVIOR_SCREEN_SCROLL")) {
    await hook("UserPromptSubmit", payload);
    const lines = [];
    for (let i = 1; i <= 60; i++) {
      lines.push(`SCROLL_LINE_${String(i).padStart(2, "0")}`);
    }
    lines.push("VISIBLE_LINE_A", "VISIBLE_LINE_B", "VISIBLE_LINE_C");
    process.stdout.write(`\x1b[2J\x1b[H${lines.join("\r\n")}`);
    return;
  }
  if (text.includes("BEHAVIOR_WAITING")) {
    await hook("UserPromptSubmit", payload);
    await hook("PermissionRequest", { ...payload, tool_name: "Bash" });
    captureRaw = true;
    console.log("WATCH_WAITING");
    return;
  }
  if (text.includes("BEHAVIOR_ACTIVE_CONTROL")) {
    await hook("UserPromptSubmit", payload);
    console.log("WATCH_ACTIVE");
    return;
  }
  if (text.includes("EMIT_OUTPUT")) {
    console.log("RESUMED_PTY_OUTPUT");
    return;
  }
  if (text.includes("HOOK_ACTIVE")) {
    await hook("UserPromptSubmit", payload);
    console.log("HOOK_ACTIVE_SENT");
    return;
  }
  if (text.includes("HOOK_STOP")) {
    await hook("Stop", payload);
    console.log("HOOK_STOP_SENT");
    return;
  }
  if (text.includes("HOOK_WAITING")) {
    await hook("PermissionRequest", { ...payload, tool_name: "Bash" });
    console.log("HOOK_WAITING_SENT");
    return;
  }
  if (text.includes("KILL_STOPPED")) {
    cleanupStoppedChild();
    console.log("STOPPED_CHILD_CLEARED");
    return;
  }
  if (text.includes("EXIT_ALT_SCREEN")) {
    process.stdout.write("\x1b[?1049l");
    return;
  }
  if (text.includes("ALT_SCREEN")) {
    process.stdout.write(
      "\x1b[?1049h\x1b[2J\x1b[HALT_SCREEN_ROW_1\r\nALT_SCREEN_ROW_2",
    );
    return;
  }
  if (text.includes("REPORT_WORK")) {
    const res = await runIori([
      "report",
      "--body",
      "Work completed.",
      "--json",
    ]);
    console.log(`WATCH_CMD:${res.trim()}`);
    return;
  }
  if (text.includes("ASK_PARENT")) {
    const res = await runIori(["ask", "--body", "Need guidance.", "--json"]);
    console.log(`WATCH_CMD:${res.trim()}`);
    return;
  }
  if (text.includes("NO_READY_MODE")) {
    console.log("WATCH_IDLE");
  }
}

let controlOffset = 0;
let controlRemainder = "";
async function readControl() {
  const data = await readFile(controlFile, "utf8");
  if (data.length <= controlOffset) return;
  const slice = controlRemainder + data.slice(controlOffset);
  controlOffset = data.length;
  const parts = slice.split(/\r?\n/u);
  controlRemainder = parts.pop() ?? "";
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) await handleInstruction(trimmed);
  }
}

const controlWatcher = watch(controlFile, () => {
  void enqueue(() => readControl());
});
controlWatcher.unref();

await hook("SessionStart", payload);
console.log(`WATCH_READY:${payload.source}`);
console.log(`WATCH_SESSION:${payload.session_id}`);
console.log(`WATCH_CONTROL:${controlFile}`);
if (process.argv.includes("--marker")) {
  await appendFile(controlFile, "", "utf8");
}

let stdinBuffer = "";
process.stdin.on("data", (chunk) => {
  if (captureRaw) {
    process.stdout.write(`\nRAW_HEX:${chunk.toString("hex")}\n`);
  }
  const clean = chunk
    .toString("utf8")
    .replaceAll("\x1b[200~", "")
    .replaceAll("\x1b[201~", "")
    .replaceAll("\x1b[I", "")
    .replaceAll("\x1b[O", "");
  stdinBuffer += clean;
  const parts = stdinBuffer.split(/[\r\n]+/u);
  stdinBuffer = parts.pop() ?? "";
  for (const rawLine of parts) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    void enqueue(async () => {
      if (trimmed.startsWith("{")) {
        const step = JSON.parse(trimmed);
        const args = step.raw ? step.command : [...step.command, "--json"];
        const result = await runIori(args);
        console.log(
          `ACTOR_RESULT:${step.id}:${step.raw ? JSON.stringify(result.trim()) : result.trim()}`,
        );
        return;
      }
      const noticeIndex = trimmed.indexOf("[iori] ");
      if (noticeIndex !== -1) {
        console.log(`NOTICE_RECEIVED:${trimmed.slice(noticeIndex)}`);
        return;
      }
      const match = trimmed.match(
        /[Oo]pen the file (.+?) with your file-reading tool/u,
      );
      if (match) {
        const body = await readFile(match[1], "utf8");
        console.log(`WATCH_BODY:${JSON.stringify(body)}`);
        await handleInstruction(body);
        return;
      }
      await handleInstruction(trimmed);
    });
  }
});
process.stdin.resume();
