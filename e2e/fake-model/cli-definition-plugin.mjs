export const cliDefinitionPluginScripts = {
  "plugin-reply": [{ text: "IORI_PLUGIN_OK" }],
  "plugin-child": [
    {
      tool: "bash",
      input: { command: 'iori report --body "PLUGIN_DEFINITION_OK"' },
    },
    { text: "Reported." },
  ],
};
