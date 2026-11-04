export const opencodeDelegationScripts = {
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
