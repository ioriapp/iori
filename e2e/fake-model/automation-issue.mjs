export const automationIssueScripts = {
  "automation-issue": [
    {
      tool: "exec_command",
      input: {
        cmd: "printf '1\\n' > issue.txt && git add issue.txt && git commit -m 'Add issue number' && iori pr create --issue 1 --title 'Add issue file'",
      },
      // The scenario writes the fixture's Issue number here and checks that
      // iori's instruction carried it to the model.
      expectTokens: [],
    },
    { text: "Pull request created." },
  ],
  "automation-issue-main": [
    { tool: "exec_command", input: { cmd: "iori pr create --title x" } },
    // The scripted reply repeats the tool output; the request must already
    // carry iori's reason from the real command.
    {
      text: "Cannot create a Pull request from the default branch (main)",
      expectTokens: [
        "Cannot create a Pull request from the default branch (main)",
      ],
    },
  ],
};
