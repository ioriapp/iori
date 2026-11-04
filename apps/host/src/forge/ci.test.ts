import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { logPart } from "./ci.ts";

// The end of a real Forgejo log (example/iori run 161 job 3053): its lines
// carry 3- and 4-byte UTF-8 characters (✔ ℹ ⚙️ ⭐ ✅ 🏁).
const bytes = readFileSync(
  new URL(
    "../../../client/src/forge/ci-log-forgejo.fixture.txt",
    import.meta.url,
  ),
);
const text = bytes.toString("utf8");

// The public repositories' logs are shorter than one part, so the E2E reads
// every log whole; reading an earlier part starts at a byte the Forge chose.
test("a log part cut at any byte starts at a line and keeps exact offsets", () => {
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const part = logPart(bytes.subarray(cut), cut, bytes.length);
    assert.equal(part.end, bytes.length);
    // A part inside one line shows that line cut, so reading earlier moves back.
    const inOneLine = bytes.subarray(cut, -1).indexOf(0x0a) < 0;
    assert.equal(bytes[part.start - 1] === 0x0a || inOneLine, true);
    assert.equal(part.text, bytes.subarray(part.start).toString("utf8"));
    assert.ok(text.endsWith(part.text));
  }
});

test("earlier parts read back to the start join into the whole log", () => {
  const size = 700;
  let before = bytes.length;
  let joined = "";
  while (before > 0) {
    const from = Math.max(0, before - size);
    const part = logPart(bytes.subarray(from, before), from, bytes.length);
    assert.equal(part.end, before);
    joined = part.text + joined;
    before = part.start;
  }
  assert.equal(joined, text);
});
