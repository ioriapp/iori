import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
  sendLine,
} from "./fixtures/test.ts";
import { launch } from "./fixtures/journeys.ts";

test(
  "CLIの状態とAttentionが作業中から承認待ち、完了へ変わる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const cli = "state-actor";
    const script = fileURLToPath(
      new URL("../../verification/host/scripted-cli.mjs", import.meta.url),
    );
    await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: cli,
        name: cli,
        command: { shell: `'${process.execPath}' '${script}'` },
        hooks: {
          format: "claude-settings",
          file: join(app.folder, "state-settings.json"),
          sessionId: "session_id",
          rules: [
            { event: "SessionStart", state: "idle" },
            { event: "UserPromptSubmit", state: "active" },
            {
              event: "PermissionRequest",
              state: "waiting",
              attention: "approval",
              tool: "tool_name",
            },
            { event: "Stop", state: "done" },
          ],
        },
      }),
    });
    await page.goto(app.url);
    await openFolder(page, app);
    await launch(page, cli);
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "ACTOR_READY");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-files"]').click();
    const row = page.locator(`[data-iori-terminal-row="${id}"]`);
    const attention = page.locator('[data-iori-action="attention-open"]');
    await app.input(
      id,
      JSON.stringify({ id: "work", hook: "UserPromptSubmit" }) + "\r",
    );
    await expect(
      row.getByRole("img", { name: "Running", exact: true }),
    ).toBeVisible();
    await app.input(
      id,
      JSON.stringify({
        id: "approval",
        hook: "PermissionRequest",
        payload: { tool_name: "Bash" },
      }) + "\r",
    );
    await expect(
      row.getByRole("img", { name: "Attention", exact: true }),
    ).toBeVisible();
    await expect(attention).toBeEnabled();
    await attention.click();
    await sendLine(visibleTerminal(page), "yes");
    await app.terminalText(id, "ACTOR_PROMPT:");
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.locator('[data-iori-action="workspace-open-files"]').click();
    await app.input(id, JSON.stringify({ id: "done", hook: "Stop" }) + "\r");
    await expect(
      row.getByRole("img", { name: "Done", exact: true }),
    ).toBeVisible();
    await expect(attention).toBeDisabled();
  },
);

test(
  "失敗を表示したCLIで次の入力を送る",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const cli = "failure-actor";
    const script = fileURLToPath(
      new URL("../../verification/host/lifecycle-cli.mjs", import.meta.url),
    );
    const saved = await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: cli,
        name: cli,
        command: {
          shell: `'${process.execPath}' '${script}' --action failure`,
        },
        hooks: {
          format: "claude-settings",
          file: join(app.folder, "failure-settings.json"),
          sessionId: "session_id",
          rules: [
            { event: "SessionStart", state: "idle" },
            { event: "UserPromptSubmit", state: "active" },
            {
              event: "StopFailure",
              state: "done",
              outcome: "failure",
              failure: ["error"],
            },
          ],
        },
      }),
    });
    expect(saved).toHaveProperty("cliId", cli);
    await page.goto(app.url);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: cli, exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "LIFECYCLE_READY:");
    await sendLine(terminal, "first request");
    await app.terminalText(id, "LIFECYCLE_FAILED:1");
    const tab = page.locator(`[data-iori-tab-cli="${cli}"]`);
    await expect(
      tab.getByRole("img", { name: "Failed", exact: true }),
    ).toBeVisible();
    await sendLine(terminal, "next request");
    await app.terminalText(id, 'LIFECYCLE_REQUEST:"next request"');
    await app.terminalText(id, "LIFECYCLE_FAILED:2");
  },
);
