import assert from "node:assert/strict";
import test from "node:test";
import { buildWindowsPtyCompatibilityOptions } from "@iori/protocol/terminal-restore";
import { HeadlessEmulator } from "./headless-emulator.ts";

for (const [name, enter] of [
  ["通常画面", ""],
  ["代替画面", "\x1b[?1049h"],
]) {
  test(`${name}で末尾に空白行が続いても確認文を保って末尾空白行を除く`, async (t) => {
    const emulator = new HeadlessEmulator({ cols: 80, rows: 48 });
    t.after(() => emulator.dispose());
    await emulator.write(
      enter +
        "Folder access   \r\n\r\n  Allow access?   \r\n" +
        Array(45).fill(" ".repeat(80)).join("\r\n"),
    );
    assert.deepEqual(emulator.getVisibleLines(), [
      "Folder access",
      "",
      "  Allow access?",
    ]);
  });
}

test("ConPTY の互換設定で画面の行数を増やしても確認文を読み取れる", async (t) => {
  const emulator = new HeadlessEmulator({
    cols: 80,
    rows: 3,
    ...buildWindowsPtyCompatibilityOptions({
      backend: "conpty",
      buildNumber: 26100,
    }),
  });
  t.after(() => emulator.dispose());
  await emulator.write("\r\n".repeat(6));
  emulator.resize(80, 6);
  await emulator.write("Folder access\x1b[4;1H\x1b[J");
  assert.ok(emulator.getVisibleLines().includes("Folder access"));
});
