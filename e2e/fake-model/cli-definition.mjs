export const cliDefinitionScripts = {
  "definition-save": [{ text: "DEFINITION_SAVED" }],
  "definition-child": [
    {
      tool: "Bash",
      input: { command: 'iori report --body "DEFINITION_REPORT_OK"' },
    },
    { text: "Reported." },
  ],
  "definition-resume": [
    {
      text: "IORI_DEFINITION_MEMORY",
      expectTokens: ["IORI_DEFINITION_MEMORY"],
    },
  ],
};
