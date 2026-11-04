export const cliOmpScripts = {
  "omp-saved": [{ text: "OMP_SAVED", delayMs: 1000 }],
  "omp-approval": [
    { tool: "bash", input: { command: "echo IORI_OMP_APPROVE" } },
    { text: "IORI_OMP_APPROVE" },
  ],
  "omp-resume": [
    {
      text: "IORI_OMP_MEMORY",
      delayMs: 1000,
      expectTokens: ["IORI_OMP_MEMORY"],
    },
  ],
  "omp-child": [
    {
      text: "IORI_OMP_INSTRUCTION_FILE",
      expectTokens: ["IORI_OMP_INSTRUCTION_FILE"],
      tool: "bash",
      input: { command: 'iori report --body "OMP_CHILD_OK"' },
    },
    { text: "IORI_OMP_INSTRUCTION_FILE" },
  ],
  "omp-profile": [{ text: "OMP_PROFILE_OK", delayMs: 1000 }],
};
