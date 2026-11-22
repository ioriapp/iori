import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { HostStore } from "./store.ts";

test("操作結果は期限を過ぎると再送に使われない", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-operation-expiration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "host.sqlite");
  const store = new HostStore(path);
  const clientPublicKey = "a".repeat(64);
  const fresh = { clientPublicKey, operationId: randomUUID() };
  const expired = { clientPublicKey, operationId: randomUUID() };
  const result = { value: "saved" };
  const past = Date.now() - 25 * 60 * 60 * 1000;
  using database = new DatabaseSync(path);
  try {
    store.saveTerminalOperationResult(expired, result);
    store.saveTerminalOperationResult(fresh, result);
    database
      .prepare(
        "UPDATE operation_results SET created_at = ? WHERE operation_id = ?",
      )
      .run(past, expired.operationId);
    assert.equal(store.terminalOperationResult(expired), undefined);
    assert.deepEqual(store.terminalOperationResult(fresh), result);
  } finally {
    store.close();
  }

  const reopened = new HostStore(path);
  try {
    assert.equal(reopened.terminalOperationResult(expired), undefined);
    assert.deepEqual(reopened.terminalOperationResult(fresh), result);
  } finally {
    reopened.close();
  }
});

test("旧スキーマの操作結果を削除して起動し、操作結果を保存できる", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "iori-operation-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "host.sqlite");
  const clientPublicKey = "a".repeat(64);
  using database = new DatabaseSync(path);
  database.exec(`CREATE TABLE operation_results (
    client_public_key TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    result_json TEXT NOT NULL,
    PRIMARY KEY (client_public_key, operation_id)
  )`);
  database
    .prepare("INSERT INTO operation_results VALUES (?, ?, ?)")
    .run(
      clientPublicKey,
      randomUUID(),
      JSON.stringify({ invite: { secret: "old-test-secret" } }),
    );

  const store = new HostStore(path);
  try {
    assert.deepEqual(
      database.prepare("SELECT result_json FROM operation_results").all(),
      [],
    );
    const context = { clientPublicKey, operationId: randomUUID() };
    const result = { value: "saved" };
    store.saveTerminalOperationResult(context, result);
    assert.deepEqual(store.terminalOperationResult(context), result);
  } finally {
    store.close();
  }
});

test("途中で失敗したトランザクションはチームとほかの設定の両方を戻す", () => {
  const store = new HostStore(":memory:");
  const context = { clientPublicKey: "device", operationId: randomUUID() };
  try {
    store.saveListeningPort(4000);
    assert.throws(
      () =>
        store.transaction(() => {
          const result = store.teamOperation(context, "teams.create", {
            template: "minimal",
          });
          assert.ok(result.ok);
          store.saveListeningPort(5000);
          throw new Error("abort changes");
        }),
      /abort changes/u,
    );
    assert.equal(store.listeningPort(), 4000);
    assert.deepEqual(store.listTeams().teams, []);
    assert.equal(store.replayOperation(context), undefined);

    store.transaction(() => {
      store.saveListeningPort(6000);
      assert.throws(
        () =>
          store.transaction(() => {
            store.saveListeningPort(7000);
            throw new Error("abort nested changes");
          }),
        /abort nested changes/u,
      );
    });
    assert.equal(store.listeningPort(), 6000);
  } finally {
    store.close();
  }
});

test("チーム一覧の定義・履歴・非表示設定は個別の読み取りと一致し、現在の会話を数える", () => {
  const store = new HostStore(":memory:");
  const context = () => ({
    clientPublicKey: "device",
    operationId: randomUUID(),
  });
  try {
    const create = (name: string) => {
      const result = store.teamOperation(context(), "teams.create", {
        template: "minimal",
        name,
      });
      assert.ok(result.ok);
      return result.result.saved;
    };
    const z = create("Z");
    const a = create("A");
    assert.ok(
      store.teamOperation(context(), "teams.save", {
        teamId: z.id,
        definition: { ...z, description: "updated" },
      }).ok,
    );
    assert.ok(
      store.teamOperation(context(), "teams.hidden.set", {
        teamId: a.id,
        hidden: true,
      }).ok,
    );
    const terminalId = randomUUID();
    store.putTerminal({
      id: terminalId,
      shell: "sh",
      cwd: "/",
      title: "team",
      state: "running",
      cols: 80,
      rows: 24,
      lastDesktopSize: { cols: 80, rows: 24 },
      restartPending: false,
      imageSequence: 0,
      snapshot: null,
      createdAt: 1,
    });
    for (const id of [terminalId, randomUUID()]) {
      store.putTeamConversation({
        id: randomUUID(),
        terminalId: id,
        teamId: z.id,
        teamVersion: z.version,
        cwd: "/",
        parent: z.parent,
        instructionFile: "request.md",
      });
    }
    assert.deepEqual(store.listTeams().teams, [
      { ...store.readTeam(a.id), conversationCount: 0 },
      { ...store.readTeam(z.id), conversationCount: 1 },
    ]);
  } finally {
    store.close();
  }
});
