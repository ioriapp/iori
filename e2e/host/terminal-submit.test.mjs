import assert from "node:assert/strict";
import test from "node:test";
import { runHostTest } from "../../verification/host/process.mjs";

test("Terminal のまとめて入力の送信結果を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const { terminal: created } = await client.request("terminal.create", {
      cwd: dataRoot,
    });
    const terminal = await client.terminal(created.id);
    await terminal.input(
      "stty -echo; printf '%s%s\\n' 'SUBMISSION_' 'READY'; IFS= read -r line; printf 'RECEIVED:%s\\n' \"$line\"; stty echo\r",
    );
    await terminal.output("SUBMISSION_READY");
    stage("入力を PTY に送った後に成功を返す");
    await terminal.submit("draft", "success");
    const result = await terminal.waitFor(
      ({ frame }) =>
        frame.kind === "terminal.submitted" && frame.id === "success",
    );
    assert.equal(result.frame.success, true);
    assert.doesNotMatch(result.output, /RECEIVED:draft/u);
    await terminal.output("RECEIVED:draft");
  }));
