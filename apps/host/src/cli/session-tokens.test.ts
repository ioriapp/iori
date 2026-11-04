import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ShellDefinition } from "../terminal/platform.ts";
import { sessionTokens as claude } from "./claude/session-tokens.ts";
import { sessionTokens as codex } from "./codex/session-tokens.ts";
import { sessionTokens as pi } from "./pi/session-tokens.ts";
// The CLIs' own readers read the conversation file and ignore this shell.
const shell: ShellDefinition = {
  id: "bash",
  label: "bash",
  executable: "/bin/bash",
  args: [],
};
async function fixture(t: TestContext, cli: string) {
  const directory = await mkdtemp(join(tmpdir(), "iori-session-tokens-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = await readFile(
    new URL(`./${cli}/session-tokens.fixture.jsonl`, import.meta.url),
  );
  const file = join(directory, "session.jsonl");
  await writeFile(file, "");
  return { bytes, session: { id: "fixture", file } };
}
// Claude Code 2.1.310, Codex 0.164.0 and Pi 1.4.0: original fields/types,
// with body/identity strings replaced. Exercise the actual incremental readers.
test("Claudeの実記録を途中まで読み、追記後も同じmessageを一度だけ数える", async (t) => {
  const { bytes, session } = await fixture(t, "claude");
  assert.equal(await claude.read(session, shell), undefined);
  const split = bytes.indexOf(10) + 30;
  await appendFile(session.file, bytes.subarray(0, split));
  assert.equal((await claude.read(session, shell))?.input, 11981);
  assert.equal((await claude.read(session, shell))?.output, 301);
  await appendFile(session.file, bytes.subarray(split));
  const expected = {
    input: 24301,
    output: 329,
    cacheRead: 16557,
    cacheWrite: 7740,
    reasoning: 213,
  };
  assert.deepEqual(await claude.read(session, shell), expected);
  assert.deepEqual(await claude.read(session, shell), expected);
});
// Codex 0.164.0, gpt-6-luna, high: complete token_count records from a real rollout.
test("Codexの実rolloutの追記を読み、最後の累計と内訳だけを使う", async (t) => {
  const { bytes, session } = await fixture(t, "codex");
  assert.equal(await codex.read(session, shell), undefined);
  const split = bytes.indexOf(10) + 30;
  await appendFile(session.file, bytes.subarray(0, split));
  assert.deepEqual(await codex.read(session, shell), {
    input: 13807,
    output: 488,
    cacheRead: 11520,
    cacheWrite: 0,
    reasoning: 310,
  });
  await appendFile(session.file, bytes.subarray(split));
  const expected = {
    input: 42765,
    output: 986,
    cacheRead: 39168,
    cacheWrite: 0,
    reasoning: 534,
  };
  assert.deepEqual(await codex.read(session, shell), expected);
  assert.deepEqual(await codex.read(session, shell), expected);
});
test("Piの実sessionの未完の行を読み直し、1件のassistantと追記した重複行を一度だけ数える", async (t) => {
  const { bytes, session } = await fixture(t, "pi");
  assert.equal(await pi.read(session, shell), undefined);
  const split = Math.floor(bytes.length / 2);
  await appendFile(session.file, bytes.subarray(0, split));
  assert.equal(await pi.read(session, shell), undefined);
  await appendFile(session.file, bytes.subarray(split));
  const expected = {
    input: 802,
    output: 29,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  };
  assert.deepEqual(await pi.read(session, shell), expected);
  await appendFile(session.file, bytes);
  assert.deepEqual(await pi.read(session, shell), expected);
});
