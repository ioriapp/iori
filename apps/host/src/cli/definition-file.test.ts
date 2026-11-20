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

test("指示を返す hook のイベントと出力形式を読み、誤った形式を知らせる", () => {
  const read = (instruction: unknown, plugin = false) =>
    readDefinition(
      {
        id: "example",
        name: "Example",
        command: "example",
        hooks: plugin
          ? {
              format: "plugin-file",
              install: { copy: "plugin.js", to: "~/plugins" },
              instruction,
            }
          : {
              format: "claude-settings",
              file: "~/settings.json",
              rules: [{ event: "SessionStart", state: "idle" }],
              instruction,
            },
      },
      "example",
    );
  const instruction = { event: "SessionStart", format: "stdout", once: true };
  const file = read(instruction);
  assert.ok("definition" in file);
  assert.deepEqual(file.definition.hooks?.instruction, instruction);
  const plugin = read(true, true);
  assert.ok("definition" in plugin);
  assert.equal(plugin.definition.hooks?.instruction, true);
  for (const [result, field] of [
    [read({ ...instruction, format: "invalid" }), "hooks.instruction.format"],
    [read({ ...instruction, once: "true" }), "hooks.instruction.once"],
    [read({ ...instruction, event: "" }), "hooks.instruction.event"],
    [read("yes", true), "hooks.instruction"],
  ] as const) {
    assert.ok("reason" in result && "field" in result.reason);
    assert.equal(result.reason.field, field);
  }
});
