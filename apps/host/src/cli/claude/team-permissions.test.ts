import assert from "node:assert/strict";
import { test } from "node:test";
import { teamCommandPermissions } from "./team-permissions.ts";

test("quote-free executable paths allow bare, single and double quoted forms for each shell", () => {
  for (const windows of [false, true]) {
    const directory = windows ? "C:\\iori-bin" : "/opt/iori-bin";
    const rules = teamCommandPermissions(directory, windows).filter(
      (rule) => !rule.endsWith("(iori *)"),
    );
    for (const tool of windows ? ["Bash", "PowerShell"] : ["Bash"]) {
      const commands = rules
        .filter((rule) => rule.startsWith(tool + "("))
        .map((rule) => rule.slice(tool.length + 1, -3));
      assert.equal(commands.length, 3);
      const bare = commands.find((command) => !/^[&'"]/.test(command))!;
      assert.ok(bare);
      assert.ok(
        commands.includes(`${tool === "PowerShell" ? "& " : ""}'${bare}'`),
      );
      assert.ok(
        commands.includes(`${tool === "PowerShell" ? "& " : ""}"${bare}"`),
      );
    }
    if (windows)
      assert.ok(
        rules
          .filter((rule) => rule.startsWith("Bash("))
          .every((rule) => !rule.includes("\\")),
      );
  }
});

test("paths with spaces or shell syntax never grant a bare executable prefix", () => {
  for (const windows of [false, true]) {
    for (const special of [
      " ",
      "$value",
      "`value",
      '"',
      "'",
      ";",
      "&",
      "(",
      "\n",
      ...(windows ? [] : ["\\"]),
    ]) {
      const directory = (windows ? "C:\\iori" : "/opt/iori") + special + "bin";
      const rules = teamCommandPermissions(directory, windows).filter(
        (rule) => !rule.endsWith("(iori *)"),
      );
      for (const rule of rules) {
        const command = rule.slice(rule.indexOf("(") + 1, -3);
        assert.match(
          command,
          rule.startsWith("PowerShell(") ? /^& ['"]/u : /^['"]/u,
        );
        if (/[$`"]/.test(special) || (!windows && special === "\\"))
          assert.match(
            command,
            rule.startsWith("PowerShell(") ? /^& '/u : /^'/u,
          );
      }
    }
  }
});
