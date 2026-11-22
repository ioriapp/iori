import type { FolderHistoryItem, ResultByMethod } from "@iori/protocol";
import {
  type Connection,
  type Mutation,
  type StoreContext,
  succeeded,
} from "./connection.ts";

interface FolderHistoryRow {
  path: string;
  workspace_path: string;
  kind: "folder" | "git";
  opened_at: number;
  in_sidebar: number;
}

export function createFoldersRepository({
  database,
  transaction,
  readOperation,
  saveOperation,
  replayOperation,
}: Connection) {
  function sidebarOrder(): string[] {
    return (
      database
        .prepare(
          `SELECT sidebar_targets.workspace_path
      FROM sidebar_targets LEFT JOIN sidebar_order USING (workspace_path)
      ORDER BY sidebar_order.position IS NULL, sidebar_order.position, sidebar_targets.rowid`,
        )
        .all() as { workspace_path: string }[]
    ).map((row) => row.workspace_path);
  }

  function reorderSidebar(
    context: StoreContext,
    paths: string[],
  ): Mutation<ResultByMethod["folders.sidebar.reorder"]> {
    const previous =
      replayOperation<ResultByMethod["folders.sidebar.reorder"]>(context);
    if (previous) return { response: previous };
    return transaction(() => {
      const current = sidebarOrder();
      const order = [
        ...new Set([
          ...paths.filter((path) => current.includes(path)),
          ...current,
        ]),
      ];
      database.prepare("DELETE FROM sidebar_order").run();
      const insert = database.prepare(
        "INSERT INTO sidebar_order (workspace_path, position) VALUES (?, ?)",
      );
      order.forEach((path, position) => insert.run(path, position));
      const response = succeeded({ paths: order });
      saveOperation(context, response);
      return { response, changed: true };
    });
  }

  function folderHistory(): FolderHistoryItem[] {
    const order = sidebarOrder();
    const rows = database
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

  function isSidebarTarget(path: string): boolean {
    return (
      database
        .prepare("SELECT 1 FROM sidebar_targets WHERE workspace_path = ?")
        .get(path) !== undefined
    );
  }

  function promoteFolder(path: string, workspacePath: string): boolean {
    return transaction(() => {
      const result = database
        .prepare(
          `UPDATE folder_history SET kind = 'git', workspace_path = ?
           WHERE path = ? AND kind = 'folder' AND workspace_path = ?
             AND EXISTS (SELECT 1 FROM sidebar_targets WHERE workspace_path = ?)`,
        )
        .run(workspacePath, path, path, path);
      if (Number(result.changes) === 0) return false;
      if (workspacePath === path) {
        database
          .prepare(
            "UPDATE sidebar_targets SET kind = 'git' WHERE workspace_path = ?",
          )
          .run(path);
      } else {
        database
          .prepare(
            `INSERT OR IGNORE INTO sidebar_targets (workspace_path, kind, opened_at)
             SELECT ?, 'git', opened_at FROM sidebar_targets WHERE workspace_path = ?`,
          )
          .run(workspacePath, path);
        database
          .prepare(
            "UPDATE sidebar_targets SET kind = 'git' WHERE workspace_path = ?",
          )
          .run(workspacePath);
        database
          .prepare(
            "UPDATE OR IGNORE sidebar_order SET workspace_path = ? WHERE workspace_path = ?",
          )
          .run(workspacePath, path);
        database
          .prepare("DELETE FROM sidebar_order WHERE workspace_path = ?")
          .run(path);
        database
          .prepare("DELETE FROM sidebar_targets WHERE workspace_path = ?")
          .run(path);
      }
      return true;
    });
  }

  function openFolder(
    context: StoreContext,
    folder: FolderHistoryItem,
  ): Mutation<ResultByMethod["folders.open"]> {
    const previous = readOperation<ResultByMethod["folders.open"]>(
      context.clientPublicKey,
      context.operationId,
    );
    if (previous) return { response: succeeded(previous) };

    return transaction(() => {
      const concurrentPrevious = readOperation<ResultByMethod["folders.open"]>(
        context.clientPublicKey,
        context.operationId,
      );
      if (concurrentPrevious)
        return { response: succeeded(concurrentPrevious) };
      database
        .prepare(
          `INSERT INTO folder_history (path, workspace_path, kind, opened_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             workspace_path = excluded.workspace_path,
             kind = excluded.kind,
             opened_at = excluded.opened_at`,
        )
        .run(folder.path, folder.workspacePath, folder.kind, folder.openedAt);
      database
        .prepare(
          `INSERT INTO sidebar_targets (workspace_path, kind, opened_at)
           VALUES (?, ?, ?)
           ON CONFLICT(workspace_path) DO UPDATE SET kind = excluded.kind`,
        )
        .run(folder.workspacePath, folder.kind, folder.openedAt);
      const response = succeeded({
        folder: {
          ...folder,
          sidebarPosition: sidebarOrder().indexOf(folder.workspacePath) + 1,
        },
      });
      saveOperation(context, response);
      return { response, changed: true };
    });
  }

  function removeSidebarTarget(
    context: StoreContext,
    path: string,
  ): Mutation<ResultByMethod["folders.sidebar.remove"]> {
    const previous = readOperation<ResultByMethod["folders.sidebar.remove"]>(
      context.clientPublicKey,
      context.operationId,
    );
    if (previous) return { response: succeeded(previous) };

    return transaction(() => {
      const concurrentPrevious = readOperation<
        ResultByMethod["folders.sidebar.remove"]
      >(context.clientPublicKey, context.operationId);
      if (concurrentPrevious)
        return { response: succeeded(concurrentPrevious) };
      database
        .prepare("DELETE FROM sidebar_order WHERE workspace_path = ?")
        .run(path);
      const result = database
        .prepare("DELETE FROM sidebar_targets WHERE workspace_path = ?")
        .run(path);
      const response = succeeded({ path });
      saveOperation(context, response);
      return { response, changed: Number(result.changes) > 0 };
    });
  }
  return {
    sidebarOrder,
    reorderSidebar,
    folderHistory,
    isSidebarTarget,
    promoteFolder,
    openFolder,
    removeSidebarTarget,
  };
}
