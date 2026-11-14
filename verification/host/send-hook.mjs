import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const hookScript = fileURLToPath(
  new URL("../../apps/host/src/cli/hook-script.mjs", import.meta.url),
);
export async function hook(event, payload) {
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
