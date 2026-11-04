import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-web-terminal-observation.mjs";
const filename = "/repo/e2e/terminal/mouse-scroll.mjs";
ruleTester.run("no-web-terminal-observation", rule, {
  valid: [
    { filename, code: 'screen.evaluate("element.__e2eTerminal=this;");' },
    { filename, code: "element.__e2eTerminal=terminal;" },
    { filename, code: 'screen.evaluate("window.__TAURI_INTERNALS__.invoke");' },
    {
      filename: "/repo/e2e/web/terminal-preferences.mjs",
      code: 'screen.evaluate("element.__e2eTerminal.onData(listener)");',
    },
    {
      filename: "/repo/verification/web/run.mjs",
      code: "element.__e2eTerminal.onData(listener);",
    },
  ],
  invalid: [
    {
      filename,
      code: "screen.evaluate(`element.__e2eTerminal.onData(listener)`);",
      errors: [{ messageId: "webOnly" }],
    },
    {
      filename,
      code: 'screen.evaluate("const t=element.__e2eTerminal;");',
      errors: [{ messageId: "webOnly" }],
    },
    {
      filename,
      code: "element.__e2eTerminal.onData(listener);",
      errors: [{ messageId: "webOnly" }],
    },
    {
      filename: "/repo/verification/terminal/run.mjs",
      code: "screen.evaluate(`element['__e2eTerminal'].onData(listener)`);",
      errors: [{ messageId: "webOnly" }],
    },
  ],
});
