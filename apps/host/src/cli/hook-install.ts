import {
  claimHostHooks,
  otherHostUses,
  releaseHostHooks,
} from "./hook-hosts.ts";
import { readFile, mkdir, rmdir } from "node:fs/promises";
import { removeHookFile } from "./hook-files.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ShellDefinition } from "../terminal/platform.ts";
import { isWindowsHost } from "../terminal/platform.ts";
import { cliDefinitions } from "./definitions.ts";
import { runInShell } from "./shell-command.ts";
import { writeText } from "./hook-config.ts";
import { removeWrittenHooks, writtenPath } from "./definition-hooks.ts";
import type { HookInstallContext } from "./hooks.ts";

function quoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
/** `id` is the CLI whose hooks are written; iori's command carries it.
 * `root` is the Host storage that keeps the record of definitions' hooks. */
export async function hookInstallContext(
  shell: ShellDefinition,
  id: string,
  cliCommand = "",
  install = true,
  signal?: AbortSignal,
  root?: string,
): Promise<HookInstallContext> {
  const home = homedir();
  const directory = join(home, ".iori", "hooks");
  const script = join(directory, "iori-cli-hook.mjs");
  const launcher = join(directory, "iori-cli-hook.cmd");
  if (install) {
    if (root) await claimHostHooks(root, id);
    await mkdir(directory, { recursive: true });
    await writeText(
      script,
      await readFile(new URL("./hook-script.mjs", import.meta.url), "utf8"),
    );
    await writeText(
      join(directory, "ORCA-LICENSE.txt"),
      await readFile(new URL("./ORCA-LICENSE.txt", import.meta.url), "utf8"),
    );
    if (isWindowsHost())
      await writeText(
        launcher,
        `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${process.execPath.replaceAll("%", "%%")}" "%~dp0iori-cli-hook.mjs" %*\r\nexit /b %errorlevel%\r\n`,
      );
  }
  // The CLI's `id` comes last: a CLI that keeps running across a Host
  // update still calls the new script with the arguments it read before.
  const commandForEvent = (event = "", response?: Record<string, unknown>) => {
    // An argument that is not there is `-`: Windows PowerShell drops an empty
    // argument that it passes on to another command, which would move the
    // arguments after it into its place (docs/design/cli-definitions.md「hooks」).
    const argumentsForEvent = [
      event || "-",
      response
        ? Buffer.from(JSON.stringify(response)).toString("base64url")
        : "-",
      id,
    ];
    if (!isWindowsHost())
      return `${quoted(process.execPath)} ${quoted(script)}${argumentsForEvent.map((arg) => ` ${quoted(arg)}`).join("")}`;
    // Git Bash rewrites /c and /d switches when launching cmd.exe. Register
    // the batch path itself, with ASCII-safe paths and base64url arguments.
    // Other paths use Orca's encoded PowerShell fallback across all shells.
    const safePath = /^[A-Za-z0-9_.:\\~-]+$/u;
    if (!safePath.test(launcher) || !safePath.test(process.execPath)) {
      const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
      const invocation = `& ${quote(process.execPath)} ${quote(script)}${argumentsForEvent.map((arg) => ` ${quote(arg)}`).join("")}`;
      return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(invocation, "utf16le").toString("base64")}`;
    }
    // No argument is empty, so the batch file writes them as they are.
    return `${launcher.replaceAll("\\", "/")}${argumentsForEvent.map((value) => ` ${value}`).join("")}`;
  };
  return {
    id,
    home,
    command: commandForEvent(),
    commandForEvent,
    script,
    cliCommand,
    shell,
    signal,
    run: (script) => runInShell(shell, script, signal),
    ...(root ? { writtenPath: writtenPath(root) } : {}),
  };
}

/** Host uninstall can invoke this without a UI or starting any CLI. `root`
 * is the storage of the Host whose hooks are removed. */
export async function removeCliHooks(
  shell: ShellDefinition,
  root: string,
): Promise<void> {
  for (const definition of cliDefinitions) {
    await definition.hooks?.remove(
      await hookInstallContext(
        shell,
        definition.id,
        "",
        false,
        undefined,
        root,
      ),
    );
  }
  // Also the hooks of user definitions that this process has not read.
  await removeWrittenHooks(writtenPath(root), () => true);
  await releaseHostHooks(root);
  if (await otherHostUses(root)) return;
  const directory = join(homedir(), ".iori", "hooks");
  try {
    await rmdir(join(directory, "hosts"));
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      (error as NodeJS.ErrnoException).code !== "ENOTEMPTY"
    )
      throw error;
  }
  for (const file of [
    "iori-cli-hook.mjs",
    "iori-cli-hook.cmd",
    "ORCA-LICENSE.txt",
  ])
    await removeHookFile(join(directory, file));
  try {
    await rmdir(directory);
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      (error.code !== "ENOENT" && error.code !== "ENOTEMPTY")
    )
      throw error;
  }
}
