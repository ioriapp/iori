import { local as verificationLocal } from "./local.mjs";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distributionEntries = new Set([
  "verification/updates/run-linux.mjs",
  "verification/updates/run-android.mjs",
  "verification/updates/run.mjs",
  "verification/host-setup/run-linux.mjs",
  "verification/host-setup/run-ssh.mjs",
  "verification/host-setup/run.mjs",
]);
const lockRoot = "/root/projects/iori/.local/locks";
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const heldVariable = "IORI_VERIFICATION_HELD_LOCKS";

export function devicePlan(file, args = []) {
  const order = () => [
    "android",
    verificationLocal.linux.host,
    verificationLocal.windows.host,
  ];
  const filename = String(file).startsWith("file:")
    ? fileURLToPath(file)
    : file;
  const relative = path
    .relative(repo, path.resolve(filename))
    .replaceAll("\\", "/");
  const clientOption = args.indexOf("--client");
  const client = args.includes("--android")
    ? "Android"
    : clientOption < 0
      ? undefined
      : args[clientOption + 1];
  const filter =
    args.find((arg) => arg.startsWith("--client="))?.slice(9) ?? client;
  const host = args.includes("--host")
    ? args[args.indexOf("--host") + 1]
    : undefined;
  let devices,
    shared = [];
  switch (relative) {
    case "scripts/release/acceptance.mjs":
      if (!args.includes("--android")) return undefined;
      devices = ["android"];
      break;
    case "verification/host-setup/run-ssh.mjs":
    case "verification/host-setup/build.mjs":
    case "verification/updates/build-windows.mjs":
    case "verification/connection/build.mjs":
      devices =
        (filter === "Android" || filter === "Linux") &&
        !(
          relative === "verification/host-setup/run-ssh.mjs" &&
          host === "Windows"
        ) &&
        !(
          relative === "verification/host-setup/build.mjs" &&
          args.includes("--ssh-windows")
        )
          ? [verificationLocal.linux.host]
          : [verificationLocal.linux.host, verificationLocal.windows.host];
      break;
    case "verification/window-chrome/run.mjs":
      devices = [verificationLocal.linux.host, verificationLocal.windows.host];
      shared = [verificationLocal.linux.host];
      break;
    case "verification/native/windows-desktop.mjs":
    case "verification/cli/windows-hooks.mjs":
    case "verification/cli/windows-definitions.mjs":
    case "verification/cli/models.mjs":
    case "verification/cli/team-command.mjs":
    case "verification/cli/forge-command.mjs":
    case "verification/workspace/worktree-removal.mjs":
    case "verification/terminal/daemon-windows.mjs":
    case "verification/updates/host-windows.mjs":
    case "verification/forge/token-store-windows.mjs":
    case "verification/cli/run.mjs":
    case "scripts/release/windows.mjs":
    case "verification/connection/run-build.mjs":
    case "verification/connection/webview-control.mjs":
      devices = [verificationLocal.windows.host];
      break;
    case "verification/connection/prepare-linux.mjs":
    case "verification/host-setup/build-linux.mjs":
    case "verification/host-setup/run-linux.mjs":
    case "verification/linux-client/prepare.mjs":
    case "verification/updates/build-linux.mjs":
    case "verification/updates/run-linux.mjs":
      devices = [verificationLocal.linux.host];
      break;
    case "scripts/release/android.mjs":
    case "verification/updates/build-android.mjs":
    case "verification/connection/build-android.mjs":
      devices = ["android"];
      break;
    case "verification/host-setup/run.mjs":
      devices = args.includes("--windows-only")
        ? [verificationLocal.windows.host]
        : ["android", verificationLocal.windows.host];
      break;
    case "verification/reading/run.mjs":
      devices = [
        ...(filter !== "Windows" ? ["android"] : []),
        ...(host === "linux" || (!host && filter !== "Android")
          ? [verificationLocal.linux.host]
          : []),
        ...(host === "windows" || !host || filter !== "Android"
          ? [verificationLocal.windows.host]
          : []),
      ];
      shared = [verificationLocal.linux.host];
      break;
    case "verification/workspace/run.mjs":
      devices =
        filter === "Windows"
          ? [verificationLocal.linux.host, verificationLocal.windows.host]
          : filter === "Android"
            ? ["android", verificationLocal.windows.host]
            : order();
      shared = [verificationLocal.linux.host];
      break;
    case "verification/updates/run-android.mjs":
      devices = ["android", verificationLocal.linux.host];
      shared = [verificationLocal.linux.host];
      break;
    case "verification/updates/run.mjs":
      devices = [verificationLocal.linux.host, verificationLocal.windows.host];
      shared = [verificationLocal.linux.host];
      break;
    case "verification/notifications/run.mjs":
      devices =
        filter === "Windows"
          ? [verificationLocal.linux.host, verificationLocal.windows.host]
          : filter === "Android"
            ? ["android", verificationLocal.linux.host]
            : order();
      shared = [verificationLocal.linux.host];
      break;
    case "verification/terminal/run.mjs":
      devices = [
        ...(filter !== "Windows" ? ["android"] : []),
        ...(host !== "windows" ? [verificationLocal.linux.host] : []),
        ...(filter !== "Android" || host !== "linux"
          ? [verificationLocal.windows.host]
          : []),
      ];
      shared = [verificationLocal.linux.host];
      break;
    case "verification/terminal/resize.mjs":
      devices =
        host === "windows"
          ? ["android", verificationLocal.windows.host]
          : order();
      shared = [verificationLocal.linux.host];
      break;
    case "verification/connection/run.mjs":
      devices = order();
      shared = [verificationLocal.linux.host];
      break;
    case "verification/connection/mobile-layout.mjs":
      devices = ["android", verificationLocal.windows.host];
      break;
    case "verification/connection/cleanup.mjs": {
      const evidence = path.resolve(
        process.env.IORI_VERIFICATION_EVIDENCE_ROOT ??
          ".local/evidence/connection",
      );
      const state = JSON.parse(
        readFileSync(path.join(evidence, "build-state.json"), "utf8"),
      );
      devices = [
        ...(state.androidRoot || state.androidPackage ? ["android"] : []),
        ...(state.linuxRoot ? [verificationLocal.linux.host] : []),
        ...(state.windowsRoot ? [verificationLocal.windows.host] : []),
      ];
      break;
    }
    case "verification/clean-cache.mjs":
      devices = args.length ? args : order();
      break;
    default:
      return undefined;
  }
  if (distributionEntries.has(relative)) devices.push("distribution");
  return ["distribution", ...order()]
    .filter((device) => devices.includes(device))
    .map((device) => ({ device, shared: shared.includes(device) }));
}

