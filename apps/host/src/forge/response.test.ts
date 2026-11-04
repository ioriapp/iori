import assert from "node:assert/strict";
import { test } from "node:test";
import { checksStatus, commitChecks } from "./response.ts";

// The statuses Forgejo returns for example/iori 6b16c7a5 (run 161), newest first.
const origin = "https://forgejo.example.com";
const commit = "/example/iori/commit/6b16c7a5332e996a04c7ccd9c530ecdefe8e2aa2";
const run161 = ["failure", "pending", "pending"].map((status, index) => ({
  id: 3 - index,
  status,
  context: "CI / check (push)",
  target_url: "/example/iori/actions/runs/161/jobs/0",
}));

test("a state word iori does not know keeps its word and counts in no mark state", () => {
  // A word the Forge may add later, which iori does not know.
  const unknown = {
    id: 4,
    status: "frobnicated",
    context: "Deploy / preview (push)",
    target_url: "/example/iori/actions/runs/162/jobs/0",
  };
  const checks = commitChecks(origin, [unknown, ...run161]);
  assert.deepEqual(
    checks.map((check) => [check.state, check.word]),
    [
      ["other", "frobnicated"],
      ["failed", undefined],
    ],
  );
  assert.equal(checksStatus(origin, checks, commit)?.state, "failed");
  // Only such states: a neutral mark with the Forge's word.
  assert.deepEqual(
    checksStatus(origin, commitChecks(origin, [unknown]), commit),
    { state: "other", word: "frobnicated", url: `${origin}${commit}` },
  );
});
