import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const cli = process.argv[2];
if (process.argv.includes("--version") || process.argv.includes("--help")) {
  console.log("v2.3.0");
  process.exit(0);
}
const hookScript = fileURLToPath(
  new URL("../../../apps/host/src/cli/hook-script.mjs", import.meta.url),
);
function hook(event, payload = {}, label = event) {
  const child = spawn(process.execPath, [hookScript, event, "-", cli], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stdin.end(JSON.stringify({ session_id: "approval-test", ...payload }));
  return new Promise((resolve) =>
    child.on("exit", () => {
      console.log(`APPROVAL_RESULT:${label}:${JSON.stringify(output)}`);
      resolve(output);
    }),
  );
}
let emit;
if (cli === "opencode") {
  const plugin = (
    await import(
      pathToFileURL(
        join(process.env.HOME, ".config/opencode/plugins/iori-status.js"),
      )
    )
  ).default;
  const queue = [];
  let wake;
  emit = (type, data) => {
    queue.push({ type, data });
    wake?.();
  };
  await plugin.setup({
    session: {
      hook: async () => {},
      get: async () => ({}),
      update: async () => {},
    },
    event: {
      subscribe: async function* () {
        for (;;) {
          if (!queue.length) await new Promise((resolve) => (wake = resolve));
          while (queue.length) yield queue.shift();
        }
      },
    },
    permission: {
      reply: async (value) => {
        console.log(`OPENCODE_REPLY:${JSON.stringify(value)}`);
        emit("permission.replied", value);
      },
    },
  });
  emit("session.created", { sessionID: "approval-test" });
} else await hook("SessionStart");
process.stdin.setRawMode(true);
console.log("APPROVAL_READY");
for await (const line of createInterface({
  input: process.stdin,
  terminal: false,
})) {
  const step = JSON.parse(line);
  if (cli === "opencode") {
    emit("permission.asked", {
      id: step.id,
      sessionID: "approval-test",
      action: "shell",
      resources: [step.command ?? "echo approval"],
    });
  } else {
    void hook(
      "PermissionRequest",
      {
        tool_name: step.tool ?? "Bash",
        tool_input: step.toolInput ?? {
          command: step.command ?? "echo approval",
        },
      },
      step.id,
    ).then(async (output) => {
      if (output) await hook("PostToolUse");
    });
  }
}
