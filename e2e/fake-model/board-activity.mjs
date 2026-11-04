import { fakeMarker } from "./marker.mjs";
const delegate =
  'iori delegate --role Worker --difficulty low --title "Tool activity" --worktree new --body "Read this request and reply Ready, then finish your turn. Wait for the next direct user instruction. Do not report yet.' +
  fakeMarker("board-ready") +
  '"';

export const boardActivityScripts = {
  "board-delegate": [
    { tool: "Bash", input: { command: delegate } },
    { text: "Delegated." },
  ],
  "board-ready": [{ text: "Ready" }],
  "board-codex": [
    { tool: "exec_command", input: { cmd: "sleep 2" } },
    {
      tool: "apply_patch",
      input:
        "*** Begin Patch\n*** Add File: board-activity.txt\n+board activity verified\n*** End Patch",
    },
    {
      tool: "exec_command",
      input: { cmd: 'iori report --body "Board activity verified"' },
    },
    { text: "Reported." },
  ],
  "board-claude": [
    { tool: "Bash", input: { command: "sleep 2" } },
    {
      tool: "Write",
      input: {
        file_path: "board-activity.txt",
        content: "board activity verified\n",
      },
    },
    {
      tool: "Bash",
      input: { command: 'iori report --body "Board activity verified"' },
    },
    { text: "Reported." },
  ],
};
