import { openConnection } from "./store/connection.ts";
export type { StoreContext, Mutation } from "./store/connection.ts";
export {
  INVITE_LIFETIME_MS,
  type CurrentInvite,
  type HostIdentity,
} from "./store/devices.ts";
export type {
  StoredCli,
  StoredTerminal,
  StoredWorktreeSetup,
  WorktreeSetup,
} from "./store/terminals.ts";
import { createAutomationsRepository } from "./store/automations.ts";
import { createDevicesRepository } from "./store/devices.ts";
import { createFoldersRepository } from "./store/folders.ts";
import { createForgeRepository } from "./store/forge.ts";
import { createSettingsRepository } from "./store/settings.ts";
import { createTeamsRepository } from "./store/teams.ts";
import { createTerminalsRepository } from "./store/terminals.ts";

function repositories(path: string) {
  const connection = openConnection(path);
  return {
    close: () => connection.database.close(),
    transaction: connection.transaction,
    replayOperation: connection.replayOperation,
    terminalOperationResult: connection.terminalOperationResult,
    saveTerminalOperationResult: connection.saveTerminalOperationResult,
    ...createAutomationsRepository(connection),
    ...createDevicesRepository(connection),
    ...createFoldersRepository(connection),
    ...createForgeRepository(connection),
    ...createSettingsRepository(connection),
    ...createTeamsRepository(connection),
    ...createTerminalsRepository(connection),
  };
}

type Repositories = ReturnType<typeof repositories>;
export interface HostStore extends Repositories {}
export class HostStore {
  constructor(path: string) {
    Object.assign(this, repositories(path));
  }
}
