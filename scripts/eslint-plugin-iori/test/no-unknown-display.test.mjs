import { ruleTester } from "./rule-tester.mjs";
import rule from "../rules/no-unknown-display.mjs";

ruleTester.run("no-unknown-display", rule, {
  valid: [
    { code: 'const connectionState = "unknown";' },
    {
      code: 'const View = () => <span title="Ready">Connected</span>;',
      filename: "/repo/apps/client/src/view.tsx",
    },
    {
      code: 'export const en = { connection: "unknown" };',
      filename: "/repo/apps/client/src/state.ts",
    },
    {
      code: 'const option = <option value="unknown" />;',
      filename: "/repo/apps/client/src/view.tsx",
    },
    {
      code: 'const View = () => <span>{value ?? "Ready"}</span>;',
      filename: "/repo/apps/client/src/view.tsx",
    },
  ],
  invalid: [
    {
      code: "const View = () => <span>unknown</span>;",
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: "const View = () => <span>{'unknown'}</span>;",
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const View = () => <span>{value ?? "未確認"}</span>;',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const View = () => <input placeholder="N/A" />;',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const View = () => <input placeholder={value || "-"} />;',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'export const en = { connection: "未確認" };',
      filename: "/repo/apps/client/src/i18n/en.ts",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'function statusLabel(s) { return s ?? "Unknown"; }',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const fallback = "不明";',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const View = () => <span>{v ?? "–"}</span>;',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const View = () => <Widget subtitle="N/A" />;',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
    {
      code: 'const View = () => <span aria-label="—">Waiting</span>;',
      filename: "/repo/apps/client/src/view.tsx",
      errors: [{ messageId: "unknownDisplay" }],
    },
  ],
});
