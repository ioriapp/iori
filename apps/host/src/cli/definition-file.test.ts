import assert from "node:assert/strict";
import { test } from "node:test";
import { readDefinition } from "./definition-file.ts";

test("初回入力の準備条件は paste と既知の値だけを受け付ける", () => {
  const read = (initialPrompt: unknown) =>
    readDefinition(
      {
        id: "example",
        name: "Example",
        command: "example",
        launch: { initialPrompt },
      },
      "example",
    );
  const valid = read({ mode: "paste", readyWhen: "osc7501-idle" });
  assert.ok("definition" in valid);
  assert.deepEqual(valid.definition.launch.initialPrompt, {
    mode: "paste",
    readyWhen: "osc7501-idle",
  });
  assert.deepEqual(read({ mode: "paste", readyWhen: "unknown" }), {
    reason: {
      kind: "values",
      field: "launch.initialPrompt.readyWhen",
      values: ["osc7501-idle"],
    },
  });
  assert.deepEqual(
    read({ mode: "argument", args: ["{prompt}"], readyWhen: "osc7501-idle" }),
    {
      reason: {
        kind: "values",
        field: "launch.initialPrompt.mode",
        values: ["paste"],
      },
    },
  );
});
