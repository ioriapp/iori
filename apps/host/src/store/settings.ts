import type { ResultByMethod, WorktreeCreation } from "@iori/protocol";
import {
  type Connection,
  type Mutation,
  type StoreContext,
  succeeded,
} from "./connection.ts";

export function createSettingsRepository({
  database,
  transaction,
  readOperation,
  saveOperation,
  replayOperation,
}: Connection) {
  function listeningPort(): number | undefined {
    const row = database
      .prepare("SELECT value FROM host_settings WHERE key = 'listeningPort'")
      .get() as { value: Uint8Array } | undefined;
    return row ? Number(Buffer.from(row.value).toString()) : undefined;
  }

  function saveListeningPort(port: number): void {
    database
      .prepare(
        "INSERT INTO host_settings(key, value) VALUES ('listeningPort', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(Buffer.from(String(port)));
  }

  function relayCredentials(): Buffer | undefined {
    const row = database
      .prepare("SELECT value FROM host_settings WHERE key = 'relay'")
      .get() as { value: Uint8Array } | undefined;
    return row ? Buffer.from(row.value) : undefined;
  }

  function saveRelayCredentials(value: Buffer): void {
    database
      .prepare(
        "INSERT INTO host_settings(key, value) VALUES ('relay', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(value);
  }
  function worktreeCreation(
    context: StoreContext,
  ): WorktreeCreation | undefined {
    return readOperation(context.clientPublicKey, context.operationId);
  }

  function saveWorktreeCreation(
    context: StoreContext,
    result: WorktreeCreation,
  ): void {
    saveOperation(context, succeeded(result), true);
  }
  function worktreeSetupCommand(rootPath: string): string {
    const row = database
      .prepare(
        "SELECT setup_command FROM worktree_settings WHERE root_path = ?",
      )
      .get(rootPath) as { setup_command: string } | undefined;
    return row?.setup_command ?? "";
  }

  function saveWorktreeSetupCommand(rootPath: string, command: string): void {
    database
      .prepare(
        "INSERT INTO worktree_settings(root_path, setup_command) VALUES (?, ?) ON CONFLICT(root_path) DO UPDATE SET setup_command = excluded.setup_command",
      )
      .run(rootPath, command);
  }

  function repositoryGitAccount(rootPath: string): string {
    const row = database
      .prepare(
        "SELECT github_account FROM repository_git_settings WHERE root_path = ?",
      )
      .get(rootPath) as { github_account: string } | undefined;
    return row?.github_account ?? "";
  }

  function repositoryGitAutoAccount(rootPath: string): string {
    const row = database
      .prepare(
        "SELECT account FROM repository_github_auto_accounts WHERE root_path = ?",
      )
      .get(rootPath) as { account: string } | undefined;
    return row?.account ?? "";
  }

  function saveRepositoryGitAutoAccount(
    rootPath: string,
    account: string,
  ): void {
    if (account)
      database
        .prepare(
          "INSERT INTO repository_github_auto_accounts(root_path, account) VALUES (?, ?) ON CONFLICT(root_path) DO UPDATE SET account = excluded.account",
        )
        .run(rootPath, account);
    else
      database
        .prepare(
          "DELETE FROM repository_github_auto_accounts WHERE root_path = ?",
        )
        .run(rootPath);
  }

  function saveRepositoryGitSettings(
    context: StoreContext,
    rootPath: string,
    values: { setupCommand?: string; githubAccount?: string },
  ): Mutation<ResultByMethod["repository.git.set"]> {
    const previous =
      replayOperation<ResultByMethod["repository.git.set"]>(context);
    if (previous) return { response: previous };
    return transaction(() => {
      if (values.setupCommand !== undefined)
        saveWorktreeSetupCommand(rootPath, values.setupCommand);
      if (values.githubAccount !== undefined)
        database
          .prepare(
            "INSERT INTO repository_git_settings(root_path, github_account) VALUES (?, ?) ON CONFLICT(root_path) DO UPDATE SET github_account = excluded.github_account",
          )
          .run(rootPath, values.githubAccount);
      const response = succeeded({
        setupCommand: worktreeSetupCommand(rootPath),
        githubAccount: repositoryGitAccount(rootPath),
      });
      saveOperation(context, response);
      return { response, changed: true };
    });
  }
  function cliOrder(): string[] {
    const row = database
      .prepare("SELECT value FROM terminal_settings WHERE key = ?")
      .get("cliOrder") as { value: string } | undefined;
    return row ? JSON.parse(row.value) : [];
  }

  function saveCliOrder(order: string[]): void {
    database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("cliOrder", JSON.stringify(order));
  }

  function cliHidden(id: string): boolean {
    const row = database
      .prepare("SELECT value FROM terminal_settings WHERE key = ?")
      .get(`cliHidden:${id}`) as { value: string } | undefined;
    return row?.value === "true";
  }
  function saveCliHidden(id: string, hidden: boolean): void {
    database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(`cliHidden:${id}`, String(hidden));
  }

  function cliStartupArguments(id: string): string {
    const row = database
      .prepare("SELECT value FROM terminal_settings WHERE key = ?")
      .get(`cliArguments:${id}`) as { value: string } | undefined;
    return row?.value ?? "";
  }

  function saveCliStartupArguments(id: string, value: string): void {
    database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(`cliArguments:${id}`, value);
  }

  /** A deleted definition is no longer the CLI that the launcher selects. */
  function forgetLastUsedCli(): void {
    database
      .prepare("DELETE FROM terminal_settings WHERE key = 'lastUsedCli'")
      .run();
  }
  function lastUsedCli(): string | undefined {
    const row = database
      .prepare("SELECT value FROM terminal_settings WHERE key = 'lastUsedCli'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  function setLastUsedCli(id: string): void {
    const opened = openedClis();
    if (!opened.includes(id)) {
      database
        .prepare(
          "INSERT INTO terminal_settings (key, value) VALUES ('openedClis', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(JSON.stringify([...opened, id]));
    }
    database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES ('lastUsedCli', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(id);
  }

  function openedClis(): string[] {
    const row = database
      .prepare("SELECT value FROM terminal_settings WHERE key = 'openedClis'")
      .get() as { value: string } | undefined;
    // Preserve the CLI known to have been opened before this setting existed.
    const previous = lastUsedCli();
    return [
      ...new Set([
        ...(row ? JSON.parse(row.value) : []),
        ...(previous ? [previous] : []),
      ]),
    ];
  }
  function defaultTerminalShell(): string | undefined {
    const row = database
      .prepare("SELECT value FROM terminal_settings WHERE key = 'defaultShell'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  function setDefaultTerminalShell(shell: string): void {
    database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES ('defaultShell', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(shell);
  }
  return {
    listeningPort,
    saveListeningPort,
    relayCredentials,
    saveRelayCredentials,
    worktreeCreation,
    saveWorktreeCreation,
    worktreeSetupCommand,
    saveWorktreeSetupCommand,
    repositoryGitAccount,
    repositoryGitAutoAccount,
    saveRepositoryGitAutoAccount,
    saveRepositoryGitSettings,
    cliOrder,
    saveCliOrder,
    cliHidden,
    saveCliHidden,
    cliStartupArguments,
    saveCliStartupArguments,
    forgetLastUsedCli,
    lastUsedCli,
    setLastUsedCli,
    openedClis,
    defaultTerminalShell,
    setDefaultTerminalShell,
  };
}
