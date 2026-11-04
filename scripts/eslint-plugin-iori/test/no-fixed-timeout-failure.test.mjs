import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-fixed-timeout-failure.mjs";

ruleTester.run("no-fixed-timeout-failure", rule, {
  valid: [
    { code: "setTimeout(() => refreshStatus(), 1000);" },
    { code: "setTimeout(() => resolveNextPage(), 250);" },
    { code: "await Promise.race([firstValue, secondValue]);" },
    { code: 'setTimeout(() => setStatus("ready"), 1000);' },
    { code: 'setTimeout(() => setState("waiting"), 1000);' },
    { code: "setTimeout(() => setError(null), 3000);" },
  ],
  invalid: [
    {
      code: "const signal = AbortSignal.timeout(5000);",
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: "await Promise.race([work, new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 3000))]);",
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: "import { setTimeout as delay } from 'node:timers/promises'; await Promise.race([work, delay(5000).then(() => { throw new Error('late'); })]);",
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: 'execFile("git", args, { timeout: 5000 });',
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: "setTimeout(() => { throw new Error('late'); }, 1000);",
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: 'setTimeout(() => { status = "failed"; }, 1000);',
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: 'setTimeout(() => setStatus("failed"), 1000);',
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: 'setTimeout(() => setPhase("failed"), 1000);',
      errors: [{ messageId: "timeoutFailure" }],
    },
    {
      code: 'setTimeout(() => setState("failed"), 1000);',
      errors: [{ messageId: "timeoutFailure" }],
    },
  ],
});
