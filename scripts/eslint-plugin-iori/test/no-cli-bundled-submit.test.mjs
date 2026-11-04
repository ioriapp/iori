import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-cli-bundled-submit.mjs";
ruleTester.run("no-cli-bundled-submit", rule, {
  valid: [
    'submitToCli(client, "run a command");',
    'typeTerminal(client, "\\r");',
  ],
  invalid: [
    {
      code: 'typeTerminal(client, "run\\r");',
      errors: [{ messageId: "bundled" }],
    },
    {
      code: 'typeTerminal(client, text + "\\r");',
      errors: [{ messageId: "bundled" }],
    },
    {
      code: "typeTerminal(client, `run ${command}\\r`);",
      errors: [{ messageId: "bundled" }],
    },
  ],
});
