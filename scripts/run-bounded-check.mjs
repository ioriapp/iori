import { writeMemoryEvidence } from "../verification/process-memory.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  devicePlan,
  alreadyLocked,
  withDeviceLocks,
} from "../verification/native/locks.mjs";

const USER_BUS_UNAVAILABLE = 3;
const USAGE_ERROR = 2;

export function buildBoundedArgv(
  commandArgs,
  memoryOnly = false,
  memoryMax = "4G",
) {
  return [
    "systemd-run",
    "--user",
    "--scope",
    "-q",
    "-p",
    `MemoryMax=${memoryMax}`,
    "-p",
    "MemorySwapMax=0",
    ...(memoryOnly ? [] : ["timeout", "900"]),
    ...commandArgs,
  ];
}

export function classifyResult(result) {
  if (result.error)
    return {
      kind: "launch-error",
      code: 1,
      error: result.error.code ?? "unknown",
    };
  if (result.status === 124) return { kind: "timeout", code: 124 };
  if (result.status === 0) return { kind: "success", code: 0 };
  return { kind: "failure", code: result.status };
}

function hasUserBus() {
  const result = spawnSync(
    "systemctl",
    ["--user", "show", "--property=Version", "--value"],
    {
      stdio: "ignore",
      encoding: "utf8",
    },
  );
  return !result.error && result.status === 0;
}

// The nearest finite cgroup v2 memory.max of this process or its ancestors.
// A worker started inside a capped scope is already bounded; a nested scope
// would need the user bus, which sandboxes such as Codex cannot reach.
export function inheritedMemoryLimit(
  cgroupFile = "/proc/self/cgroup",
  root = "/sys/fs/cgroup",
) {
  let path;
  try {
    const line = readFileSync(cgroupFile, "utf8")
      .split("\n")
      .find((value) => value.startsWith("0::"));
    if (!line) return undefined;
    path = join(root, line.slice(3));
  } catch {
    return undefined;
  }
  for (;;) {
    if (!(path === root || path.startsWith(`${root}/`))) break;
    try {
      const value = readFileSync(join(path, "memory.max"), "utf8").trim();
      if (/^\d+$/.test(value)) return Number(value);
    } catch {
      // Not readable at this level; keep looking upward.
    }
    if (path === root) break;
    path = dirname(path);
  }
  return undefined;
}

function main(commandArgs, memoryOnly = false, memoryMax = "4G") {
  if (commandArgs.length === 0) {
    process.stderr.write(
      "使い方: node scripts/run-bounded-check.mjs [--memory-only] [--memory-max=4G] <command> [args...]\n",
    );
    return USAGE_ERROR;
  }

  const inherited = inheritedMemoryLimit();
  if (inherited !== undefined) {
    const result = spawnSync(
      memoryOnly ? commandArgs[0] : "timeout",
      memoryOnly ? commandArgs.slice(1) : ["900", ...commandArgs],
      {
        stdio: "inherit",
      },
    );
    return classifyResult(result).code ?? 1;
  }

  if (!hasUserBus()) {
    process.stderr.write(
      "systemd user busに接続できません。同じコマンドを実行環境の権限付き実行(require_escalated等)で再実行し、メモリ/時間制限を維持してください。\n",
    );
    return USER_BUS_UNAVAILABLE;
  }

  const unit = `iori-check-${process.pid}-${Date.now()}.scope`;
  const argv = buildBoundedArgv(commandArgs, memoryOnly, memoryMax).slice(1);
  argv.splice(argv.indexOf("--scope") + 1, 0, `--unit=${unit}`);
  const result = spawnSync("systemd-run", argv, { stdio: "inherit" });
  if (result.status !== 0) {
    const state = spawnSync(
      "systemctl",
      [
        "--user",
        "show",
        unit,
        "--property=Result",
        "--property=MemoryPeak",
        "--property=MemoryMax",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    if (state.stdout?.includes("Result=oom-kill")) {
      const limit = state.stdout.match(/^MemoryMax=(\d+)$/m)?.[1];
      if (process.env.IORI_MEMORY_EVIDENCE_PATH)
        writeMemoryEvidence(
          join(
            dirname(process.env.IORI_MEMORY_EVIDENCE_PATH),
            "memory-oom.json",
          ),
          {
            source: "systemd",
            unit,
            result: "oom-kill",
            peakBytes: Number(state.stdout.match(/^MemoryPeak=(\d+)$/m)?.[1]),
            limitBytes: Number(limit),
          },
        );
      process.stderr.write(
        `メモリ上限で停止しました（OOM kill、上限 ${limit ?? "取得できません"} bytes、最大 ${state.stdout.match(/^MemoryPeak=(\d+)$/m)?.[1] ?? "取得できません"} bytes）。\n`,
      );
    }
  }
  return classifyResult(result).code ?? 1;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  // pnpm on this kind of machine may start scripts with an older Node (Volta's
  // pnpm picks Node 22). Stop before a long run instead of failing inside it.
  const expectedNode = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", ".node-version"),
    "utf8",
  ).trim();
  if (process.versions.node.split(".")[0] !== expectedNode.split(".")[0]) {
    process.stderr.write(
      `Node ${expectedNode} で起動してください（今は ${process.version}、${process.execPath}）。pnpm を通さず、Node ${expectedNode} の node で直接起動します。例: node scripts/run-bounded-check.mjs node verification/web/run.mjs --only=<名前>\n`,
    );
    process.exit(USAGE_ERROR);
  }
  const memoryOnly = process.argv[2] === "--memory-only";
  const commandArgs = process.argv.slice(memoryOnly ? 3 : 2);
  const memoryMax = commandArgs[0]?.startsWith("--memory-max=")
    ? commandArgs.shift().slice("--memory-max=".length)
    : "4G";
  // Run a `node` command with this checked Node, not whichever node PATH finds.
  if (commandArgs[0] === "node") commandArgs[0] = process.execPath;
  const plan =
    commandArgs[1] && devicePlan(commandArgs[1], commandArgs.slice(2));
  // Wait outside the existing observation limit: a busy device is not a failure.
  process.exitCode =
    plan && !alreadyLocked(plan)
      ? await withDeviceLocks(plan, process.execPath, [
          fileURLToPath(import.meta.url),
          ...(memoryOnly ? ["--memory-only"] : []),
          ...(memoryMax === "4G" ? [] : [`--memory-max=${memoryMax}`]),
          ...commandArgs,
        ])
      : main(commandArgs, memoryOnly, memoryMax);
}
