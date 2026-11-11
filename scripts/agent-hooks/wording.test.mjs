import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const advice = "文脈で別の意味なら直さなくてよい。直す時は使う語に合わせる。";

test("Claudeの書いた文だけを検査し、文脈判断の候補を返す", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iori-wording-test-"));
  try {
    const file = path.join(dir, "issue.md");
    for (const [toolName, toolInput] of [
      ["Write", { content: "版と写す" }],
      ["Edit", { new_string: "版と写す" }],
      ["MultiEdit", { edits: [{ new_string: "版" }, { new_string: "写す" }] }],
    ]) {
      writeFileSync(file, "古い窓\n版と写す");
      const result = spawnSync(
        process.execPath,
        ["scripts/agent-hooks/wording.mjs"],
        {
          input: JSON.stringify({
            hook_event_name: "PostToolUse",
            tool_name: toolName,
            tool_input: { file_path: file, ...toolInput },
          }),
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0);
      assert.equal(readFileSync(file, "utf8"), "古い窓\nバージョンと写す");
      const { decision, reason } = JSON.parse(result.stdout);
      assert.equal(decision, "block");
      assert.match(reason, /写す → コピー・複製・反映/);
      assert.ok(reason.endsWith(advice));
      assert.doesNotMatch(reason, /古い窓/);
    }
    const result = spawnSync(
      process.execPath,
      ["scripts/agent-hooks/wording.mjs"],
      {
        input: JSON.stringify({
          tool_name: "Edit",
          tool_input: { file_path: file, new_string: "新しい文" },
        }),
        encoding: "utf8",
      },
    );
    assert.equal(result.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codexのapply_patchの追加行から各ファイルの書いた文を検査する", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "iori-wording-test-"));
  try {
    const file = path.join(dir, "issue.md");
    writeFileSync(file, "古い窓\n版と写す");
    const command = `*** Begin Patch\n*** Update File: ${file}\n@@\n 古い窓\n+版と写す\n*** End Patch`;
    const result = spawnSync(
      process.execPath,
      ["scripts/agent-hooks/codex-wording.mjs"],
      {
        input: JSON.stringify({
          hook_event_name: "PostToolUse",
          tool_name: "apply_patch",
          tool_input: { command },
        }),
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    assert.equal(readFileSync(file, "utf8"), "古い窓\nバージョンと写す");
    const { decision, reason } = JSON.parse(result.stdout);
    assert.equal(decision, "block");
    assert.match(reason, /バージョンと写す: 写す → コピー・複製・反映/);
    assert.doesNotMatch(reason, /古い窓/);
    assert.ok(reason.endsWith(advice));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