export function heldDevices() {
  return JSON.parse(process.env[heldVariable] ?? "[]").map(
    (lock) => lock.device,
  );
}

export async function withDeviceLocks(plan, command, args) {
  const inherited = alreadyLocked(plan); // Reject partial inheritance before flock.
  await mkdir(lockRoot, { recursive: true });
  const prefix = [];
  // During migration the owner can hold the old global lock once around an entire
  // batch. It is intentionally not baked into the permanent per-device protocol.
  for (const { device, shared } of inherited ? [] : plan)
    prefix.push(
      "flock",
      "--close",
      shared ? "--shared" : "--exclusive",
      path.join(lockRoot, device + ".lock"),
    );
  prefix.push(command, ...args);
  console.log(
    "[locks] waiting: " +
      plan
        .map((lock) => lock.device + (lock.shared ? " (shared)" : ""))
        .join(" → "),
  );
  return await new Promise((resolve, reject) => {
    const child = spawn(prefix[0], prefix.slice(1), {
      stdio: "inherit",
      env: {
        ...process.env,
        [heldVariable]: inherited
          ? (process.env[heldVariable] ?? "[]")
          : JSON.stringify(plan),
      },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export function alreadyLocked(plan) {
  const held = JSON.parse(process.env[heldVariable] ?? "[]");
  const complete = plan.every((wanted) =>
    held.some(
      (lock) =>
        lock.device === wanted.device && (!lock.shared || wanted.shared),
    ),
  );
  if (
    !complete &&
    plan.some((wanted) => held.some((lock) => lock.device === wanted.device))
  )
    throw new Error(
      "機器の鍵を一部だけ保持したままの再取得・共有から排他への取り直しはできません",
    );
  return complete;
}

// Direct invocations add only locks, not a new execution deadline.
// The documented bounded entry acquires locks before its existing limits.
// Exit only in the outer launcher; the child keeps locks through its finally.
export async function lockEntry(file) {
  const plan = devicePlan(file, process.argv.slice(2));
  if (plan && !alreadyLocked(plan)) {
    const code = await withDeviceLocks(plan, process.execPath, [
      fileURLToPath(file),
      ...process.argv.slice(2),
    ]);
    process.exit(code);
  }
  if (plan)
    console.log(
      "[locks] acquired: " +
        plan.map((lock) => lock.device).join(", ") +
        " at " +
        new Date().toISOString(),
    );
}
