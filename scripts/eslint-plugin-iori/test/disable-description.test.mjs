import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: resolve(root, "eslint.config.mjs"),
});

async function lint(source) {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(root, "apps/host/src/disable-probe.ts"),
  });
  return result.messages;
}

test("global eslint-disable cannot suppress its required explanation", async () => {
  const messages = await lint("/* eslint-disable */\nconst value: any = 1;\n");
  const errors = messages.filter(
    (message) =>
      message.ruleId ===
      "@eslint-community/eslint-comments/require-description",
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].messageId, "missingDescription");
});

test("disable-like text in a string is not treated as a directive", async () => {
  const messages = await lint('const value = "/* eslint-disable */";\n');
  assert.equal(messages.length, 0);
});

test("explained resource disables remain allowed", async () => {
  const messages = await lint(
    "/* eslint-disable -- resource limit */\nAbortSignal.timeout(50);\n",
  );
  assert.equal(messages.length, 0);

  const ingressMessages = await lint(
    "// eslint-disable-next-line -- ingress validation\nif (requestRevision !== expectedRevision) throw new Error('invalid request');\n",
  );
  assert.equal(ingressMessages.length, 0);
});

test("unused explained disables still fail", async () => {
  const messages = await lint(
    "// eslint-disable-next-line iori/no-fixed-timeout-failure -- unused directive test\nconst value = 1;\n",
  );
  assert.equal(
    messages.some((message) =>
      message.message.startsWith("Unused eslint-disable directive"),
    ),
    true,
  );
});
