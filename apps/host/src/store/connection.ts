import { DatabaseSync } from "node:sqlite";
import type { Event, ProtocolErrorCode, Response } from "@iori/protocol";
import { initializeSchema } from "./schema.ts";

const OPERATION_RESULT_LIFETIME_MS = 24 * 60 * 60 * 1000;

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

interface OperationRow {
  result_json: string;
}

export function failure(code: ProtocolErrorCode): Response<never> {
  return { ok: false, error: { code } };
}

export function succeeded<T>(result: T): Response<T> {
  return { ok: true, result };
}

export function openConnection(path: string) {
  const database = new DatabaseSync(path);

  function transaction<T>(action: () => T): T {
    // SQLite resolves a reused savepoint name to the innermost one.
    const nested = database.isTransaction;
    database.exec(nested ? "SAVEPOINT nested_write" : "BEGIN IMMEDIATE");
    try {
      const result = action();
      database.exec(nested ? "RELEASE nested_write" : "COMMIT");
      return result;
    } catch (error) {
      if (nested)
        database.exec("ROLLBACK TO nested_write; RELEASE nested_write");
      else database.exec("ROLLBACK");
      throw error;
    }
  }

  function readOperation<T>(
    clientPublicKey: string,
    operationId: string,
  ): T | undefined {
    const row = database
      .prepare(
        "SELECT result_json FROM operation_results WHERE client_public_key = ? AND operation_id = ? AND created_at > 0 AND created_at >= ?",
      )
      .get(
        clientPublicKey,
        operationId,
        Date.now() - OPERATION_RESULT_LIFETIME_MS,
      ) as OperationRow | undefined;
    if (!row) return undefined;
    return JSON.parse(row.result_json) as T;
  }

  function pruneOperations(now: number): void {
    database
      .prepare(
        "DELETE FROM operation_results WHERE created_at = 0 OR (created_at > 0 AND created_at < ?)",
      )
      .run(now - OPERATION_RESULT_LIFETIME_MS);
  }

  function saveOperation<T>(
    context: StoreContext,
    response: Response<T>,
    replaceExisting = false,
  ): void {
    const now = Date.now();
    pruneOperations(now);
    database
      .prepare(
        "INSERT INTO operation_results (client_public_key, operation_id, result_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(client_public_key, operation_id) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at WHERE ?",
      )
      .run(
        context.clientPublicKey,
        context.operationId,
        JSON.stringify(response.ok ? response.result : response),
        now,
        Number(replaceExisting),
      );
  }
  function replayOperation<T>(context: StoreContext): Response<T> | undefined {
    const previous = readOperation<T>(
      context.clientPublicKey,
      context.operationId,
    );
    return previous === undefined ? undefined : succeeded(previous);
  }
  function terminalOperationResult<T>(context: StoreContext): T | undefined {
    return readOperation<T>(context.clientPublicKey, context.operationId);
  }

  function saveTerminalOperationResult<T>(
    context: StoreContext,
    result: T,
  ): void {
    saveOperation(context, succeeded(result));
  }

  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA foreign_keys = ON");
    transaction(() => {
      initializeSchema(database);
      pruneOperations(Date.now());
    });
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    database,
    transaction,
    readOperation,
    saveOperation,
    replayOperation,
    terminalOperationResult,
    saveTerminalOperationResult,
  };
}
export type Connection = ReturnType<typeof openConnection>;
