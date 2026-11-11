import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { cliDefinitions, listsModels } from "./definitions.ts";

// 実物の一覧の取り方を確かめて定義へ書いたら、表から外す（#333）。
const knownMissing = [
  "amp",
  "qoder",
  "grok",
  "codebuddy",
  "hermes",
  "vtcode",
  "kiro",
  "vibe",
];

test("同梱のCLIはモデルの候補の出し方か、無いことの明示を持つ", () => {
  const missing = cliDefinitions
    .filter((definition) => {
      const file = JSON.parse(
        readFileSync(
          new URL(`./${definition.id}/definition.json`, import.meta.url),
          "utf8",
        ),
      );
      return !listsModels(definition) && file.models?.unavailable !== true;
    })
    .map((definition) => definition.id);
  assert.deepEqual(
    missing.filter((id) => !knownMissing.includes(id)),
    [],
  );
  assert.deepEqual(
    knownMissing.filter((id) => !missing.includes(id)),
    [],
  );
});
