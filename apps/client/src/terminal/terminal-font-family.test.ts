import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontFamily,
} from "./terminal-font-family.ts";

test("terminal font names are quoted and escaped before the fallback", () => {
  assert.equal(
    terminalFontFamily(` 'Fira Code', A\\B, My "Font", , `),
    `"Fira Code", "A\\\\B", "My \\"Font\\"", ${DEFAULT_TERMINAL_FONT_FAMILY}`,
  );
  assert.equal(terminalFontFamily(" ,  "), DEFAULT_TERMINAL_FONT_FAMILY);
});
