import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCliNotificationTarget,
  cliNotificationId,
  notificationText,
} from "./cli.ts";

test("外部通知の対象は公開鍵とCLI・チームのIDだけを読み、パス・不正なIDを受け入れない", () => {
  const target = {
    hostKey: "ab".repeat(32),
    terminalId: "e6e3a59a-1f09-43a4-aaed-72688ae4c4f8",
  };
  assert.deepEqual(
    parseCliNotificationTarget({
      ...target,
      cwd: "/tmp/untrusted",
      command: "start",
    }),
    target,
  );
  assert.deepEqual(
    parseCliNotificationTarget({
      hostKey: target.hostKey.toUpperCase(),
      terminalId: target.terminalId.toUpperCase(),
    }),
    target,
  );
  assert.deepEqual(
    parseCliNotificationTarget({
      ...target,
      teamId: target.terminalId.toUpperCase(),
    }),
    { ...target, teamId: target.terminalId },
  );
  for (const value of [
    null,
    [],
    { ...target, hostKey: "ab".repeat(31) },
    { ...target, hostKey: "zz".repeat(32) },
    { ...target, terminalId: "../../folder" },
    { ...target, terminalId: "" },
    { ...target, terminalId: 42 },
    { ...target, teamId: "../../folder" },
    { ...target, teamId: 42 },
  ])
    assert.equal(parseCliNotificationTarget(value), undefined);
});

test("通知IDは同じ対象で一定で、別Host・別Terminalを区別し、常駐通知の1を使わない", () => {
  const target = {
    hostKey: "ab".repeat(32),
    terminalId: "e6e3a59a-1f09-43a4-aaed-72688ae4c4f8",
  };
  const id = cliNotificationId(target);
  cliNotificationId({
    ...target,
    terminalId: "c6e3a59a-1f09-43a4-aaed-72688ae4c4f8",
  });
  assert.equal(cliNotificationId({ ...target }), id);
  assert.notEqual(
    cliNotificationId({ ...target, hostKey: "cd".repeat(32) }),
    id,
  );
  assert.notEqual(
    cliNotificationId({
      ...target,
      terminalId: "c6e3a59a-1f09-43a4-aaed-72688ae4c4f8",
    }),
    id,
  );
  assert.ok(Number.isInteger(id) && id >= 2 && id <= 2147483647);
});

test("通知文は改行・制御文字・文字の向きの制御を除き、認証値を伏せて日本語を保持する", () => {
  assert.equal(
    notificationText(
      '\u001b完了\u0085\u202e password="fake value" Bearer\nexample-token\u2069 日本語',
    ),
    " 完了  password=[redacted] Bearer [redacted] 日本語",
  );
  for (const name of [
    "token",
    "PASSWORD",
    "secret",
    "api_key",
    "authorization",
  ])
    assert.equal(
      notificationText(`${name}=example-value`),
      `${name}=[redacted]`,
    );
});

// The Client and Host must keep the existing OS notification text and target.
test("判断待ちと完了・失敗の通知文を日本語・英語で共用する", async () => {
  const { createCliNotification, notificationLabels } =
    await import("./push-notifications.ts");
  const hostKey = "ab".repeat(32);
  const terminal = {
    id: "e6e3a59a-1f09-43a4-aaed-72688ae4c4f8",
    createdAt: 1,
    cwd: "C:\\work\\project\\branch",
    shell: "bash",
    title: "CLI title",
    cols: 80,
    rows: 24,
    lastDesktopSize: { cols: 80, rows: 24 },
    restartPending: false,
    cli: { id: "test", name: "Test CLI" },
  };
  const folders = [
    {
      path: "C:\\work\\project",
      workspacePath: "C:\\work\\project",
      kind: "git" as const,
      openedAt: 1,
      inSidebar: true,
      worktrees: [{ path: terminal.cwd, branch: "branch", primary: false }],
    },
  ];
  const cases = [
    {
      state: "waiting" as const,
      attention: { kind: "approval" as const, summary: "run task" },
      ja: "承認待ち",
      en: "Waiting for approval",
      body: "run task",
    },
    {
      state: "waiting" as const,
      attention: { kind: "question" as const, summary: "choose target" },
      ja: "入力待ち",
      en: "Needs input",
      body: "choose target",
    },
    {
      state: "done" as const,
      response: "Finished work",
      ja: "完了",
      en: "Done",
      body: "Finished work",
    },
    {
      state: "done" as const,
      outcome: "failure" as const,
      ja: "失敗",
      en: "Failed",
      body: "CLI title",
    },
  ];
  for (const state of cases)
    for (const language of ["ja", "en"] as const) {
      const notification = createCliNotification(
        hostKey,
        { ...terminal, cliStatus: { ...state, since: 1 } },
        folders,
        (key) => notificationLabels[language][key],
      );
      assert.deepEqual(notification, {
        id: cliNotificationId({ hostKey, terminalId: terminal.id }),
        title: `project / branch - Test CLI ${state[language]}`,
        body: state.body,
        target: { hostKey, terminalId: terminal.id },
      });
    }
});

test("通知のプレビューは秘密を伏せ、改行を整え、Unicode文字を途中で分割しない", async () => {
  const { notificationPreview } = await import("./push-notifications.ts");
  assert.equal(
    notificationPreview("run\n token=private-value\t task"),
    "run token=[redacted] task",
  );
  assert.equal(notificationPreview("😀".repeat(181)), "😀".repeat(179) + "…");
});
