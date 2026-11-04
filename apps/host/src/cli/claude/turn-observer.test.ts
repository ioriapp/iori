import assert from "node:assert/strict";
import { test } from "node:test";
import { turnRecord } from "./turn-observer.ts";

// Shapes observed with Claude Code 2.1.309 / Haiku: interruption and rejection
// are user records with array content; a typed prompt has string content.
const interrupted = {
  type: "user",
  isSidechain: false,
  message: {
    role: "user",
    content: [{ type: "text", text: "[Request interrupted by user]" }],
  },
};
const parse = (value: unknown) =>
  turnRecord(Buffer.from(JSON.stringify(value)));

test("Claudeの主の会話の中断と、利用者が入力した同じ文字列を区別する", () => {
  assert.deepEqual(parse(interrupted), { kind: "interrupted" });
  assert.deepEqual(
    parse({
      ...interrupted,
      message: { role: "user", content: "[Request interrupted by user]" },
    }),
    { kind: "continued" },
  );
});
