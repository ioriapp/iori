import {
  startupArgumentWords,
  startupArgumentsSet,
  teamStartupArguments,
} from "./team-startup-arguments.ts";
import type { CliHooks } from "./hooks.ts";
import type { CliSummary } from "@iori/protocol";
import type { ShellDefinition } from "../terminal/platform.ts";
import type { CliDefinition, TeamLaunch } from "./definitions.ts";
import { shellCommand, formatShellCommand } from "./shell-command.ts";

export interface LaunchOptions {
  cwd?: string;
  waitForVersion?: boolean;
  arguments?: readonly string[];
  execution?: {
    candidate: import("@iori/protocol").Candidate;
    initial?: string;
    teamFilesDirectory?: string;
  };
  /** The command directory of this CLI's session outside a team. */
  commandDirectory?: string;
}
export interface CliLaunch {
  cli: CliSummary;
  command: string;
  hooks?: CliHooks;
  initialInput?: string;
  storedCommand?: string;
  env?: Record<string, string>;
}
export async function buildCliLaunch(
  definition: CliDefinition,
  resolved: string,
  shell: ShellDefinition,
  savedArguments: string,
  version: string | undefined,
  hooksReady: boolean,
  team?: TeamLaunch,
  options?: LaunchOptions,
): Promise<CliLaunch> {
  const execution =
    team ??
    (options?.execution
      ? {
          ...options.execution,
          instructionFile: "",
          trustWorkspace: false,
          commandDirectory: "",
          commandMailboxDirectory: options.commandDirectory,
          teamFilesDirectory: options.execution.teamFilesDirectory ?? "",
          instructions: "",
        }
      : undefined);
  // Only options that reach the CLI can override the generated role settings.
  if (execution && !startupArgumentWords(savedArguments, shell))
    savedArguments = "";
  const {
    modelCatalog: _modelCatalog,
    session: _session,
    resumeArguments: _resumeArguments,
    resumeWithTeamPrompt: _resumeWithTeamPrompt,
    command: _command,
    hooks,
    launchArguments,
    supportsHooks,
    observedModel: _observedModel,
    teamArguments,
    managedTeamArguments,
    teamEnvironment,
    launchEnvironment,
    teamInput,
    waitForBracketedPaste: _waitForBracketedPaste,
    waitForInputCursor: _waitForInputCursor,
    teamCommandDirectory: _teamCommandDirectory,
    commandPathArguments,
    commandDirectoryArguments,
    aliases: _aliases,
    versionArguments: _versionArguments,
    commandLine,
    ...cli
  } = definition;
  // The user's own setting of the option is kept (linked-agents.md).
  const commandPath =
    !team &&
    commandPathArguments &&
    !startupArgumentsSet(savedArguments, shell, commandPathArguments.option)
      ? commandPathArguments.arguments
      : [];
  // The session's directory belongs to this launch only, never to the
  // stored command that a resume starts from.
  const session =
    !execution && options?.commandDirectory
      ? (commandDirectoryArguments?.(
          options.commandDirectory,
          savedArguments,
          shell,
          options.cwd,
        ) ?? [])
      : [];
  const args = [
    ...(launchArguments?.(version, Boolean(team)) ?? []),
    ...commandPath,
    ...session,
    ...(execution
      ? (teamArguments?.({
          ...execution,
          cwd: options?.cwd,
          version,
          startupArguments: savedArguments,
          startupShell: shell,
        }) ?? [])
      : []),
  ];
  const resumeArgs = [
    ...(launchArguments?.(version, Boolean(team)) ?? []),
    ...commandPath,
    ...(execution
      ? (teamArguments?.({
          ...execution,
          cwd: options?.cwd,
          version,
          initial: undefined,
          commandMailboxDirectory: undefined,
          teamFilesDirectory: "",
        }) ?? [])
      : []),
  ];
  const userArguments = (args: readonly string[]) =>
    execution
      ? teamStartupArguments(
          savedArguments,
          shell,
          // Without a role, a repeatable option has no team value to protect.
          team
            ? (managedTeamArguments ?? [])
            : (managedTeamArguments ?? []).filter(
                (option) => option.arity !== "many",
              ),
          args,
        )
      : savedArguments;
  const launchArgs = [...args, ...(options?.arguments ?? [])];
  return {
    cli,
    ...(execution || launchEnvironment
      ? {
          env: {
            ...(execution ? teamEnvironment?.(execution) : {}),
            ...launchEnvironment?.(
              execution ? { ...execution, version } : undefined,
            ),
          },
        }
      : {}),
    command: await shellCommand(resolved, launchArgs, shell, {
      commandLine: definition.commandLine,
      rawArguments: userArguments(args),
    }),
    // Persist the same CLI expression as before, never resolved Node paths.
    storedCommand: formatShellCommand(
      resolved,
      !team ? resumeArgs : [],
      shell,
      {
        commandLine: definition.commandLine,
        rawArguments: userArguments(resumeArgs),
        stored: true,
      },
    ),
    ...(execution && teamInput?.(execution) !== undefined
      ? { initialInput: teamInput(execution) }
      : {}),
    hooks: hooksReady && (supportsHooks?.(version) ?? true) ? hooks : undefined,
  };
}
