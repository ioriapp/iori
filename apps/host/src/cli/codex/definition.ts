import { sessionTokens } from "./session-tokens.ts";
import { monitorUsage } from "./usage.ts";
import { models } from "./models.ts";
// Launch/detection definition derived from Orca tui-agent-config.ts.
// Copyright (c) 2026 Lovecast Inc.; MIT license: ../ORCA-LICENSE.txt.
// Official icon provenance: apps/client/third-party/cli-icons/README.md.
import type { CliCode } from "../definitions.ts";
import { hooks } from "./hooks.ts";
import {
  allowsAdditionalDirectories,
  permissionContext,
  readConfig,
  usesUnelevatedSandbox,
} from "./config.ts";
function supportsOwnServer(version?: string): boolean {
  const match = /^(\d+)\.(\d+)\./u.exec(version ?? "");
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 156));
}
function supportsReadOnlyProfile(version?: string): boolean {
  const match = /^(\d+)\.(\d+)\./u.exec(version ?? "");
  return Boolean(match && (Number(match[1]) > 0 || Number(match[2]) >= 162));
}
// Session extraction and resume argv adapted from Orca agent-session-resume.ts
// and agent-resume-argv.ts; MIT license: ../ORCA-LICENSE.txt.
// The name, command, model and prompt arguments and resume are in
// definition.json; `-c` values are quoted here.
export const code: CliCode = {
  id: "codex",
  waitForBracketedPaste: true,
  modelCatalog: models,
  sessionTokens,
  supportsUsage: true,
  usageMonitor: monitorUsage,
  observedModel: (payload) =>
    typeof payload.model === "string" ? payload.model : undefined,
  teamArguments: (
    {
      candidate: c,
      instructions,
      initial,
      commandDirectory,
      commandMailboxDirectory,
      version,
      startupArguments,
      startupShell,
      cwd,
    },
    file,
  ) => {
    const config = process.platform === "win32" ? readConfig() : {};
    const profile =
      c.sandbox === "read-only" &&
      commandMailboxDirectory &&
      supportsReadOnlyProfile(version) &&
      (process.platform !== "win32" ||
        (startupShell &&
          !usesUnelevatedSandbox(
            config,
            startupArguments ?? "",
            startupShell,
          )));
    const addDirectory =
      startupShell &&
      allowsAdditionalDirectories(
        config,
        startupArguments ?? "",
        startupShell,
        { ...permissionContext(config, cwd), sandbox: c.sandbox },
      );
    return [
      // The Host shell already loaded profiles. Keep its team command PATH in
      // tool shells; login profiles can replace it on every command.
      ...(commandDirectory ? ["-c", "allow_login_shell=false"] : []),
      // A profile grants the mailbox itself; other managed launches use add-dir.
      // Windows Codex rejects add-dir under read-only and does not start.
      ...(process.platform === "win32" &&
      commandMailboxDirectory &&
      !profile &&
      addDirectory
        ? ["--add-dir", commandMailboxDirectory]
        : []),
      ...file.model,
      ...(c.effort
        ? ["-c", `model_reasoning_effort=${JSON.stringify(c.effort)}`]
        : []),
      ...(c.permission
        ? ["-c", `approval_policy=${JSON.stringify(c.permission)}`]
        : []),
      ...(profile
        ? [
            "-c",
            'default_permissions="iori-read-only"',
            "-c",
            'permissions.iori-read-only.extends=":read-only"',
            "-c",
            `permissions.iori-read-only.filesystem={${JSON.stringify(commandMailboxDirectory)}="write"}`,
          ]
        : c.sandbox
          ? ["-c", `sandbox_mode=${JSON.stringify(c.sandbox)}`]
          : []),
      ...(instructions
        ? ["-c", `developer_instructions=${JSON.stringify(instructions)}`]
        : []),
      // The instructions are developer instructions, never a first prompt.
      ...(initial ? file.prompt : []),
    ];
  },
  session: (payload) =>
    typeof payload.session_id === "string" && payload.session_id.trim()
      ? {
          id: payload.session_id,
          ...(typeof payload.transcript_path === "string"
            ? { file: payload.transcript_path }
            : {}),
        }
      : undefined,
  resumeWithInputArguments: (session, initial) => [
    "resume",
    session.id,
    initial,
  ],
  hooks,
  // The shared daemon cannot own a different hook endpoint for each PTY.
  launchArguments: (version) =>
    supportsOwnServer(version) ? ["--no-daemon"] : [],
  // Tool shells otherwise start as login shells, whose profiles can replace
  // PATH (Debian's /etc/profile does) and lose the `iori` command.
  commandPathArguments: {
    arguments: ["-c", "allow_login_shell=false"],
    option: { names: ["-c", "--config"], keys: ["allow_login_shell"] },
  },
  commandDirectoryArguments: (
    directory,
    startupArguments,
    startupShell,
    cwd,
  ) => {
    if (process.platform !== "win32") return [];
    const config = readConfig();
    return allowsAdditionalDirectories(
      config,
      startupArguments,
      startupShell,
      permissionContext(config, cwd),
    )
      ? ["--add-dir", directory]
      : [];
  },
  supportsHooks: supportsOwnServer,
};
