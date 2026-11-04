import assert from "node:assert/strict";
import test from "node:test";
import { pushFailureText } from "./pull-requests.ts";

test("Git rejection summaries retain the reason and omit credential-bearing URLs", () => {
  assert.equal(
    pushFailureText(
      "To https://user:secret@example.com/repo\n!\trefs/heads/a:refs/heads/a\t[rejected] (non-fast-forward)\nDone\n",
      "error: failed to push some refs to 'https://user:secret@example.com/repo'",
    ),
    "Git push failed.\n[rejected] (non-fast-forward)",
  );
  assert.equal(
    pushFailureText(
      "",
      "fatal: Authentication failed for 'https://user:secret@example.com/repo'\n",
    ),
    "Git push failed.\nfatal: Authentication failed for '[remote]'",
  );
});
