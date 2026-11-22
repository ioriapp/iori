import type {
  Candidate,
  CliSummary,
  CliSession,
  CliStatus,
  TerminalModes,
  TerminalOscLinkRange,
  TerminalSummary,
  TerminalState,
} from "@iori/protocol";
import type { Connection } from "./connection.ts";

export interface StoredCli {
  candidate?: Candidate;
  cli: CliSummary;
  command: string;
  observed?: boolean;
  session?: CliSession;
  resumePending?: boolean;
  runtime?: {
    marker?: string;
    observedModel?: string;
    userInputSinceActivity?: boolean;
    ready: boolean;
    shellReady?: boolean;
    status?: CliStatus;
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

export function createTerminalsRepository({ database }: Connection) {
  function listTerminals(): StoredTerminal[] {
    const rows = database
      .prepare(
        `SELECT id, shell, cwd, title, state, exit_code, cols, rows, last_desktop_cols, last_desktop_rows, restart_pending, image_sequence, created_at FROM terminals ORDER BY created_at, id`,
      )
      .all() as unknown as TerminalSummaryRow[];
    return rows.map(toStoredTerminalSummary);
  }

  function terminalSummary(id: string): StoredTerminal | undefined {
    const row = database
      .prepare(
        `SELECT id, shell, cwd, title, state, exit_code, cols, rows, last_desktop_cols, last_desktop_rows, restart_pending, image_sequence, created_at FROM terminals WHERE id = ?`,
      )
      .get(id) as TerminalSummaryRow | undefined;
    return row ? toStoredTerminalSummary(row) : undefined;
  }

  function terminal(id: string): StoredTerminal | undefined {
    const row = database
      .prepare("SELECT * FROM terminals WHERE id = ?")
      .get(id) as TerminalRow | undefined;
    return row ? toStoredTerminal(row) : undefined;
  }

  function setTerminalImageSequence(id: string, imageSequence: number): void {
    database
      .prepare("UPDATE terminals SET image_sequence = ? WHERE id = ?")
      .run(imageSequence, id);
  }

  function putTerminal(terminal: StoredTerminal): void {
    database
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
      database
        .prepare(
          "INSERT OR IGNORE INTO terminal_worktrees (terminal_id, path) VALUES (?, ?)",
        )
        .run(terminal.id, terminal.worktreePath);
  }

  function terminalWorktree(id: string): string | undefined {
    const row = database
      .prepare("SELECT path FROM terminal_worktrees WHERE terminal_id = ?")
      .get(id) as { path: string } | undefined;
    return row?.path;
  }

  function putTerminalSummary(terminal: StoredTerminal): void {
    database
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

  function removeTerminal(id: string): void {
    database.prepare("DELETE FROM terminals WHERE id = ?").run(id);
  }
  function terminalSetup(id: string): StoredWorktreeSetup | undefined {
    const row = database
      .prepare("SELECT value_json FROM terminal_setups WHERE terminal_id = ?")
      .get(id) as { value_json: string } | undefined;
    return row
      ? (JSON.parse(row.value_json) as StoredWorktreeSetup)
      : undefined;
  }

  function saveTerminalSetup(
    id: string,
    setup: StoredWorktreeSetup | undefined,
  ): void {
    if (setup)
      database
        .prepare(
          "INSERT INTO terminal_setups(terminal_id, value_json) VALUES (?, ?) ON CONFLICT(terminal_id) DO UPDATE SET value_json = excluded.value_json",
        )
        .run(id, JSON.stringify(setup));
    else
      database
        .prepare("DELETE FROM terminal_setups WHERE terminal_id = ?")
        .run(id);
  }

  function markTerminalsForRestart(): StoredTerminal[] {
    for (const terminal of listTerminals()) {
      const cli = terminalCli(terminal.id);
      if (cli && terminal.state === "running")
        setTerminalCli(terminal.id, { ...cli, resumePending: true });
    }
    database
      .prepare(
        "UPDATE terminals SET state = 'exited', restart_pending = 1 WHERE state = 'running'",
      )
      .run();
    return listTerminals();
  }

  function terminalCli(id: string): StoredCli | undefined {
    const row = database
      .prepare("SELECT value FROM terminal_clis WHERE terminal_id = ?")
      .get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  function setTerminalCli(id: string, cli?: StoredCli): void {
    if (!cli) {
      database
        .prepare("DELETE FROM terminal_clis WHERE terminal_id = ?")
        .run(id);
      return;
    }
    database
      .prepare(
        "INSERT INTO terminal_clis (terminal_id, value) VALUES (?, ?) ON CONFLICT(terminal_id) DO UPDATE SET value = excluded.value",
      )
      .run(id, JSON.stringify(cli));
  }
  return {
    listTerminals,
    terminalSummary,
    terminal,
    setTerminalImageSequence,
    putTerminal,
    terminalWorktree,
    putTerminalSummary,
    removeTerminal,
    terminalSetup,
    saveTerminalSetup,
    markTerminalsForRestart,
    terminalCli,
    setTerminalCli,
  };
}
