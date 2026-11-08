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
};
