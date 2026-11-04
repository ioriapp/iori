import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { githubReadFailure } from "./github-error.ts";

// Local gh captures and explicitly marked official-source examples keep the
// process/transport failures distinct from repository access and rate limits.
test("ghの404・401・403はアクセス不可、回数制限の403は上限、通信失敗・起動不能は取得失敗と判定する", async () => {
  const fixture: {
    cases: {
      name: string;
      code: number | null;
      stderr: string;
      launchFailed: boolean;
      expected: string;
    }[];
  } = JSON.parse(
    await readFile(
      new URL("./github-error.fixture.json", import.meta.url),
      "utf8",
    ),
  );
  for (const entry of fixture.cases)
    assert.equal(
      githubReadFailure(entry.code, entry.stderr, entry.launchFailed),
      entry.expected,
      entry.name,
    );
});
