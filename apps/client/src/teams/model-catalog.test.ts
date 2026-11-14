import assert from "node:assert/strict";
import { test } from "node:test";
import { modelOrder } from "./model-catalog.ts";

test("modelOrder sorts by CLI definition order, then provider, then model name", () => {
  const items = [
    { cli: "codex", model: "gpt-5.4" },
    { cli: "opencode", model: "openai/gpt-5" },
    { cli: "claude", model: "sonnet" },
    { cli: "opencode", model: "anthropic/claude-sonnet-4" },
    { cli: "opencode", model: "anthropic/claude-haiku-4" },
    { cli: "claude", model: "haiku" },
  ];

  const sorted = [...items].sort(
    modelOrder(["claude", "codex", "opencode"], "en"),
  );

  assert.deepEqual(sorted, [
    { cli: "claude", model: "haiku" },
    { cli: "claude", model: "sonnet" },
    { cli: "codex", model: "gpt-5.4" },
    { cli: "opencode", model: "anthropic/claude-haiku-4" },
    { cli: "opencode", model: "anthropic/claude-sonnet-4" },
    { cli: "opencode", model: "openai/gpt-5" },
  ]);
});
