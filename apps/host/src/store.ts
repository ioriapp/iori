import { nameOrder } from "@iori/protocol";
import { cliDefinitions } from "./cli/definitions.ts";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  Team,
  TeamDefinition,
  TeamRecord,
  TeamSettings,
  TeamMethod,
  TeamParamsByMethod,
  TeamResultByMethod,
} from "@iori/protocol";
import { englishTemplates, templates } from "./team-templates.ts";
import { teamChanges } from "./team-changes.ts";
import { createHash, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  Device,
  Event,
  FolderHistoryItem,
  ForgeMapping,
  HostInfo,
  Invite,
  ProtocolErrorCode,
  Response,
  ResultByMethod,
  TerminalModes,
  TerminalOscLinkRange,
  TerminalSummary,
  TerminalState,
} from "@iori/protocol";

export const INVITE_LIFETIME_MS = 10 * 60 * 1000;

export interface HostIdentity {
  publicKey: string;
  hostName: string;
  os: string;
}

export interface StoreContext {
  clientPublicKey: string;
  operationId: string;
}

export interface Mutation<T> {
  response: Response<T>;
  event?: Event;
  revokedPublicKey?: string;
  changed?: boolean;
}

interface InviteRow {
  secret: string;
  expires_at: number;
  issuer_operation_id: string;
}

export interface CurrentInvite {
  operationId: string;
  expiresAt: number;
}

interface DeviceRow {
  public_key: string;
  name: string;
  registered_at: number;
}

interface OperationRow {
  result_json: string;
}

export interface StoredCli {
  candidate?: import("@iori/protocol").Candidate;
  cli: import("@iori/protocol").CliSummary;
  command: string;
  observed?: boolean;
  session?: import("@iori/protocol").CliSession;
  resumePending?: boolean;
  runtime?: {
    marker?: string;
    observedModel?: string;
    userInputSinceActivity?: boolean;
    ready: boolean;
    shellReady?: boolean;
    status?: import("@iori/protocol").CliStatus;
    managed: boolean;
    /** A CLI typed in this shell puts the `iori` command's location on PATH. */
    commandPath?: boolean;
    /** Non-secret command route passed when the surviving PTY was spawned. */
    commandSession?: string;
    pendingCommand?: string;
    initialInput?: string;
    pendingLines: { line: string; deliveryId?: string }[];
    initialDeliveryIds?: string[];
  };
}
export interface WorktreeSetup {
  command: string;
  rootPath: string;
}
export interface StoredWorktreeSetup extends WorktreeSetup {
  cliCommand?: string;
  state: "running" | "failed";
  exitCode?: number;
}
export interface StoredTerminal extends TerminalSummary {
  state: TerminalState;
  imageSequence: number;
  snapshot: {
    snapshotAnsi: string;
    scrollbackAnsi: string;
    oscLinks?: TerminalOscLinkRange[];
    frameRestoreAnsi?: string;
    rehydrateSequences: string;
    modes: TerminalModes;
    cols: number;
    rows: number;
    pendingEscapeTailAnsi?: string;
  } | null;
  createdAt: number;
}

interface TerminalRow {
  id: string;
  shell: string;
  cwd: string;
  title: string;
  state: StoredTerminal["state"];
  exit_code: number | null;
  cols: number;
  rows: number;
  last_desktop_cols: number;
  last_desktop_rows: number;
  restart_pending: number;
  snapshot_json: string | null;
  image_sequence: number;
  created_at: number;
}

type TerminalSummaryRow = Omit<TerminalRow, "snapshot_json">;

interface FolderHistoryRow {
  path: string;
  workspace_path: string;
  kind: "folder" | "git";
  opened_at: number;
  in_sidebar: number;
}

function failure(code: ProtocolErrorCode): Response<never> {
  return { ok: false, error: { code } };
}

function succeeded<T>(result: T): Response<T> {
  return { ok: true, result };
}

function toDevice(row: DeviceRow): Device {
  return {
    publicKey: row.public_key,
    name: row.name,
    registeredAt: row.registered_at,
  };
}

function toStoredTerminal(row: TerminalRow): StoredTerminal {
  return {
    ...toStoredTerminalSummary(row),
    snapshot:
      row.snapshot_json === null
        ? null
        : (JSON.parse(row.snapshot_json) as StoredTerminal["snapshot"]),
  };
}

function toStoredTerminalSummary(row: TerminalSummaryRow): StoredTerminal {
  return {
    id: row.id,
    shell: row.shell,
    cwd: row.cwd,
    title: row.title,
    state: row.state,
    exitCode: row.exit_code,
    cols: row.cols,
    rows: row.rows,
    lastDesktopSize: {
      cols: row.last_desktop_cols,
      rows: row.last_desktop_rows,
    },
    restartPending: row.restart_pending !== 0,
    imageSequence: row.image_sequence,
    snapshot: null,
    createdAt: row.created_at,
  };
}

const TERMINAL_SUMMARY_COLUMNS =
  "id, shell, cwd, title, state, exit_code, cols, rows, last_desktop_cols, last_desktop_rows, restart_pending, image_sequence, created_at";

