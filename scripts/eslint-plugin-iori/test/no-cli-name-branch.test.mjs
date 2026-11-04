import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-cli-name-branch.mjs";

ruleTester.run("no-cli-name-branch", rule, {
  valid: [
    {
      code: 'if (workspaceId === "workspace") openWorkspace();',
      filename: "/repo/apps/host/src/workspaces/open.ts",
    },
    {
      code: 'if (provider === "codex") startAdapter();',
      filename: "/repo/apps/host/src/cli/codex/adapter.ts",
    },
    {
      code: 'if (provider === "external-cli") startAdapter();',
      filename: "/repo/apps/host/src/session.ts",
    },
    {
      code: 'const cliName = "codex"; const label = "Pi";',
      filename: "/repo/apps/host/src/session.ts",
    },
    {
      code: 'showProviderName("claude");',
      filename: "/repo/apps/client/src/session.tsx",
    },
    {
      code: 'const area = 2 * Math.PI * r; page.cursor; el.style.cursor = "grabbing";',
      filename: "/repo/apps/host/src/session.ts",
    },
    {
      code: "const page = { cursor: next };",
      filename: "/repo/apps/host/src/session.ts",
    },
    {
      code: "const constants = { pi: 3 };",
      filename: "/repo/apps/client/src/view.tsx",
    },
  ],
  invalid: [
    {
      code: 'if (cli === "codex") startAdapter();',
      filename: "/repo/apps/host/src/session.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: 'if (name === "codex") startAdapter();',
      filename: "/repo/apps/host/src/session.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: 'switch (name) { case "pi": startAdapter(); }',
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: 'name.includes("claude");',
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: 'name.startsWith("claude");',
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: '["claude", "pi"].includes(name);',
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: "const adapters = { codex: 1, pi: 2 }; adapters[provider];",
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: "const handlers = { codex, claude }; handlers[name]();",
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: 'handlers["codex"]();',
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: "const handlers = { 'codex': () => {} }; handlers[cli]();",
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: "settings.providerSettings.modelId;",
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
    {
      code: 'new Map([["codex", 1]]).get(n);',
      filename: "/repo/apps/host/src/registry.ts",
      errors: [{ messageId: "cliBranch" }],
    },
  ],
});
