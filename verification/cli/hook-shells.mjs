import { spawn, spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";

/** The shells that run a CLI's hooks on Windows, and how each reads one
 * written command (windows-hooks.mjs, windows-definitions.mjs). */
export const hookShells = [
  {
    id: "powershell",
    file: () => "powershell.exe",
    args: (command) => [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ],
  },
  {
    id: "cmd",
    file: () => process.env.ComSpec,
    args: (command) => ["/d", "/s", "/c", `"${command}"`],
    // The command is one argument as written: no further quoting by Node.
    verbatim: true,
  },
  {
    id: "git-bash",
    file: () => "C:\\Program Files\\Git\\bin\\bash.exe",
    args: (command) => ["-c", command],
  },
];

/** The receiving end of iori's hook notification: the bodies that arrive. */
export async function hookReceiver() {
  let bodies = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/fixture`,
    received: () => bodies,
    reset: () => {
      bodies = [];
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Run one written command from `shell` with `payload` on its stdin, as the
 * CLI calls it. `proof` is a file that a command line taken as shell syntax
 * would create; only this run's disposable folder may receive it. */
export async function runHookCommand({
  shell,
  command,
  env,
  payload,
  receiver,
  proof,
  timeoutMs = 10_000,
}) {
  receiver.reset();
  await rm(proof, { force: true });
  const child = spawn(shell.file(), shell.args(command), {
    env,
    windowsHide: true,
    ...(shell.verbatim ? { windowsVerbatimArguments: true } : {}),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {});
  const timer = setTimeout(() => {
    timedOut = true;
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
    });
  }, timeoutMs);
  child.stdin.end(JSON.stringify(payload) + "\r\n");
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  const injected = await readFile(proof, "utf8").then(
    () => true,
    () => false,
  );
  return {
    shell: shell.id,
    code,
    timedOut,
    injected,
    received: receiver.received(),
    stdout,
    stderr: stderr.slice(0, 1000),
  };
}

/** What a command wrote: nothing when the CLI needs no reply, otherwise the
 * reply the CLI requires. */
export function hookReply(stdout, expected) {
  const out = stdout.replaceAll("\u0000", "");
  const quiet = !out.trim();
  if (expected === undefined) return { quiet, reply: null };
  try {
    return {
      quiet,
      reply:
        JSON.stringify(JSON.parse(out.trim())) === JSON.stringify(expected),
    };
  } catch {
    return { quiet, reply: false };
  }
}
