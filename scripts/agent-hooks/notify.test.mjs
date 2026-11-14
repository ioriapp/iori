import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Each session receives compatibility failures once, including preparation failures.
test("互換の監視の失敗をセッションごとに一度通知する", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "iori-notify-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, ".local/share/iori-cli-compat");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "latest.json"),
    JSON.stringify({
      finishedAt: "2026-11-14T00:00:00Z",
      sha: "main-commit",
      evidence: "/evidence",
      failed: [
        {
          cli: "claude",
          version: "1.0",
          test: "起動",
          evidence: "/evidence/claude",
        },
      ],
    }),
  );
  const notify = (session) =>
    execFileSync(
      process.execPath,
      [new URL("./notify.mjs", import.meta.url).pathname],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
        input: JSON.stringify({
          session_id: session,
          hook_event_name: "UserPromptSubmit",
        }),
      },
    );
  const first = JSON.parse(notify("first"));
  assert.equal(
    first.hookSpecificOutput.additionalContext,
    "他社の CLI の互換の監視が失敗: claude 1.0 の 起動。証拠: /evidence/claude",
  );
  assert.equal(notify("first"), "");
  assert.ok(JSON.parse(notify("second")).hookSpecificOutput.additionalContext);
  await writeFile(
    join(dir, "latest.json"),
    JSON.stringify({
      finishedAt: "2026-11-15T00:00:00Z",
      sha: "unknown",
      evidence: "/evidence/preparation",
      failed: [],
      preparation: { status: "failed" },
    }),
  );
  const preparation = JSON.parse(notify("third")).hookSpecificOutput
    .additionalContext;
  assert.ok(
    preparation.includes(
      "他社の CLI の互換の監視の準備が失敗。証拠: /evidence/preparation",
    ),
  );
  assert.equal(notify("third"), "");
});
