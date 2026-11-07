import { local as verificationLocal } from "../native/local.mjs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { waitFor } from "../ui.mjs";
import { windowsNode, ps, sh, linux } from "../native/remote.mjs";
// The terminal QR and invitation are held only in memory, never evidence or logs.
export async function inviteCli(os, root, dataDir) {
  const pidFile = root + "/cli-" + randomUUID() + ".pid";
  const command =
    os === "linux"
      ? `sudo -u iori-dev -H bash -c ${sh(`echo $$ > ${sh(pidFile)}; exec env LC_ALL=C.UTF-8 XDG_DATA_HOME=${sh(dataDir)} node ${sh(root + "/apps/host/src/invite-cli.ts")}`)}`
      : `pwsh -NoProfile -EncodedCommand ${Buffer.from(`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding;$env:LC_ALL='C.UTF-8';$env:LOCALAPPDATA=${ps(dataDir)};& ${ps(windowsNode)} ${ps(root + "\\apps\\host\\src\\invite-cli.ts")}`, "utf16le").toString("base64")}`;
  const child = spawn(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      os === "linux"
        ? verificationLocal.linux.host
        : verificationLocal.windows.host,
      command,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let closed = false;
  let exitCode;
  child.stdout.on("data", (bytes) => {
    stdout += bytes;
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const completed = new Promise((resolve) =>
    child.once("exit", (code) => {
      exitCode = code;
      closed = true;
      resolve();
    }),
  );
  const invitation = await waitFor(() => {
    const value = stdout.match(/iori:\/\/pair\/[A-Z2-7]+/)?.[0];
    if (closed && !value)
      throw new Error("iori invite could not issue an invitation");
    return value;
  });
  return {
    invitation,
    async invalidated() {
      await waitFor(() => closed);
      await completed;
      if (
        exitCode !== 0 ||
        !stderr.includes("This invitation is no longer valid")
      )
        throw new Error("iori invite did not report invitation invalidation");
      return { exitCode, invalidationWasReported: true };
    },
    async registered(name) {
      await waitFor(() => closed);
      await completed;
      if (exitCode !== 0 || !stdout.includes(name))
        throw new Error("iori invite did not report registration");
      return {
        exitCode,
        registeredDevice: name,
        qrWasRendered:
          stdout.includes("▀") || stdout.includes("▄") || stdout.includes("█"),
      };
    },
    async interrupt() {
      if (os !== "linux")
        throw new Error("SIGINT scenario requires the Linux verification Host");
      linux(
        `sudo -u iori-dev -H bash -c ${sh(`pid=$(cat ${sh(pidFile)}); args=$(ps -p "$pid" -o args=); case "$args" in *${sh(root + "/apps/host/src/invite-cli.ts")}*) kill -INT "$pid";; *) exit 1;; esac`)}`,
      );
      await waitFor(() => closed);
      return { interrupted: true };
    },
    stop() {
      child.kill("SIGTERM");
    },
    get closed() {
      return closed;
    },
  };
}
