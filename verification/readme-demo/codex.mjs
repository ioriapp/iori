// The Host installs its hooks in the isolated CODEX_HOME. Only the real TUI
// uses shared authentication and sessions. Hooks are disabled for this TUI:
// no Owner configuration or persisted hook trust is changed.
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const utility = args.some((arg) =>
  ["app-server", "--version", "-V", "--help", "-h"].includes(arg),
);
const options = utility
  ? args
  : [
      "-c",
      "features.hooks=false",
      "-c",
      "check_for_update_on_startup=false",
      ...args,
    ];
const child = spawn(process.env.IORI_DEMO_CODEX_BIN, options, {
  stdio: "inherit",
  env: utility
    ? process.env
    : { ...process.env, CODEX_HOME: process.env.IORI_DEMO_SHARED_CODEX_HOME },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
    resolve();
  });
});
