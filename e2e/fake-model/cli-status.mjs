const bash = { tool: "Bash", input: { command: 'node -e "console.log(42)"' } };
export const longApprovalCommand =
  "cat > release-notes.md <<'NOTES'\n# Release notes\nDocumentation example: token=x is a dummy value.\n" +
  Array.from(
    { length: 80 },
    (_, i) =>
      `Change ${i + 1}: Keep the terminal reading position after reconnecting and improve file navigation for mobile users.\n`,
  ).join("") +
  "NOTES\n";

export const cliStatusScripts = {
  "pi-running": [
    { tool: "bash", input: { command: "sleep 90" } },
    { text: "done" },
  ],
  "codex-first": [{ text: "FIRST_DONE" }],
  "codex-status": [{ text: "STATUS_DONE password=iori_test_fake_secret" }],
  "codex-approval": [
    { tool: "exec_command", input: { cmd: 'node -e "console.log(42)"' } },
    { text: "42" },
  ],
  "codex-two-approvals": [
    {
      tool: "exec_command",
      input: {
        cmd: "echo approval-a",
        sandbox_permissions: "require_escalated",
        justification: "Approve the first command.",
      },
    },
    {
      tool: "exec_command",
      input: {
        cmd: "echo approval-b",
        sandbox_permissions: "require_escalated",
        justification: "Approve the second command.",
      },
    },
    { text: "done" },
  ],
  "claude-approval-esc": [bash, { text: "OK" }],
  "claude-approval-no": [bash, { text: "OK" }],
  "claude-interrupt": [
    { tool: "Read", input: { file_path: "sample.txt" } },
    // Keep the real CLI in its response phase while the user presses Esc.
    { hold: true },
  ],
  // State polling runs every 200 ms; keep this reply active across a poll.
  "claude-after-interrupt": [{ text: "AFTER_INTERRUPT", delayMs: 1000 }],
  "claude-long-approval": [
    { tool: "Read", input: { file_path: "approval-command.txt" } },
    { tool: "Bash", input: { command: longApprovalCommand } },
    { text: "OK" },
  ],
};
