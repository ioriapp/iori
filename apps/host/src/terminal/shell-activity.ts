import { fork, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, win32 } from "node:path";
import { platform } from "node:os";
import { promisify } from "node:util";

export type ShellActivity = { busy: boolean; command?: string };
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

async function linuxActivity(
  pid: number,
  name: boolean,
): Promise<ShellActivity> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return { busy: false };
    const fields = stat
      .slice(close + 1)
      .trim()
      .split(/\s+/u);
    const group = Number(fields[2]);
    const foreground = Number(fields[5]);
    const busy =
      Number.isInteger(group) &&
      Number.isInteger(foreground) &&
      foreground !== group;
    if (!busy || !name) return { busy };
    let processName: string | undefined;
    try {
      processName = (
        await readFile(`/proc/${foreground}/cmdline`, "utf8")
      ).split("\0")[0];
    } catch {
      /* Fall back to comm below. */
    }
    if (!processName) {
      try {
        processName = (
          await readFile(`/proc/${foreground}/comm`, "utf8")
        ).trim();
      } catch {
        /* The process may already have exited. */
      }
    }
    const command = processName && basename(processName.split(/\s/u)[0]);
    return command ? { busy, command } : { busy };
  } catch {
    return { busy: false };
  }
}

async function windowsCommand(
  pid: number,
  ids: number[],
): Promise<string | undefined> {
  try {
    // Query only process metadata: command lines may contain secrets.
    const filter = ids.map((id) => `ProcessId=${id}`).join(" OR ");
    const script = `Get-CimInstance Win32_Process -Filter '${filter}' | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 3000 },
    );
    const parsed: unknown = JSON.parse(stdout);
    const processes = (Array.isArray(parsed) ? parsed : [parsed]) as {
      ProcessId: number;
      ParentProcessId: number;
      Name: string;
    }[];
    const selected =
      processes.find((process) => process.ParentProcessId === pid) ??
      processes[0];
    if (typeof selected?.Name !== "string") return undefined;
    return win32.basename(selected.Name).replace(/\.exe$/iu, "") || undefined;
  } catch {
    return undefined;
  }
}

function windowsActivity(pid: number, name: boolean): Promise<ShellActivity> {
  let agentPath: string;
  try {
    agentPath = require.resolve("node-pty/lib/conpty_console_list_agent.js");
  } catch {
    return Promise.resolve({ busy: false });
  }
  let child: ReturnType<typeof fork>;
  try {
    child = fork(agentPath, [String(pid)], { silent: true });
  } catch {
    return Promise.resolve({ busy: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ShellActivity) => {
      if (settled) return;
      settled = true;
      child.removeListener("message", onMessage);
      child.removeListener("error", onFailure);
      child.removeListener("exit", onFailure);
      child.removeListener("disconnect", onFailure);
      resolve(result);
    };
    const onMessage = (message: unknown) => {
      if (typeof message !== "object" || message === null)
        return finish({ busy: false });
      const list = (message as { consoleProcessList?: unknown })
        .consoleProcessList;
      if (
        !Array.isArray(list) ||
        list.some((id) => !Number.isSafeInteger(id) || id <= 0)
      )
        return finish({ busy: false });
      const ids = new Set<number>(list as number[]);
      if (!ids.has(pid) || child.pid === undefined)
        return finish({ busy: false });
      ids.delete(child.pid);
      ids.delete(pid);
      if (!ids.size) return finish({ busy: false });
      if (!name) return finish({ busy: true });
      // Mark settled before asynchronous metadata lookup; process exit is normal.
      settled = true;
      child.removeListener("error", onFailure);
      child.removeListener("exit", onFailure);
      child.removeListener("disconnect", onFailure);
      void windowsCommand(pid, [...ids]).then((command) =>
        resolve(command ? { busy: true, command } : { busy: true }),
      );
    };
    const onFailure = () => finish({ busy: false });
    child.once("message", onMessage);
    child.once("error", onFailure);
    child.once("exit", onFailure);
    child.once("disconnect", onFailure);
  });
}

export async function shellActivity(
  pid: number,
  options: { name?: boolean } = {},
): Promise<ShellActivity> {
  if (platform() === "linux") return linuxActivity(pid, options.name !== false);
  if (platform() === "win32")
    return windowsActivity(pid, options.name !== false);
  return { busy: false };
}
