import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { forgejoFailure, githubFailureReason } from "./failure.ts";

const fixture = async <T>(name: string): Promise<{ cases: T[] }> =>
  JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));

// Forgejo 16.0.5's own answers; only a 403's message is ever read (a 401's
// echoes the token), so the other cases carry no message.
test("Forgejoの応答から、tokenが無い・無効・足りない権限の名前・見つからないを区別する", async () => {
  const { cases } = await fixture<{
    name: string;
    status: number;
    message: string;
    withToken: boolean;
    expected: { reason: string; scope?: string };
  }>("./forgejo-error.fixture.json");
  for (const entry of cases)
    assert.deepEqual(
      forgejoFailure(
        "http://127.0.0.1:3000",
        entry.status,
        entry.message,
        new Headers(),
        entry.withToken,
      ),
      { site: "http://127.0.0.1:3000", ...entry.expected },
      entry.name,
    );
});

// The gh captures of github-error.test.ts, read for the reason shown to users.
test("ghの出力から、未ログイン・tokenが無効・権限不足・見つからない・回数の上限・つながらないを区別する", async () => {
  const { cases } = await fixture<{
    name: string;
    code: number | null;
    stderr: string;
    launchFailed: boolean;
    reason: string;
  }>("./github-error.fixture.json");
  for (const entry of cases)
    assert.equal(
      githubFailureReason(entry.code, entry.stderr, entry.launchFailed),
      entry.reason,
      entry.name,
    );
});
