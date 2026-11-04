const workerProceed = Promise.withResolvers();
export const continueReadmeWorker = () => workerProceed.resolve();

const shell = (command, text) => ({
  tool: "Bash",
  input: { command },
  ...(text ? { text } : {}),
});
const delegate = (role, title) =>
  `iori delegate --role ${role} --difficulty low --title "${title}" --worktree parent --plan ${role === "Worker" ? 2 : 3} --file tasks/${role.toLowerCase()}.md`;

export const readmeScripts = {
  "readme-plan": [
    shell(
      [
        'iori plan goal --body "Restore a reliable sign-in flow"',
        'iori plan add --title "Reproduce the retry bug"',
        'iori plan add --title "Fix the submit state" --after 1',
        'iori plan add --title "Review error handling" --after 2',
        'iori plan add --title "Verify the retry flow" --after 3',
        'iori plan update 1 --state done --checkpoint "Confirmed: failed sign-in leaves the button disabled"',
        "iori plan update 2 --state in_progress",
        "iori plan update 3 --state in_progress",
      ].join(" && "),
    ),
    {
      text: "The plan is ready. I will delegate the implementation and independent review.",
    },
  ],
  "readme-plan-complete": [
    shell(
      'iori plan update 2 --state done --checkpoint "Submit state resets in finally; fix reported"',
    ),
    {
      text: "The implementation is complete. Review and final verification are next.",
    },
  ],
  "readme-hero": [
    {
      tool: "Read",
      input: { file_path: "src/LoginForm.tsx" },
      text: "I found the issue: a failed sign-in leaves the submit button disabled. I will restore the form state and check the error message.",
    },
    {
      text: "The form should reset isSubmitting in a finally block. I am checking the error path and keyboard navigation.",
      hold: true,
    },
  ],
  "readme-delegate": [
    shell(
      delegate("Worker", "Fix the login form"),
      "I will split the fix and review so they can run together.",
    ),
    shell(delegate("Reviewer", "Review the error handling")),
    {
      text: "The Worker is fixing the form. The Reviewer is checking the error and accessibility paths.",
    },
  ],
  "readme-reviewer": [
    { tool: "exec_command", input: { cmd: "cat src/LoginForm.tsx" } },
    {
      tool: "exec_command",
      input: {
        cmd: 'iori report --body "Review complete: keep the error message visible, restore the submit button in finally, and retain the email for retry. No files changed."',
      },
    },
    { text: "Review sent to the parent." },
  ],
  "readme-worker": [
    { tool: "exec_command", input: { cmd: "cat src/LoginForm.tsx" } },
    {
      tool: "apply_patch",
      input:
        '*** Begin Patch\n*** Update File: src/LoginForm.tsx\n@@\n       await signIn(email, password);\n-      setSubmitting(false);\n     } catch {\n       setError("We couldn\'t sign you in. Please try again.");\n+    } finally {\n+      setSubmitting(false);\n     }\n*** End Patch',
    },
    {
      tool: "exec_command",
      after: workerProceed.promise,
      input: {
        cmd: 'iori report --body "Fixed: the submit button is restored after failed sign-in. The error stays visible and the email is preserved for retry. Verified the success and error paths."',
      },
    },
    { text: "Fix reported." },
  ],
  "readme-question": [
    {
      tool: "exec_command",
      input: {
        cmd: 'iori ask --body "Should a failed sign-in keep the email address so the user can retry?"',
      },
    },
    { text: "Waiting for the product decision." },
  ],
  "readme-user-question": [
    {
      tool: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Should a failed sign-in keep the email address?",
            header: "Retry behavior",
            options: [
              {
                label: "Keep the email",
                description: "Let the user retry without typing it again.",
              },
              {
                label: "Clear the email",
                description: "Start each attempt with a blank form.",
              },
            ],
            multiSelect: false,
          },
        ],
      },
    },
    { text: "I will keep the email for the next attempt." },
  ],
  "readme-approval": [
    {
      tool: "Bash",
      input: {
        command: "npm run test -- LoginForm",
        description: "Check the login form regression tests",
      },
    },
    { text: "The login form tests pass." },
  ],
};

// These numbers belong only to the staged development example. Unmarked API
// calls and every other scenario retain the fake API's usual 10/10 default.
for (const [name, steps] of Object.entries(readmeScripts)) {
  const usage =
    name === "readme-worker"
      ? { input: 9000, output: 450, cache: 6000, reasoning: 200 }
      : name === "readme-reviewer"
        ? { input: 6000, output: 300, cache: 3500, reasoning: 100 }
        : { input: 4200, output: 300, cache: 1400, reasoning: 120 };
  for (const step of steps) step.usage = usage;
}
