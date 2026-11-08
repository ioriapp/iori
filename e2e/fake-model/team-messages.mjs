import { fakeMarker } from "./marker.mjs";
export const probeDelegationCommand = `iori delegate --role Probe --difficulty low --title "Parent command check" --worktree parent --body 'Read this request, run iori report --body "Parent command verified." once, then end your turn. Do not change files.${fakeMarker("team-probe")}'`;
const codexCommand = (cmd, options = {}) => ({
  tool: "exec_command",
  input: { cmd, ...options },
});
const claudeCommand = (command, options = {}) => ({
  tool: "Bash",
  input: { command, ...options },
});
export const teamMessageScripts = {
  "team-parent-delegate": [
    claudeCommand(probeDelegationCommand),
    { text: "OK" },
  ],
  "team-probe": [
    codexCommand('iori report --body "Parent command verified."'),
    { text: "OK" },
  ],
  "team-ready": [{ text: "Ready" }],
  "team-resumed-ready": [{ text: "waiting" }],
  "team-direct-ready": [{ text: "Ready" }],
  "team-continued-ready": [{ text: "Ready" }],
  "team-interrupt": [{ hold: true }],
  "team-ask": [
    {
      text: "Asking the parent.",
      ...codexCommand('iori ask --body "Should I report completion?"'),
    },
    { text: "Question sent." },
  ],
  "team-answer": [
    codexCommand(
      'iori report --body "Successful verification; no files changed."',
    ),
    { text: "Reported." },
  ],
  "team-revise": [
    codexCommand(
      'iori report --body "Confirmed no files changed; verification successful."',
    ),
    { text: "Reported." },
  ],
  "team-read-only": [
    codexCommand('iori report --body "Read-only report received."'),
    { text: "Reported." },
  ],
  "team-approval": [
    codexCommand("node -e 'console.log(42)'", {
      sandbox_permissions: "require_escalated",
      justification: "Run the requested approval check outside the sandbox.",
    }),
    { text: "42" },
  ],
  "team-background": [
    claudeCommand("sleep 45; echo background-complete", {
      run_in_background: true,
      description: "Wait for background verification",
    }),
    { text: "Waiting for background completion." },
    claudeCommand('iori report --body "The initial request is complete."'),
    { text: "Reported." },
  ],
  "team-claude-initial": [
    claudeCommand('iori report --body "The initial request is complete."'),
    { text: "Reported." },
  ],
  "team-claude-resumed": [
    claudeCommand('iori report --body "The resumed request is complete."'),
    { text: "Reported." },
  ],
  "team-cross-repo": [
    codexCommand("cat sample.txt .iori-child-setup-root"),
    {
      ...codexCommand(
        "printf CROSS_REPO_OK > result.txt && iori report --body CROSS_REPO_OK",
      ),
      expectTokens: ["Second repository\n"],
    },
    { text: "Reported." },
  ],
};
