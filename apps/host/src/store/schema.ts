import type { DatabaseSync } from "node:sqlite";

export function initializeSchema(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS automation_webhook_tokens (
      automation_id TEXT PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE,
      token TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_issue_start (
      automation_id TEXT PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      scheduled_at INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      value_json TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS automation_scheduled_run ON automation_runs(automation_id, scheduled_at) WHERE trigger = 'schedule';
    CREATE TABLE IF NOT EXISTS team_conversations (id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS team_tasks (id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS team_children (id TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      definition_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_versions (
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      value_json TEXT NOT NULL,
      PRIMARY KEY(team_id, version)
    );
    CREATE TABLE IF NOT EXISTS team_settings (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      public_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      registered_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      device_public_key TEXT PRIMARY KEY REFERENCES devices(public_key) ON DELETE CASCADE,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terminal_clis (
      terminal_id TEXT PRIMARY KEY REFERENCES terminals(id) ON DELETE CASCADE,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invite (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      secret TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      issuer_operation_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_results (
      client_public_key TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client_public_key, operation_id)
    );
    CREATE TABLE IF NOT EXISTS terminals (
      id TEXT PRIMARY KEY,
      shell TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      exit_code INTEGER,
      cols INTEGER NOT NULL,
      rows INTEGER NOT NULL,
      last_desktop_cols INTEGER NOT NULL,
      last_desktop_rows INTEGER NOT NULL,
      restart_pending INTEGER NOT NULL DEFAULT 0,
      snapshot_json TEXT,
      image_sequence INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terminal_worktrees (
      terminal_id TEXT PRIMARY KEY REFERENCES terminals(id) ON DELETE CASCADE,
      path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forge_mappings (
      remote_host TEXT PRIMARY KEY,
      web_url TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS forge_tokens (
      origin TEXT PRIMARY KEY,
      storage TEXT NOT NULL,
      account TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS host_settings (
      key TEXT PRIMARY KEY,
      value BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terminal_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS worktree_settings (
      root_path TEXT PRIMARY KEY,
      setup_command TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repository_git_settings (
      root_path TEXT PRIMARY KEY,
      github_account TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repository_github_auto_accounts (
      root_path TEXT PRIMARY KEY,
      account TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terminal_setups (
      terminal_id TEXT PRIMARY KEY REFERENCES terminals(id) ON DELETE CASCADE,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS folder_history (
      path TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('folder', 'git')),
      opened_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sidebar_order (
      workspace_path TEXT PRIMARY KEY,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sidebar_targets (
      workspace_path TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('folder', 'git')),
      opened_at INTEGER NOT NULL
    );
  `);
  const teamColumns = database.prepare("PRAGMA table_info(teams)").all() as {
    name: string;
  }[];
  if (!teamColumns.some((column) => column.name === "hidden"))
    database.exec(
      "ALTER TABLE teams ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
    );
  const terminalColumns = database
    .prepare("PRAGMA table_info(terminals)")
    .all() as { name: string }[];
  if (!terminalColumns.some((column) => column.name === "image_sequence"))
    database.exec(
      "ALTER TABLE terminals ADD COLUMN image_sequence INTEGER NOT NULL DEFAULT 0",
    );
  const operationColumns = database
    .prepare("PRAGMA table_info(operation_results)")
    .all();
  if (!operationColumns.some((column) => column.name === "created_at"))
    database.exec(
      "ALTER TABLE operation_results ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
    );
}
