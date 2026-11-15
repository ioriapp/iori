import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { platform } from "node:os";
import { promisify } from "node:util";

const runExecFile = promisify(execFile);
const PROC_READ_BATCH = 64;

interface ProcessTable {
  children: Map<number, number[]>;
  stopped: Set<number>;
}

function addProcess(
  table: ProcessTable,
  pid: number,
  ppid: number,
  stopped: boolean,
): void {
  let list = table.children.get(ppid);
  if (!list) {
    list = [];
    table.children.set(ppid, list);
  }
  list.push(pid);
  if (stopped) table.stopped.add(pid);
}

async function readLinuxProcesses(): Promise<ProcessTable> {
  const table: ProcessTable = { children: new Map(), stopped: new Set() };
  let entries: string[];
  try {
    entries = await readdir("/proc");
  } catch {
    return table;
  }
  const pids: number[] = [];
  for (const name of entries) {
    if (!/^[1-9][0-9]*$/u.test(name)) continue;
    pids.push(Number(name));
  }
  for (let i = 0; i < pids.length; i += PROC_READ_BATCH) {
    const batch = pids.slice(i, i + PROC_READ_BATCH);
    await Promise.all(
      batch.map(async (pid) => {
        try {
          const stat = await readFile(`/proc/${pid}/stat`, "utf8");
          const close = stat.lastIndexOf(")");
          if (close < 0) return;
          const after = stat.slice(close + 1).trimStart();
          const space1 = after.indexOf(" ");
          if (space1 < 0) return;
          const state = after.slice(0, space1);
          const rest = after.slice(space1 + 1).trimStart();
          const space2 = rest.search(/\s/u);
          const ppid = Number(space2 < 0 ? rest : rest.slice(0, space2));
          if (!Number.isInteger(ppid) || ppid < 0) return;
          addProcess(table, pid, ppid, state === "T");
        } catch {
          /* Process may exit while scanning /proc. */
        }
      }),
    );
  }
  return table;
}

async function readDarwinProcesses(): Promise<ProcessTable> {
  const table: ProcessTable = { children: new Map(), stopped: new Set() };
  try {
    const { stdout } = await runExecFile("ps", ["-axo", "pid=,ppid=,stat="], {
      timeout: 2000,
    });
    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/^([0-9]+)\s+([0-9]+)\s+(\S+)/u);
      if (!match) continue;
      const pid = Number(match[1]);
      const ppid = Number(match[2]);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
      addProcess(table, pid, ppid, match[3]!.startsWith("T"));
    }
  } catch {
    return table;
  }
  return table;
}

function collectStoppedDescendants(
  table: ProcessTable,
  rootPid: number,
): Set<number> {
  const result = new Set<number>();
  const visited = new Set<number>([rootPid]);
  const queue = [...(table.children.get(rootPid) ?? [])];
  for (let i = 0; i < queue.length; i++) {
    const pid = queue[i]!;
    if (visited.has(pid)) continue;
    visited.add(pid);
    if (table.stopped.has(pid)) result.add(pid);
    const children = table.children.get(pid);
    if (children) queue.push(...children);
  }
  return result;
}

/** Return strict descendant PIDs currently in stopped (`T`) state per root PID. */
export async function stoppedDescendantPidsByRoot(
  rootPids: number[],
): Promise<Map<number, Set<number>>> {
  const out = new Map<number, Set<number>>();
  if (rootPids.length === 0) return out;
  const hostPlatform = platform();
  if (hostPlatform !== "linux" && hostPlatform !== "darwin") return out;
  const table =
    hostPlatform === "linux"
      ? await readLinuxProcesses()
      : await readDarwinProcesses();
  for (const rootPid of rootPids) {
    const found = collectStoppedDescendants(table, rootPid);
    if (found.size > 0) out.set(rootPid, found);
  }
  return out;
}
