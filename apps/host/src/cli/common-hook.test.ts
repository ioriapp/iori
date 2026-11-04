import assert from "node:assert/strict";
import { test } from "node:test";
import { readCommonHook } from "./common-hook.ts";

// The common shape comes from a CLI's own plugin, outside iori. These are the
// forms that the Host accepts or drops; its arrival is covered by the E2E.
test("reads the common shape of a plugin's notice", () => {
  assert.deepEqual(
    readCommonHook({
      iori: 1,
      iori_cli: "example",
      state: "done",
      sessionId: "session-1",
      transcript: "/tmp/session.jsonl",
      response: "Finished.",
      tokens: { input: 12, output: 3, cacheRead: 4, unknown: 1 },
      model: "provider/model",
      unknown: "dropped",
    }),
    {
      state: { state: "done", response: "Finished." },
      tokens: { input: 12, output: 3, cacheRead: 4 },
      model: "provider/model",
      session: { id: "session-1", file: "/tmp/session.jsonl" },
    },
  );
});
test("keeps tokens when the state is missing", () => {
  assert.deepEqual(
    readCommonHook({ iori: 1, tokens: { input: 1, output: 2 } }),
    {
      tokens: { input: 1, output: 2 },
    },
  );
});
test("drops values whose form is not the common shape", () => {
  assert.equal(readCommonHook({ iori: 2, state: "done" }), undefined);
  assert.deepEqual(
    readCommonHook({
      iori: 1,
      state: "running",
      tokens: { input: "1", output: 2 },
      model: 7,
      attention: { kind: "other", tool: "Bash" },
    }),
    undefined,
  );
});
test("reads a failure and an approval", () => {
  assert.deepEqual(
    readCommonHook({
      iori: 1,
      state: "waiting",
      attention: { kind: "approval", tool: "Bash" },
    }),
    {
      state: {
        state: "waiting",
        attention: { kind: "approval", tool: "Bash" },
      },
    },
  );
  assert.deepEqual(
    readCommonHook({
      iori: 1,
      state: "done",
      outcome: "failure",
      failure: "The provider refused the request.",
    }),
    {
      state: {
        state: "done",
        outcome: "failure",
        failure: "The provider refused the request.",
      },
    },
  );
});
