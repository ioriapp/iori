import {
  CommandReceiver,
  commandFailure,
} from "../terminal/daemon/command-receiver.ts";
import {
  parseCommand,
  commandHelp,
  forgeCommandHelp,
  worktreeSetupHelp,
  isTeamCommand,
  type TeamCommand,
} from "./commands.ts";
import { parseForgeCommand, type ForgeCommand } from "../forge-commands.ts";
import type {
  Caller,
  CommandResult,
} from "../terminal/daemon/command-receiver.ts";
export { commandFailure };
export type { Caller, CommandResult };
/** A CLI that iori started outside a team, named by its Terminal. */
export type CliCaller = { terminal: string };
/** The CLI that called `iori`. The Host gave it this identity with its route. */
export type CommandCaller = Caller | CliCaller;
export type CommandHandlers = {
  team: (caller: Caller, command: TeamCommand) => Promise<CommandResult>;
  forge: (
    caller: CommandCaller,
    command: ForgeCommand,
  ) => Promise<CommandResult>;
};
/** Every CLI may read the Forge; only a team's parent and children use the team commands. */
export function executeRawCommand(
  handlers: CommandHandlers,
  caller: CommandCaller,
  argv: unknown,
): Promise<CommandResult> {
  const team = "conversation" in caller;
  try {
    if (Array.isArray(argv) && (!argv.length || argv.includes("--help")))
      return Promise.resolve({
        ok: true,
        text: `${team ? commandHelp : forgeCommandHelp}\n\n${worktreeSetupHelp}`,
      });
    const forge = parseForgeCommand(argv);
    if (forge) return handlers.forge(caller, forge).catch(commandFailure);
    if (!team)
      return Promise.resolve({
        ok: false,
        text:
          Array.isArray(argv) && isTeamCommand(argv[0])
            ? `Only a CLI in an iori team conversation can use iori ${String(argv[0])}.\n${forgeCommandHelp}`
            : forgeCommandHelp,
      });
    return handlers.team(caller, parseCommand(argv)).catch(commandFailure);
  } catch (error) {
    return Promise.resolve(commandFailure(error));
  }
}
export class LocalTeamCommand extends CommandReceiver {
  constructor(
    execute: (caller: Caller, command: TeamCommand) => Promise<CommandResult>,
  ) {
    super((caller, argv) =>
      executeRawCommand(
        {
          team: execute,
          forge: () =>
            Promise.resolve({ ok: false, text: "No Forge in this receiver." }),
        },
        caller,
        argv,
      ),
    );
  }
}
