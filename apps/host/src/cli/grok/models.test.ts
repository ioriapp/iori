import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGrokModels } from "./models.ts";

// crates/codegen/xai-grok-pager/src/models.rs の出力形式。
const sampleOutput = `You are not authenticated.

Default model: grok-4.6

Available models:
  * grok-4.6 (default)
  - grok-4.5
`;

test("grok models の Available models からモデル名を取り出す", () => {
  assert.deepEqual(parseGrokModels(sampleOutput), [
    { name: "grok-4.6", efforts: [] },
    { name: "grok-4.5", efforts: [] },
  ]);
});

test("Available models: が無い出力は候補 0 件になる", () => {
  assert.deepEqual(parseGrokModels("You are not authenticated.\n"), []);
  assert.deepEqual(parseGrokModels(""), []);
});
