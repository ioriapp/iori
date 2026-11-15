import assert from "node:assert/strict";
import test from "node:test";
import { isTeamCommand, parseCommand, teamInputKeys } from "./commands.ts";

test("screen・interrupt・input をチームコマンドとして解釈し不正な組合せを拒む", () => {
  for (const name of ["screen", "interrupt", "input"]) {
    assert.equal(isTeamCommand(name), true);
  }
  assert.deepEqual(parseCommand(["screen", "child-1"]), {
    kind: "screen",
    child: "child-1",
  });
  assert.deepEqual(parseCommand(["interrupt", "child-1"]), {
    kind: "interrupt",
    child: "child-1",
  });
  assert.deepEqual(parseCommand(["input", "child-1", "--text", "hello"]), {
    kind: "input",
    child: "child-1",
    text: "hello",
    enter: false,
  });
  assert.deepEqual(
    parseCommand(["input", "child-1", "--text", "yes", "--enter"]),
    {
      kind: "input",
      child: "child-1",
      text: "yes",
      enter: true,
    },
  );
  for (const key of teamInputKeys) {
    assert.deepEqual(parseCommand(["input", "child-1", "--key", key]), {
      kind: "input",
      child: "child-1",
      key,
    });
  }

  for (const invalid of [
    ["screen"],
    ["interrupt", "child-1", "extra"],
    ["input"],
    ["input", "child-1"],
    ["input", "child-1", "--text", ""],
    ["input", "child-1", "--text", "hi", "--key", "enter"],
    ["input", "child-1", "--key", "enter", "--enter"],
    ["input", "child-1", "--key", "space"],
  ]) {
    assert.throws(() => parseCommand(invalid));
  }
});