export class HostStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec(`
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
    const teamColumns = this.#database
      .prepare("PRAGMA table_info(teams)")
      .all() as { name: string }[];
    if (!teamColumns.some((column) => column.name === "hidden"))
      this.#database.exec(
        "ALTER TABLE teams ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0",
      );
    const terminalColumns = this.#database
      .prepare("PRAGMA table_info(terminals)")
      .all() as { name: string }[];
    if (!terminalColumns.some((column) => column.name === "image_sequence"))
      this.#database.exec(
        "ALTER TABLE terminals ADD COLUMN image_sequence INTEGER NOT NULL DEFAULT 0",
      );
  }

  automations(): import("@iori/protocol").Automation[] {
    return (
      this.#database
        .prepare(
          "SELECT a.value_json, t.token FROM automations a LEFT JOIN automation_webhook_tokens t ON t.automation_id = a.id ORDER BY a.rowid",
        )
        .all() as { value_json: string; token: string | null }[]
    ).map((row) => ({
      ...JSON.parse(row.value_json),
      ...(row.token === null ? {} : { webhookToken: row.token }),
    }));
  }
  putAutomation(value: import("@iori/protocol").Automation): void {
    const { webhookToken, ...definition } = value;
    this.#transaction(() => {
      const old = this.automations().find(
        (automation) => automation.id === value.id,
      );
      this.#database
        .prepare(
          "INSERT INTO automations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json",
        )
        .run(value.id, JSON.stringify(definition));
      if (value.issue && (!old?.issue || (value.enabled && !old.enabled))) {
        this.#database
          .prepare(
            "INSERT INTO automation_issue_start VALUES (?, ?) ON CONFLICT(automation_id) DO UPDATE SET started_at = excluded.started_at",
          )
          .run(value.id, Date.now());
      }
      if (value.webhook) {
        this.#database
          .prepare(
            "INSERT OR IGNORE INTO automation_webhook_tokens VALUES (?, ?)",
          )
          .run(value.id, webhookToken ?? randomBytes(32).toString("base64url"));
      }
    });
  }
  automationIssueStart(id: string): number | undefined {
    const row = this.#database
      .prepare(
        "SELECT started_at FROM automation_issue_start WHERE automation_id = ?",
      )
      .get(id) as { started_at: number } | undefined;
    return row?.started_at;
  }
  regenerateAutomationToken(id: string): void {
    this.#database
      .prepare(
        "UPDATE automation_webhook_tokens SET token = ? WHERE automation_id = ?",
      )
      .run(randomBytes(32).toString("base64url"), id);
  }
  deleteAutomation(id: string): void {
    this.#database.prepare("DELETE FROM automations WHERE id = ?").run(id);
  }
  automationRuns(id: string): import("@iori/protocol").AutomationRun[] {
    return (
      this.#database
        .prepare(
          "SELECT value_json FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_at DESC, rowid DESC",
        )
        .all(id) as { value_json: string }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  automationRun(
    id: string,
  ): import("@iori/protocol").AutomationRun | undefined {
    const row = this.#database
      .prepare("SELECT value_json FROM automation_runs WHERE id = ?")
      .get(id) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) : undefined;
  }
  claimAutomationRun(value: import("@iori/protocol").AutomationRun): boolean {
    return (
      this.#database
        .prepare("INSERT OR IGNORE INTO automation_runs VALUES (?, ?, ?, ?, ?)")
        .run(
          value.id,
          value.automationId,
          value.scheduledAt,
          value.trigger,
          JSON.stringify(value),
        ).changes !== 0
    );
  }
  putAutomationRun(value: import("@iori/protocol").AutomationRun): void {
    this.#database
      .prepare("UPDATE automation_runs SET value_json = ? WHERE id = ?")
      .run(JSON.stringify(value), value.id);
  }
  teamConversations(): import("./teams/records.ts").TeamConversation[] {
    return (
      this.#database
        .prepare("SELECT value_json FROM team_conversations")
        .all() as { value_json: string }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  teamTasks(): import("./teams/records.ts").TeamTask[] {
    return (
      this.#database.prepare("SELECT value_json FROM team_tasks").all() as {
        value_json: string;
      }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  teamChildren(): import("./teams/records.ts").TeamChild[] {
    return (
      this.#database.prepare("SELECT value_json FROM team_children").all() as {
        value_json: string;
      }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  putTeamConversation(
    value: import("./teams/records.ts").TeamConversation,
  ): void {
    this.#database
      .prepare("INSERT OR REPLACE INTO team_conversations VALUES (?, ?)")
      .run(value.id, JSON.stringify(value));
  }
  putTeamTask(value: import("./teams/records.ts").TeamTask): void {
    this.#database
      .prepare("INSERT OR REPLACE INTO team_tasks VALUES (?, ?)")
      .run(value.id, JSON.stringify(value));
  }
  putTeamChild(value: import("./teams/records.ts").TeamChild): void {
    this.#database
      .prepare("INSERT OR REPLACE INTO team_children VALUES (?, ?)")
      .run(value.id, JSON.stringify(value));
  }

  teamSettings(): TeamSettings {
    const row = this.#database
      .prepare("SELECT value_json FROM team_settings WHERE singleton = 1")
      .get() as { value_json: string } | undefined;
    return row
      ? (JSON.parse(row.value_json) as TeamSettings)
      : { enabled: false, defaultTeam: "", limits: {} };
  }
  #saveTeamSettings(settings: TeamSettings): void {
    this.#database
      .prepare(
        "INSERT OR REPLACE INTO team_settings(singleton, value_json) VALUES (1, ?)",
      )
      .run(JSON.stringify(settings));
  }
  readTeam(id: string): (TeamRecord & { hidden: boolean }) | undefined {
    const row = this.#database
      .prepare(
        "SELECT definition_json, version, updated, hidden FROM teams WHERE id = ?",
      )
      .get(id) as
      | {
          definition_json: string;
          version: number;
          updated: string;
          hidden: number;
        }
      | undefined;
    if (!row) return undefined;
    const history = this.#database
      .prepare(
        "SELECT value_json FROM team_versions WHERE team_id = ? ORDER BY version DESC",
      )
      .all(id) as { value_json: string }[];
    return {
      hidden: row.hidden === 1,
      saved: {
        ...(JSON.parse(row.definition_json) as TeamDefinition),
        id,
        version: row.version,
        updated: row.updated,
      },
      history: history.map((h) => JSON.parse(h.value_json)),
    };
  }
  listTeams(): TeamResultByMethod["teams.list"] {
    const rows = this.#database.prepare("SELECT id FROM teams").all() as {
      id: string;
    }[];
    const teams = rows
      .map((r) => this.readTeam(r.id)!)
      .sort((a, b) => nameOrder(a.saved, b.saved));
    return {
      ...this.teamSettings(),
      teams,
      templates,
      usageClis: cliDefinitions
        .filter((cli) => cli.supportsUsage)
        .map((cli) => cli.id),
      cliNames: Object.fromEntries([
        ...cliDefinitions.map((cli) => [cli.id, cli.name]),
        ...teams
          .flatMap((record) => [
            ...record.history.map((entry) => entry.team),
            record.saved,
          ])
          .flatMap((team) => [
            team.parent,
            ...team.roles.flatMap((role) =>
              Object.values(role.candidates).flat(),
            ),
          ])
          .filter((candidate) => candidate.cliName)
          .map((candidate) => [candidate.cli, candidate.cliName!]),
      ]),
    };
  }
  /** Synchronous SQLite transaction owns definitions, history and operation result together. */
  teamOperation<M extends Exclude<TeamMethod, "cli.models" | "cli.help">>(
    context: StoreContext,
    method: M,
    params: TeamParamsByMethod[M],
  ): Response<TeamResultByMethod[M]> {
    if (method === "teams.list")
      return succeeded(this.listTeams()) as Response<TeamResultByMethod[M]>;
    const p = params as TeamParamsByMethod["teams.save"] &
      TeamParamsByMethod["teams.memo"] &
      TeamParamsByMethod["teams.create"] &
      TeamParamsByMethod["teams.hidden.set"] &
      TeamSettings;
    if (method === "teams.read") {
      const team = this.readTeam(p.teamId);
      return team
        ? (succeeded(team) as Response<TeamResultByMethod[M]>)
        : failure("invalid_request");
    }
    const previous =
      this.terminalOperationResult<TeamResultByMethod[M]>(context);
    if (previous) return succeeded(previous);
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      let result: unknown;
      if (method === "teams.settings") {
        const settings = params as TeamSettings;
        result = {
          ...settings,
          defaultTeam:
            settings.defaultTeam &&
            this.readTeam(settings.defaultTeam) &&
            !this.readTeam(settings.defaultTeam)!.hidden
              ? settings.defaultTeam
              : "",
        };
        this.#saveTeamSettings(result as TeamSettings);
      } else if (method === "teams.create" || method === "teams.duplicate") {
        const definition =
          method === "teams.duplicate"
            ? this.readTeam(p.teamId)?.saved
            : (p.definition ??
              (p.template
                ? (p.language === "en" ? englishTemplates : templates)[
                    p.template
                  ]
                : this.readTeam(p.sourceId!)?.saved));
        if (!definition) {
          this.#database.exec("ROLLBACK");
          return failure("invalid_request");
        }
        const fresh = structuredClone(definition);
        if (p.name !== undefined) fresh.name = p.name;
        fresh.parent.id = randomUUID();
        for (const role of fresh.roles) {
          role.id = randomUUID();
          for (const candidate of Object.values(role.candidates).flat())
            candidate.id = randomUUID();
        }
        result = this.#writeTeam(randomUUID(), fresh);
      } else {
        const record = this.readTeam(p.teamId);
        if (!record) {
          this.#database.exec("ROLLBACK");
          return failure("invalid_request");
        }
        if (method === "teams.hidden.set") {
          this.#database
            .prepare("UPDATE teams SET hidden = ? WHERE id = ?")
            .run(p.hidden ? 1 : 0, p.teamId);
          const settings = this.teamSettings();
          if (p.hidden && settings.defaultTeam === p.teamId)
            this.#saveTeamSettings({ ...settings, defaultTeam: "" });
          result = { teamId: p.teamId, hidden: p.hidden };
        } else if (method === "teams.save")
          result = this.#writeTeam(p.teamId, p.definition, record);
        else if (method === "teams.delete") {
          this.#database
            .prepare("DELETE FROM teams WHERE id = ?")
            .run(p.teamId);
          const settings = this.teamSettings();
          if (settings.defaultTeam === p.teamId)
            this.#saveTeamSettings({ ...settings, defaultTeam: "" });
          result = { teamId: p.teamId };
        } else {
          const entry = record.history.find(
            (h) => h.team.version === p.version,
          );
          if (!entry) {
            this.#database.exec("ROLLBACK");
            return failure("invalid_request");
          }
          if (method === "teams.restore")
            result = this.#writeTeam(p.teamId, entry.team, record, p.version);
          else {
            entry.memo = p.memo;
            this.#database
              .prepare(
                "UPDATE team_versions SET value_json = ? WHERE team_id = ? AND version = ?",
              )
              .run(JSON.stringify(entry), p.teamId, p.version);
            result = this.readTeam(p.teamId);
          }
        }
      }
      this.saveTerminalOperationResult(context, result);
      this.#database.exec("COMMIT");
      return succeeded(result as TeamResultByMethod[M]);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
  #writeTeam(
    id: string,
    definition: TeamDefinition,
    before?: TeamRecord,
    restoredFrom?: number,
  ): TeamRecord {
    const { name, description, parent, instruction, roles } = definition;
    const clean = structuredClone({
      name,
      description,
      parent,
      instruction,
      roles,
    });
    const names = new Map([
      ...cliDefinitions.map((cli) => [cli.id, cli.name] as const),
    ]);
    for (const candidate of [
      clean.parent,
      ...clean.roles.flatMap((role) => Object.values(role.candidates).flat()),
    ]) {
      const cliName = names.get(candidate.cli);
      if (cliName) candidate.cliName = cliName;
    }
    const team: Team = {
      ...clean,
      id,
      version: (before?.saved.version ?? 0) + 1,
      updated: new Date().toISOString(),
    };
    const history = {
      team,
      summary: before ? "" : "Team created",
      ...(restoredFrom === undefined
        ? before
          ? { changes: teamChanges(before.saved, team) }
          : {}
        : { restoredFrom }),
    };
    this.#database
      .prepare(
        "INSERT INTO teams(id, definition_json, version, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition_json = excluded.definition_json, version = excluded.version, updated = excluded.updated",
      )
      .run(id, JSON.stringify(clean), team.version, team.updated);
    this.#database
      .prepare(
        "INSERT INTO team_versions(team_id, version, value_json) VALUES (?, ?, ?)",
      )
      .run(id, team.version, JSON.stringify(history));
    return this.readTeam(id)!;
  }

  close(): void {
    this.#database.close();
  }

  listeningPort(): number | undefined {
    const row = this.#database
      .prepare("SELECT value FROM host_settings WHERE key = 'listeningPort'")
      .get() as { value: Uint8Array } | undefined;
    return row ? Number(Buffer.from(row.value).toString()) : undefined;
  }

  saveListeningPort(port: number): void {
    this.#database
      .prepare(
        "INSERT INTO host_settings(key, value) VALUES ('listeningPort', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(Buffer.from(String(port)));
  }

  relayCredentials(): Buffer | undefined {
    const row = this.#database
      .prepare("SELECT value FROM host_settings WHERE key = 'relay'")
      .get() as { value: Uint8Array } | undefined;
    return row ? Buffer.from(row.value) : undefined;
  }

  saveRelayCredentials(value: Buffer): void {
    this.#database
      .prepare(
        "INSERT INTO host_settings(key, value) VALUES ('relay', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(value);
  }

  hostInfo(identity: HostIdentity, addresses: string[]): HostInfo {
    return {
      publicKey: identity.publicKey,
      hostName: identity.hostName,
      os: identity.os,
      addresses,
    };
  }

  isRegistered(publicKey: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 FROM devices WHERE public_key = ?")
        .get(publicKey) !== undefined
    );
  }

  currentInvite(): CurrentInvite | undefined {
    const row = this.#database
      .prepare(
        "SELECT issuer_operation_id, expires_at FROM invite WHERE singleton = 1",
      )
      .get() as { issuer_operation_id: string; expires_at: number } | undefined;
    if (!row) return undefined;
    return {
      operationId: row.issuer_operation_id,
      expiresAt: row.expires_at,
    };
  }

  listDevices(): Device[] {
    const rows = this.#database
      .prepare(
        "SELECT public_key, name, registered_at FROM devices ORDER BY registered_at, public_key",
      )
      .all() as unknown as DeviceRow[];
    return rows.map(toDevice);
  }

  snapshot(
    identity: HostIdentity,
    addresses: string[],
    currentDevicePublicKey: string,
  ): Event {
    return {
      type: "snapshot",
      host: this.hostInfo(identity, addresses),
      devices: this.listDevices(),
      currentDevicePublicKey,
    };
  }

  info(identity: HostIdentity, addresses: string[]): Response<HostInfo> {
    return succeeded(this.hostInfo(identity, addresses));
  }

  replayOperation<T>(context: StoreContext): Response<T> | undefined {
    const previous = this.#readOperation<T>(
      context.clientPublicKey,
      context.operationId,
    );
    return previous === undefined ? undefined : succeeded(previous);
  }

  removeTeamConversation(id: string): void {
    this.#database
      .prepare("DELETE FROM team_conversations WHERE id = ?")
      .run(id);
  }
  removeTeamChild(id: string): void {
    this.#database.prepare("DELETE FROM team_children WHERE id = ?").run(id);
  }
  removeTeamTask(id: string): void {
    this.#database.prepare("DELETE FROM team_tasks WHERE id = ?").run(id);
  }

  worktreeCreation(
    context: StoreContext,
  ): import("@iori/protocol").WorktreeCreation | undefined {
    return this.#readOperation(context.clientPublicKey, context.operationId);
  }

  saveWorktreeCreation(
    context: StoreContext,
    result: import("@iori/protocol").WorktreeCreation,
  ): void {
    this.#database
      .prepare(
        "INSERT INTO operation_results (client_public_key, operation_id, result_json) VALUES (?, ?, ?) ON CONFLICT(client_public_key, operation_id) DO UPDATE SET result_json = excluded.result_json",
      )
      .run(
        context.clientPublicKey,
        context.operationId,
        JSON.stringify(result),
      );
  }

  sidebarOrder(): string[] {
    return (
      this.#database
        .prepare(
          `SELECT sidebar_targets.workspace_path
      FROM sidebar_targets LEFT JOIN sidebar_order USING (workspace_path)
      ORDER BY sidebar_order.position IS NULL, sidebar_order.position, sidebar_targets.rowid`,
        )
        .all() as { workspace_path: string }[]
    ).map((row) => row.workspace_path);
  }

  reorderSidebar(
    context: StoreContext,
    paths: string[],
  ): Mutation<ResultByMethod["folders.sidebar.reorder"]> {
    const previous =
      this.replayOperation<ResultByMethod["folders.sidebar.reorder"]>(context);
    if (previous) return { response: previous };
    return this.#transaction(() => {
      const current = this.sidebarOrder();
      const order = [
        ...new Set([
          ...paths.filter((path) => current.includes(path)),
          ...current,
        ]),
      ];
      this.#database.prepare("DELETE FROM sidebar_order").run();
      const insert = this.#database.prepare(
        "INSERT INTO sidebar_order (workspace_path, position) VALUES (?, ?)",
      );
      order.forEach((path, position) => insert.run(path, position));
      const response = succeeded({ paths: order });
      this.#saveOperation(context, response);
      return { response, changed: true };
    });
  }

  folderHistory(): FolderHistoryItem[] {
    const order = this.sidebarOrder();
    const rows = this.#database
      .prepare(
        `SELECT folder_history.path, folder_history.workspace_path,
                folder_history.kind, folder_history.opened_at,
                CASE WHEN sidebar_targets.workspace_path IS NULL THEN 0 ELSE 1 END AS in_sidebar
         FROM folder_history
         LEFT JOIN sidebar_targets
           ON sidebar_targets.workspace_path = folder_history.workspace_path
         ORDER BY folder_history.opened_at DESC, folder_history.path`,
      )
      .all() as unknown as FolderHistoryRow[];
    const sidebarRepresentatives = new Set<string>();
    return rows.map((row) => {
      const inSidebar =
        row.in_sidebar !== 0 && !sidebarRepresentatives.has(row.workspace_path);
      if (inSidebar) sidebarRepresentatives.add(row.workspace_path);
      return {
        path: row.path,
        workspacePath: row.workspace_path,
        kind: row.kind,
        openedAt: row.opened_at,
        inSidebar,
        sidebarPosition: order.indexOf(row.workspace_path) + 1,
      };
    });
  }

  isSidebarTarget(path: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 FROM sidebar_targets WHERE workspace_path = ?")
        .get(path) !== undefined
    );
  }

  openFolder(
    context: StoreContext,
    folder: FolderHistoryItem,
  ): Mutation<ResultByMethod["folders.open"]> {
    const previous = this.#readOperation<ResultByMethod["folders.open"]>(
      context.clientPublicKey,
      context.operationId,
    );
    if (previous) return { response: succeeded(previous) };

    return this.#transaction(() => {
      const concurrentPrevious = this.#readOperation<
        ResultByMethod["folders.open"]
      >(context.clientPublicKey, context.operationId);
      if (concurrentPrevious)
        return { response: succeeded(concurrentPrevious) };
      this.#database
        .prepare(
          `INSERT INTO folder_history (path, workspace_path, kind, opened_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             workspace_path = excluded.workspace_path,
             kind = excluded.kind,
             opened_at = excluded.opened_at`,
        )
        .run(folder.path, folder.workspacePath, folder.kind, folder.openedAt);
      this.#database
        .prepare(
          `INSERT INTO sidebar_targets (workspace_path, kind, opened_at)
           VALUES (?, ?, ?)
           ON CONFLICT(workspace_path) DO UPDATE SET kind = excluded.kind`,
        )
        .run(folder.workspacePath, folder.kind, folder.openedAt);
      const response = succeeded({
        folder: {
          ...folder,
          sidebarPosition:
            this.sidebarOrder().indexOf(folder.workspacePath) + 1,
        },
      });
      this.#saveOperation(context, response);
      return { response, changed: true };
    });
  }

  removeSidebarTarget(
    context: StoreContext,
    path: string,
  ): Mutation<ResultByMethod["folders.sidebar.remove"]> {
    const previous = this.#readOperation<
      ResultByMethod["folders.sidebar.remove"]
    >(context.clientPublicKey, context.operationId);
    if (previous) return { response: succeeded(previous) };

    return this.#transaction(() => {
      const concurrentPrevious = this.#readOperation<
        ResultByMethod["folders.sidebar.remove"]
      >(context.clientPublicKey, context.operationId);
      if (concurrentPrevious)
        return { response: succeeded(concurrentPrevious) };
      this.#database
        .prepare("DELETE FROM sidebar_order WHERE workspace_path = ?")
        .run(path);
      const result = this.#database
        .prepare("DELETE FROM sidebar_targets WHERE workspace_path = ?")
        .run(path);
      const response = succeeded({ path });
      this.#saveOperation(context, response);
      return { response, changed: Number(result.changes) > 0 };
    });
  }

  devices(
    currentDevicePublicKey: string,
  ): Response<ResultByMethod["devices.list"]> {
    return succeeded({
      devices: this.listDevices(),
      currentDevicePublicKey,
    });
  }

  listTerminals(): StoredTerminal[] {
    const rows = this.#database
      .prepare(
        `SELECT ${TERMINAL_SUMMARY_COLUMNS} FROM terminals ORDER BY created_at, id`,
      )
      .all() as unknown as TerminalSummaryRow[];
    return rows.map(toStoredTerminalSummary);
  }

  terminalSummary(id: string): StoredTerminal | undefined {
    const row = this.#database
      .prepare(`SELECT ${TERMINAL_SUMMARY_COLUMNS} FROM terminals WHERE id = ?`)
      .get(id) as TerminalSummaryRow | undefined;
    return row ? toStoredTerminalSummary(row) : undefined;
  }

  terminal(id: string): StoredTerminal | undefined {
    const row = this.#database
      .prepare("SELECT * FROM terminals WHERE id = ?")
      .get(id) as TerminalRow | undefined;
    return row ? toStoredTerminal(row) : undefined;
  }

  setTerminalImageSequence(id: string, imageSequence: number): void {
    this.#database
      .prepare("UPDATE terminals SET image_sequence = ? WHERE id = ?")
      .run(imageSequence, id);
  }

  putTerminal(terminal: StoredTerminal): void {
    this.#database
      .prepare(
        `INSERT INTO terminals
          (id, shell, cwd, title, state, exit_code, cols, rows, last_desktop_cols, last_desktop_rows, restart_pending, snapshot_json, image_sequence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          shell = excluded.shell,
          cwd = excluded.cwd,
          title = excluded.title,
          state = excluded.state,
          exit_code = excluded.exit_code,
          cols = excluded.cols,
          rows = excluded.rows,
          last_desktop_cols = excluded.last_desktop_cols,
          last_desktop_rows = excluded.last_desktop_rows,
          restart_pending = excluded.restart_pending,
          snapshot_json = excluded.snapshot_json`,
      )
      .run(
        terminal.id,
        terminal.shell,
        terminal.cwd,
        terminal.title,
        terminal.state,
        terminal.exitCode ?? null,
        terminal.cols,
        terminal.rows,
        terminal.lastDesktopSize.cols,
        terminal.lastDesktopSize.rows,
        terminal.restartPending ? 1 : 0,
        terminal.snapshot === null ? null : JSON.stringify(terminal.snapshot),
        terminal.imageSequence,
        terminal.createdAt,
      );
    if (terminal.worktreePath)
      this.#database
        .prepare(
          "INSERT OR IGNORE INTO terminal_worktrees (terminal_id, path) VALUES (?, ?)",
        )
        .run(terminal.id, terminal.worktreePath);
  }

  terminalWorktree(id: string): string | undefined {
    const row = this.#database
      .prepare("SELECT path FROM terminal_worktrees WHERE terminal_id = ?")
      .get(id) as { path: string } | undefined;
    return row?.path;
  }

  putTerminalSummary(terminal: StoredTerminal): void {
    this.#database
      .prepare(
        `UPDATE terminals SET
          shell = ?, cwd = ?, title = ?, state = ?, exit_code = ?, cols = ?, rows = ?,
          last_desktop_cols = ?, last_desktop_rows = ?, restart_pending = ?
         WHERE id = ?`,
      )
      .run(
        terminal.shell,
        terminal.cwd,
        terminal.title,
        terminal.state,
        terminal.exitCode ?? null,
        terminal.cols,
        terminal.rows,
        terminal.lastDesktopSize.cols,
        terminal.lastDesktopSize.rows,
        terminal.restartPending ? 1 : 0,
        terminal.id,
      );
  }

  removeTerminal(id: string): void {
    this.#database.prepare("DELETE FROM terminals WHERE id = ?").run(id);
  }

  worktreeSetupCommand(rootPath: string): string {
    const row = this.#database
      .prepare(
        "SELECT setup_command FROM worktree_settings WHERE root_path = ?",
      )
      .get(rootPath) as { setup_command: string } | undefined;
    return row?.setup_command ?? "";
  }

  saveWorktreeSetupCommand(rootPath: string, command: string): void {
    this.#database
      .prepare(
        "INSERT INTO worktree_settings(root_path, setup_command) VALUES (?, ?) ON CONFLICT(root_path) DO UPDATE SET setup_command = excluded.setup_command",
      )
      .run(rootPath, command);
  }

  repositoryGitAccount(rootPath: string): string {
    const row = this.#database
      .prepare(
        "SELECT github_account FROM repository_git_settings WHERE root_path = ?",
      )
      .get(rootPath) as { github_account: string } | undefined;
    return row?.github_account ?? "";
  }

  repositoryGitAutoAccount(rootPath: string): string {
    const row = this.#database
      .prepare(
        "SELECT account FROM repository_github_auto_accounts WHERE root_path = ?",
      )
      .get(rootPath) as { account: string } | undefined;
    return row?.account ?? "";
  }

  saveRepositoryGitAutoAccount(rootPath: string, account: string): void {
    if (account)
      this.#database
        .prepare(
          "INSERT INTO repository_github_auto_accounts(root_path, account) VALUES (?, ?) ON CONFLICT(root_path) DO UPDATE SET account = excluded.account",
        )
        .run(rootPath, account);
    else
      this.#database
        .prepare(
          "DELETE FROM repository_github_auto_accounts WHERE root_path = ?",
        )
        .run(rootPath);
  }

  saveRepositoryGitSettings(
    context: StoreContext,
    rootPath: string,
    values: { setupCommand?: string; githubAccount?: string },
  ): Mutation<ResultByMethod["repository.git.set"]> {
    const previous =
      this.replayOperation<ResultByMethod["repository.git.set"]>(context);
    if (previous) return { response: previous };
    return this.#transaction(() => {
      if (values.setupCommand !== undefined)
        this.saveWorktreeSetupCommand(rootPath, values.setupCommand);
      if (values.githubAccount !== undefined)
        this.#database
          .prepare(
            "INSERT INTO repository_git_settings(root_path, github_account) VALUES (?, ?) ON CONFLICT(root_path) DO UPDATE SET github_account = excluded.github_account",
          )
          .run(rootPath, values.githubAccount);
      const response = succeeded({
        setupCommand: this.worktreeSetupCommand(rootPath),
        githubAccount: this.repositoryGitAccount(rootPath),
      });
      this.#saveOperation(context, response);
      return { response, changed: true };
    });
  }

  terminalSetup(id: string): StoredWorktreeSetup | undefined {
    const row = this.#database
      .prepare("SELECT value_json FROM terminal_setups WHERE terminal_id = ?")
      .get(id) as { value_json: string } | undefined;
    return row
      ? (JSON.parse(row.value_json) as StoredWorktreeSetup)
      : undefined;
  }

  saveTerminalSetup(id: string, setup: StoredWorktreeSetup | undefined): void {
    if (setup)
      this.#database
        .prepare(
          "INSERT INTO terminal_setups(terminal_id, value_json) VALUES (?, ?) ON CONFLICT(terminal_id) DO UPDATE SET value_json = excluded.value_json",
        )
        .run(id, JSON.stringify(setup));
    else
      this.#database
        .prepare("DELETE FROM terminal_setups WHERE terminal_id = ?")
        .run(id);
  }

  markTerminalsForRestart(): StoredTerminal[] {
    for (const terminal of this.listTerminals()) {
      const cli = this.terminalCli(terminal.id);
      if (cli && terminal.state === "running")
        this.setTerminalCli(terminal.id, { ...cli, resumePending: true });
    }
    this.#database
      .prepare(
        "UPDATE terminals SET state = 'exited', restart_pending = 1 WHERE state = 'running'",
      )
      .run();
    return this.listTerminals();
  }

  terminalCli(id: string): StoredCli | undefined {
    const row = this.#database
      .prepare("SELECT value FROM terminal_clis WHERE terminal_id = ?")
      .get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  setTerminalCli(id: string, cli?: StoredCli): void {
    if (!cli) {
      this.#database
        .prepare("DELETE FROM terminal_clis WHERE terminal_id = ?")
        .run(id);
      return;
    }
    this.#database
      .prepare(
        "INSERT INTO terminal_clis (terminal_id, value) VALUES (?, ?) ON CONFLICT(terminal_id) DO UPDATE SET value = excluded.value",
      )
      .run(id, JSON.stringify(cli));
  }

  cliOrder(): string[] {
    const row = this.#database
      .prepare("SELECT value FROM terminal_settings WHERE key = ?")
      .get("cliOrder") as { value: string } | undefined;
    return row ? JSON.parse(row.value) : [];
  }

  saveCliOrder(order: string[]): void {
    this.#database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run("cliOrder", JSON.stringify(order));
  }

  cliHidden(id: string): boolean {
    const row = this.#database
      .prepare("SELECT value FROM terminal_settings WHERE key = ?")
      .get(`cliHidden:${id}`) as { value: string } | undefined;
    return row?.value === "true";
  }
  saveCliHidden(id: string, hidden: boolean): void {
    this.#database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(`cliHidden:${id}`, String(hidden));
  }

  cliStartupArguments(id: string): string {
    const row = this.#database
      .prepare("SELECT value FROM terminal_settings WHERE key = ?")
      .get(`cliArguments:${id}`) as { value: string } | undefined;
    return row?.value ?? "";
  }

  saveCliStartupArguments(id: string, value: string): void {
    this.#database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(`cliArguments:${id}`, value);
  }

  /** A deleted definition is no longer the CLI that the launcher selects. */
  forgetLastUsedCli(): void {
    this.#database
      .prepare("DELETE FROM terminal_settings WHERE key = 'lastUsedCli'")
      .run();
  }
  lastUsedCli(): string | undefined {
    const row = this.#database
      .prepare("SELECT value FROM terminal_settings WHERE key = 'lastUsedCli'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  setLastUsedCli(id: string): void {
    const opened = this.openedClis();
    if (!opened.includes(id)) {
      this.#database
        .prepare(
          "INSERT INTO terminal_settings (key, value) VALUES ('openedClis', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(JSON.stringify([...opened, id]));
    }
    this.#database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES ('lastUsedCli', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(id);
  }

  openedClis(): string[] {
    const row = this.#database
      .prepare("SELECT value FROM terminal_settings WHERE key = 'openedClis'")
      .get() as { value: string } | undefined;
    // Preserve the CLI known to have been opened before this setting existed.
    const previous = this.lastUsedCli();
    return [
      ...new Set([
        ...(row ? JSON.parse(row.value) : []),
        ...(previous ? [previous] : []),
      ]),
    ];
  }

  forgeMapping(remoteHost: string): ForgeMapping | undefined {
    const row = this.#database
      .prepare("SELECT web_url FROM forge_mappings WHERE remote_host = ?")
      .get(remoteHost) as { web_url: string } | undefined;
    return row ? { remoteHost, webUrl: row.web_url } : undefined;
  }
  setForgeMapping(
    context: StoreContext,
    mapping: ForgeMapping,
  ): Mutation<ResultByMethod["forge.mapping.set"]> {
    const previous =
      this.replayOperation<ResultByMethod["forge.mapping.set"]>(context);
    if (previous) return { response: previous };
    return this.#transaction(() => {
      this.#database
        .prepare(
          "INSERT INTO forge_mappings (remote_host, web_url) VALUES (?, ?) ON CONFLICT(remote_host) DO UPDATE SET web_url = excluded.web_url",
        )
        .run(mapping.remoteHost, mapping.webUrl);
      const response = succeeded({ mapping });
      this.#saveOperation(context, response);
      return { response, changed: true };
    });
  }
  removeForgeMapping(
    context: StoreContext,
    remoteHost: string,
  ): Mutation<ResultByMethod["forge.mapping.remove"]> {
    const previous =
      this.replayOperation<ResultByMethod["forge.mapping.remove"]>(context);
    if (previous) return { response: previous };
    return this.#transaction(() => {
      this.#database
        .prepare("DELETE FROM forge_mappings WHERE remote_host = ?")
        .run(remoteHost);
      const response = succeeded({ remoteHost });
      this.#saveOperation(context, response);
      return { response, changed: true };
    });
  }

  /** Where each site's token is kept; the token itself is never in SQLite. */
  forgeTokens(): { origin: string; storage: "os" | "file"; account: string }[] {
    return this.#database
      .prepare("SELECT origin, storage, account FROM forge_tokens")
      .all() as { origin: string; storage: "os" | "file"; account: string }[];
  }
  forgeToken(
    origin: string,
  ): { storage: "os" | "file"; account: string } | undefined {
    return this.#database
      .prepare("SELECT storage, account FROM forge_tokens WHERE origin = ?")
      .get(origin) as { storage: "os" | "file"; account: string } | undefined;
  }
  setForgeToken(origin: string, storage: "os" | "file", account: string) {
    this.#database
      .prepare(
        "INSERT INTO forge_tokens (origin, storage, account) VALUES (?, ?, ?) ON CONFLICT(origin) DO UPDATE SET storage = excluded.storage, account = excluded.account",
      )
      .run(origin, storage, account);
  }
  removeForgeToken(origin: string) {
    this.#database
      .prepare("DELETE FROM forge_tokens WHERE origin = ?")
      .run(origin);
  }

  defaultTerminalShell(): string | undefined {
    const row = this.#database
      .prepare("SELECT value FROM terminal_settings WHERE key = 'defaultShell'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  setDefaultTerminalShell(shell: string): void {
    this.#database
      .prepare(
        "INSERT INTO terminal_settings (key, value) VALUES ('defaultShell', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(shell);
  }

  terminalOperationResult<T>(context: StoreContext): T | undefined {
    return this.#readOperation<T>(context.clientPublicKey, context.operationId);
  }

  saveTerminalOperationResult<T>(context: StoreContext, result: T): void {
    this.#saveOperation(context, succeeded(result));
  }

  createInvite(
    context: StoreContext,
    identity: HostIdentity,
    addresses: string[],
    secret: string,
    createdAt: number,
    relayUrl?: string,
  ): Response<ResultByMethod["invite.create"]> {
    const previous = this.#readOperation<ResultByMethod["invite.create"]>(
      context.clientPublicKey,
      context.operationId,
    );
    if (previous) return succeeded(previous);

    const invite: Invite = {
      version: 1,
      ...(relayUrl ? { relayUrl } : {}),
      hostKey: identity.publicKey,
      addresses,
      secret,
      expiresAt: createdAt + INVITE_LIFETIME_MS,
      hostName: identity.hostName,
    };
    const response = succeeded({ invite });

    return this.#transaction(() => {
      const concurrentPrevious = this.#readOperation<
        ResultByMethod["invite.create"]
      >(context.clientPublicKey, context.operationId);
      if (concurrentPrevious) return succeeded(concurrentPrevious);
      this.#database.prepare("DELETE FROM invite").run();
      this.#database
        .prepare(
          "INSERT INTO invite (singleton, secret, expires_at, issuer_operation_id) VALUES (1, ?, ?, ?)",
        )
        .run(invite.secret, invite.expiresAt, context.operationId);
      this.#saveOperation(context, response);
      return response;
    });
  }

  pair(
    context: StoreContext,
    identity: HostIdentity,
    addresses: string[],
    deviceName: string,
    presentedSecret: string,
    registeredAt: number,
  ): Mutation<ResultByMethod["pair"]> {
    const previous = this.#readOperation<ResultByMethod["pair"]>(
      context.clientPublicKey,
      context.operationId,
    );
    if (previous) {
      return {
        response: this.isRegistered(context.clientPublicKey)
          ? succeeded(previous)
          : failure("not_registered"),
      };
    }

    const mutation = this.#transaction((): Mutation<ResultByMethod["pair"]> => {
      const concurrentPrevious = this.#readOperation<ResultByMethod["pair"]>(
        context.clientPublicKey,
        context.operationId,
      );
      if (concurrentPrevious) {
        return {
          response: this.isRegistered(context.clientPublicKey)
            ? succeeded(concurrentPrevious)
            : failure("not_registered"),
        };
      }

      const invite = this.#database
        .prepare(
          "SELECT secret, expires_at, issuer_operation_id FROM invite WHERE singleton = 1",
        )
        .get() as InviteRow | undefined;
      if (!invite || registeredAt >= invite.expires_at) {
        return { response: failure("invite_rejected") };
      }

      const actualSecret = Buffer.from(presentedSecret, "base64url");
      if (
        actualSecret.byteLength !== 32 ||
        !timingSafeEqual(
          createHash("sha256")
            .update(Buffer.from(invite.secret, "base64url"))
            .digest(),
          createHash("sha256").update(actualSecret).digest(),
        )
      ) {
        return { response: failure("invite_rejected") };
      }

      const device: Device = {
        publicKey: context.clientPublicKey,
        name: deviceName,
        registeredAt,
      };
      this.#database
        .prepare(
          "INSERT INTO devices (public_key, name, registered_at) VALUES (?, ?, ?) ON CONFLICT(public_key) DO UPDATE SET name = excluded.name, registered_at = excluded.registered_at",
        )
        .run(device.publicKey, device.name, device.registeredAt);
      this.#database.prepare("DELETE FROM invite WHERE singleton = 1").run();

      const result: ResultByMethod["pair"] = {
        device,
        host: this.hostInfo(identity, addresses),
      };
      const response = succeeded(result);
      this.#saveOperation(context, response);
      return {
        response,
        event: {
          type: "device.registered",
          device,
          inviteOperationId: invite.issuer_operation_id,
        },
      };
    });
    return mutation;
  }

  revoke(
    context: StoreContext,
    targetPublicKey: string,
  ): Mutation<ResultByMethod["devices.revoke"]> {
    return this.#transaction((): Mutation<ResultByMethod["devices.revoke"]> => {
      if (!this.isRegistered(context.clientPublicKey)) {
        return { response: failure("not_registered") };
      }
      const cached = this.#readOperation<ResultByMethod["devices.revoke"]>(
        context.clientPublicKey,
        context.operationId,
      );
      if (cached) return { response: succeeded(cached) };
      if (!this.isRegistered(targetPublicKey)) {
        const response = succeeded({ publicKey: targetPublicKey });
        this.#saveOperation(context, response);
        return { response };
      }

      this.#database
        .prepare("DELETE FROM devices WHERE public_key = ?")
        .run(targetPublicKey);
      const response = succeeded({ publicKey: targetPublicKey });
      this.#saveOperation(context, response);
      return {
        response,
        event: { type: "device.revoked", publicKey: targetPublicKey },
        revokedPublicKey: targetPublicKey,
      };
    });
  }

  #readOperation<T>(
    clientPublicKey: string,
    operationId: string,
  ): T | undefined {
    const row = this.#database
      .prepare(
        "SELECT result_json FROM operation_results WHERE client_public_key = ? AND operation_id = ?",
      )
      .get(clientPublicKey, operationId) as OperationRow | undefined;
    if (!row) return undefined;
    return JSON.parse(row.result_json) as T;
  }

  #saveOperation<T>(context: StoreContext, response: Response<T>): void {
    this.#database
      .prepare(
        "INSERT OR IGNORE INTO operation_results (client_public_key, operation_id, result_json) VALUES (?, ?, ?)",
      )
      .run(
        context.clientPublicKey,
        context.operationId,
        JSON.stringify(response.ok ? response.result : response),
      );
  }

  #transaction<T>(action: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
