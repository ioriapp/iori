export const opencodeDelegationScripts = {
  "opencode-question": [
    {
      tool: "question",
      input: {
        questions: [
          {
            question: "Should release notes be brief or detailed?",
            header: "Release notes",
            options: [
              { label: "Brief", description: "Brief release notes" },
              { label: "Detailed", description: "Detailed release notes" },
            ],
          },
        ],
      },
    },
    { text: "Ready" },
  ],
  "opencode-v2-report": [
    {
      tool: "shell",
      input: { command: "iori report --body OPENCODE_REPORT_OK" },
    },
    { text: "Reported." },
  ],
  "opencode-v2-resume": [
    {
      tool: "shell",
      input: { command: "iori report --body OPENCODE_RESUMED_REPORT_OK" },
    },
    { text: "Reported." },
  ],
  "opencode-ready": [{ text: "Ready" }],
  "opencode-report": [
    {
      tool: "bash",
      input: {
        command: "iori report --body OPENCODE_REPORT_OK",
        description: "Report verification",
      },
    },
    { text: "Reported." },
  ],
  "opencode-resume": [
    {
      tool: "bash",
      input: {
        command: "iori report --body OPENCODE_RESUMED_REPORT_OK",
        description: "Report resumed verification",
      },
    },
    { text: "Reported." },
  ],
};
