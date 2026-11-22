import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { homedir } from "node:os";
import { MAX_FRAME_BYTES } from "@iori/protocol";
import { ByteLimitError } from "../resource-limits.ts";
import { isWindowsHost, type ShellDefinition } from "../terminal/platform.ts";
import { readWindowsLoginEnvironment } from "./windows-login-environment.ts";
import { shellDialect } from "./shell-quoting.ts";

/** Profiles and aliases are evaluated by the user's own shell. No deadline
 * declares a slow profile or version probe to have failed. */
export function runInShell(
  shell: ShellDefinition,
  script: string,
  signal?: AbortSignal,
  exchange?: {
    start: (send: (line: string) => void, end: () => void) => void;
    data: (chunk: string) => void;
  },
  completeOutput = false,
  environment?: Record<string, string>,
): Promise<{ output: string; stderr: string; code: number | null }> {
  return runInShellEnvironment(
    shell,
    script,
    { ...process.env, ...environment },
    signal,
    exchange,
    completeOutput,
  );
}
/** The variables that a login shell needs to start. A definition's script does
 * not receive the Host's other variables: no keys, Forge tokens or team
 * secrets (docs/design/cli-definitions.md「環境変数」). */
const loginVariables = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "PATH",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LANGUAGE",
  "TZ",
  "SystemRoot",
  "SystemDrive",
  "ComSpec",
  "PATHEXT",
  "WINDIR",
  "USERNAME",
  "USERDOMAIN",
  "COMPUTERNAME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
];
export function loginEnvironment(): Record<string, string> {
  const kept = new Set(loginVariables.map((name) => name.toUpperCase()));
  const names = new Set<string>();
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const key = name.toUpperCase();
    if (value === undefined || names.has(key)) continue;
    if (!kept.has(key) && !key.startsWith("LC_")) continue;
    names.add(key);
    environment[name] = value;
  }
  return environment;
}
/** Run a definition's script (or command) in the user's login shell, with the
 * login environment and the input written to stdin before it is closed. */
export async function runInLoginShell(
  shell: ShellDefinition,
  script: string,
  input: string,
  signal?: AbortSignal,
): Promise<{ output: string; stderr: string; code: number | null }> {
  return runInShellEnvironment(
    shell,
    script,
    isWindowsHost()
      ? await readWindowsLoginEnvironment(loginEnvironment())
      : loginEnvironment(),
    signal,
    {
      start: (send, end) => {
        send(input.endsWith("\n") ? input.slice(0, -1) : input);
        end();
      },
      data: () => {},
    },
    true,
  );
}
function runInShellEnvironment(
  shell: ShellDefinition,
  script: string,
  environment: Record<string, string | undefined>,
  signal?: AbortSignal,
  exchange?: {
    start: (send: (line: string) => void, end: () => void) => void;
    data: (chunk: string) => void;
  },
  completeOutput = false,
): Promise<{ output: string; stderr: string; code: number | null }> {
  const dialect = shellDialect(shell);
  // POSIX interactive shell warnings stay on fd 2; only the CLI's stderr
  // reaches fd 3. Windows shells keep native stderr on its original pipe.
  if (completeOutput && dialect === "posix")
    script =
      shell.id === "fish"
        ? `begin\n${script}\nend 2>&3`
        : `{ ${script}\n} 2>&3`;
  const args =
    dialect === "powershell"
      ? ["-NoLogo", "-NonInteractive", "-Command", script]
      : dialect === "cmd"
        ? ["/s", "/c", `"${script}"`]
        : ["-l", "-i", "-c", script];
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const child = spawn(shell.executable, args, {
      env: environment,
      cwd: homedir(),
      windowsHide: true,
      stdio:
        completeOutput && dialect === "posix"
          ? [exchange ? "pipe" : "ignore", "pipe", "ignore", "pipe"]
          : [
              exchange ? "pipe" : "ignore",
              "pipe",
              completeOutput ? "pipe" : "ignore",
            ],
      ...(dialect === "cmd" ? { windowsVerbatimArguments: true } : {}),
      ...(signal ? { signal } : {}),
    });
    let output = "";
    let outputBytes = 0;
    let stderr = "";
    const errors = dialect === "posix" ? child.stdio[3] : child.stderr;
    if (errors instanceof Readable) {
      errors.setEncoding("utf8");
      errors.on("data", (data: string) => {
        stderr += data.slice(0, 65_536 - stderr.length);
      });
    }
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (data: string) => {
      if (settled) return;
      if (completeOutput) {
        outputBytes += Buffer.byteLength(data);
        if (outputBytes > MAX_FRAME_BYTES) {
          fail(new ByteLimitError(MAX_FRAME_BYTES));
          child.kill();
          child.stdout!.destroy();
          if (errors instanceof Readable) errors.destroy();
          child.stdin?.destroy();
          return;
        }
        output += data;
      } else if (!exchange) output = (output + data).slice(-65_536);
      if (exchange) {
        try {
          exchange.data(data);
        } catch (error) {
          child.stdin?.end();
          fail(error as Error);
        }
      }
    });
    child.stdin?.on("error", fail);
    try {
      exchange?.start(
        (line) => child.stdin?.write(line + "\n"),
        () => child.stdin?.end(),
      );
    } catch (error) {
      fail(error as Error);
    }
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ output, stderr, code });
    });
  });
}
