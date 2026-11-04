import { test } from "node:test";
import assert from "node:assert/strict";
import { modelProvider, groupModels } from "./teams.ts";
test("provider names use only the prefix before the first slash and preserve model IDs", () => {
  const models = [
    "openai/gpt-6.1-sol",
    "openai/gpt-6-luna",
    "local/nested/model",
    "gpt-6.1-sol",
    "llama8000/qwen38-27b",
    "",
    "/model",
  ];
  assert.deepEqual(models.map(modelProvider), [
    "openai",
    "openai",
    "local",
    "",
    "llama8000",
    "",
    "",
  ]);
  assert.deepEqual(groupModels(models), {
    openai: models.slice(0, 2),
    local: [models[2]],
    "": [models[3], "", "/model"],
    llama8000: [models[4]],
  });
});
