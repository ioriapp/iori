import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-android-monkey.mjs";

ruleTester.run("no-android-monkey", rule, {
  valid: [
    'adb(["shell", "am", "start", "-n", activity]);',
    'run("adb shell am start -n package/activity");',
  ],
  invalid: [
    {
      code: 'adb(["shell", "monkey", "-p", packageName, "1"]);',
      errors: [{ messageId: "monkey" }],
    },
    {
      code: "run(`adb shell monkey -p ${packageName} 1`);",
      errors: [{ messageId: "monkey" }],
    },
  ],
});
