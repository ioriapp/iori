import assert from "node:assert/strict";
import { test } from "node:test";
import { parseQoderModels } from "./models.ts";

// @qoder-ai/qodercli@1.1.92 bundle/qodercli.js 内 formatModelListText の出力形式。
const sampleOutput = `MODEL
auto
Claude Sonnet 4 (claude-sonnet-4)
Qwen3 Coder (Preview) (qwen3-coder-preview)
Very Long Display Name (very-long-model-identifier-that-exceeds…)
`;

test("qoder --list-models の出力から名前とラベルを取り出す", () => {
  assert.deepEqual(parseQoderModels(sampleOutput), [
    { name: "auto", efforts: [] },
    { name: "claude-sonnet-4", label: "Claude Sonnet 4", efforts: [] },
    {
      name: "qwen3-coder-preview",
      label: "Qwen3 Coder (Preview)",
      efforts: [],
    },
    {
      name: "Very Long Display Name",
      label: "Very Long Display Name",
      efforts: [],
    },
  ]);
});

test("空出力や MODEL 見出しだけの出力は候補 0 件になる", () => {
  assert.deepEqual(parseQoderModels("MODEL\n"), []);
  assert.deepEqual(parseQoderModels(""), []);
});
