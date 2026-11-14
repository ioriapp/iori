import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { capabilities } from "./capabilities.mjs";
import { withCli } from "./fixture.mjs";

// No model input or login operation is sent to a CLI without a fake API route.
export function limitedContracts(cli, screen) {
  test("起動して最初の画面を受信する", (t) =>
    withCli(t, cli, {}, async (context) => {
      const { terminal: created } = await context.client.request("cli.launch", {
        cliId: cli,
        cwd: join(context.dataRoot, "repository"),
      });
      const pty = await context.terminal(context.client, created.id);
      await pty.waitFor(({ output }) =>
        screen.test(
          output
            .split(/\r?\n/u)
            .filter((line) => !line.includes("iori-test#"))
            .join("\n"),
        ),
      );
    }));
  test(
    "モデルの一覧を読み込む",
    { skip: capabilities[cli]?.catalog },
    async (t) => {
      const definition = JSON.parse(
        await readFile(
          new URL(
            `../../apps/host/src/cli/${cli}/definition.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
      if (definition.models?.unavailable)
        return t.skip("その CLI に機能がない");
      return withCli(t, cli, {}, async ({ client }) => {
        const result = await client.request("cli.models", { cliId: cli });
        assert.equal(result.error, undefined, result.errorDetail);
        assert.ok(result.models.length);
      });
    },
  );
}
