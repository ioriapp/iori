export const terminalDaemonScripts = {
  "daemon-after": [
    {
      tool: "Bash",
      input: { command: "iori plan goal --body DAEMON_AFTER_RESTART" },
    },
    { text: "DAEMON_CLI_DONE" },
  ],
  "daemon-child": [{ text: "READY" }],
  "daemon-resumed": [{ text: "PARENT_RESUMED_OK" }],
};
