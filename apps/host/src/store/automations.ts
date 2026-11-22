import { randomBytes } from "node:crypto";
import type { Automation, AutomationRun, Response } from "@iori/protocol";
import {
  type Connection,
  type StoreContext,
  succeeded,
  failure,
} from "./connection.ts";

export function createAutomationsRepository({
  database,
  transaction,
  readOperation,
  saveOperation,
}: Connection) {
  function automations(): Automation[] {
    return (
      database
        .prepare(
          "SELECT a.value_json, t.token FROM automations a LEFT JOIN automation_webhook_tokens t ON t.automation_id = a.id ORDER BY a.rowid",
        )
        .all() as { value_json: string; token: string | null }[]
    ).map((row) => ({
      ...JSON.parse(row.value_json),
      ...(row.token === null ? {} : { webhookToken: row.token }),
    }));
  }
  function replayAutomationOperation(
    context: StoreContext,
  ): Response<{ automation: Automation }> | undefined {
    const previous = readOperation<{ automationId: string }>(
      context.clientPublicKey,
      context.operationId,
    );
    if (!previous?.automationId) return undefined;
    const automation = automations().find(
      (item) => item.id === previous.automationId,
    );
    return automation ? succeeded({ automation }) : failure("invalid_request");
  }
  function putAutomation(value: Automation, context?: StoreContext): void {
    const { webhookToken, ...definition } = value;
    transaction(() => {
      const old = automations().find(
        (automation) => automation.id === value.id,
      );
      database
        .prepare(
          "INSERT INTO automations VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json",
        )
        .run(value.id, JSON.stringify(definition));
      if (value.issue && (!old?.issue || (value.enabled && !old.enabled))) {
        database
          .prepare(
            "INSERT INTO automation_issue_start VALUES (?, ?) ON CONFLICT(automation_id) DO UPDATE SET started_at = excluded.started_at",
          )
          .run(value.id, Date.now());
      }
      if (value.webhook) {
        database
          .prepare(
            "INSERT OR IGNORE INTO automation_webhook_tokens VALUES (?, ?)",
          )
          .run(value.id, webhookToken ?? randomBytes(32).toString("base64url"));
      }
      if (context)
        saveOperation(context, succeeded({ automationId: value.id }));
    });
  }
  function automationIssueStart(id: string): number | undefined {
    const row = database
      .prepare(
        "SELECT started_at FROM automation_issue_start WHERE automation_id = ?",
      )
      .get(id) as { started_at: number } | undefined;
    return row?.started_at;
  }
  function regenerateAutomationToken(id: string, context: StoreContext): void {
    transaction(() => {
      database
        .prepare(
          "UPDATE automation_webhook_tokens SET token = ? WHERE automation_id = ?",
        )
        .run(randomBytes(32).toString("base64url"), id);
      saveOperation(context, succeeded({ automationId: id }));
    });
  }
  function deleteAutomation(id: string): void {
    database.prepare("DELETE FROM automations WHERE id = ?").run(id);
  }
  function automationRuns(id: string): AutomationRun[] {
    return (
      database
        .prepare(
          "SELECT value_json FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_at DESC, rowid DESC",
        )
        .all(id) as { value_json: string }[]
    ).map((row) => JSON.parse(row.value_json));
  }
  function latestAutomationRun(id: string): AutomationRun | undefined {
    const row = database
      .prepare(
        "SELECT value_json FROM automation_runs WHERE automation_id = ? ORDER BY scheduled_at DESC, rowid DESC LIMIT 1",
      )
      .get(id) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) : undefined;
  }
  function automationHasTerminalRun(id: string, terminalId: string): boolean {
    return !!database
      .prepare(
        "SELECT 1 FROM automation_runs WHERE automation_id = ? AND json_extract(value_json, '$.terminalId') = ? LIMIT 1",
      )
      .get(id, terminalId);
  }
  function automationRun(id: string): AutomationRun | undefined {
    const row = database
      .prepare("SELECT value_json FROM automation_runs WHERE id = ?")
      .get(id) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) : undefined;
  }
  function claimAutomationRun(value: AutomationRun): boolean {
    return (
      database
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
  function putAutomationRun(value: AutomationRun): void {
    database
      .prepare("UPDATE automation_runs SET value_json = ? WHERE id = ?")
      .run(JSON.stringify(value), value.id);
  }
  return {
    automations,
    replayAutomationOperation,
    putAutomation,
    automationIssueStart,
    regenerateAutomationToken,
    deleteAutomation,
    automationRuns,
    latestAutomationRun,
    automationHasTerminalRun,
    automationRun,
    claimAutomationRun,
    putAutomationRun,
  };
}
