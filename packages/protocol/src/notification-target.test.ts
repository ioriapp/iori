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
