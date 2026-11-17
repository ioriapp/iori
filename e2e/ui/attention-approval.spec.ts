import { createTeam, openPath } from "./fixtures/journeys.ts";
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

test(
  "子の承認待ちをAttentionから開いて回答する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const childCli = "approval-actor";
    const script = fileURLToPath(
      new URL("../../verification/host/lifecycle-cli.mjs", import.meta.url),
    );
    const savedCli = await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: childCli,
        name: childCli,
        command: {
          shell: `'${process.execPath}' '${script}' --action approval`,
        },
        hooks: {
          format: "claude-settings",
          file: join(app.folder, "approval-settings.json"),
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
    expect(savedCli).toHaveProperty("cliId", childCli);
    await createTeam(app, {
      name: "Approval team",
      roles: [{ name: "Worker", candidate: { cli: childCli } }],
    });
    await app.open(page);
    await openFolder(page, app);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approval team", exact: true })
      .click();
    const parent = await terminalId(visibleTerminal(page));
    await app.terminalText(parent, "ACTOR_PROMPT:");
    await sendLine(
      visibleTerminal(page),
      JSON.stringify({
        id: "delegate",
        command: [
          "delegate",
          "--role",
          "Worker",
          "--difficulty",
          "medium",
          "--title",
          "Approval task",
          "--worktree",
          "parent",
          "--body",
          "Request approval.",
        ],
      }),
    );
    const row = page
      .locator("[data-iori-child-id]")
      .filter({ hasText: "Approval task" });
    await expect(row).toBeVisible();
    const attention = page.locator('[data-iori-action="attention-open"]');
    await expect(attention).toBeEnabled();
    await attention.click();
    const terminal = visibleTerminal(page);
    const child = await terminalId(terminal);
    expect(child).not.toBe(parent);
    await app.terminalText(child, "LIFECYCLE_APPROVAL");
    await sendLine(terminal, "yes");
    await app.terminalText(child, 'LIFECYCLE_REQUEST:"yes"');
    await app.terminalText(child, "LIFECYCLE_DONE:");
    await expect(attention).toBeDisabled();
  },
);

test(
  "別のHostの承認待ちをAttentionから開いて回答する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const host = await app.addHost();
    await app.registerHost(host);
    const cli = "remote-approval";
    const script = fileURLToPath(
      new URL("../../verification/host/lifecycle-cli.mjs", import.meta.url),
    );
    await host.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: cli,
        name: cli,
        command: {
          shell: `'${process.execPath}' '${script}' --action approval`,
        },
        hooks: {
          format: "claude-settings",
          file: join(host.folder, "approval-settings.json"),
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
    await app.open(page);
    await openPath(page, host.folder, host.hostKey);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: cli, exact: true })
      .click();
    const terminal = visibleTerminal(page);
    const id = await terminalId(terminal);
    await app.terminalText(id, "LIFECYCLE_READY:");
    await sendLine(terminal, "request");
    await app.terminalText(id, "LIFECYCLE_APPROVAL");
    await openPath(page, app.folder, app.hostKey);
    const attention = page.locator('[data-iori-action="attention-open"]');
    await expect(attention).toBeEnabled();
    await attention.click();
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-terminal-id",
      id,
    );
    await expect(visibleTerminal(page)).toHaveAttribute(
      "data-iori-host-key",
      host.hostKey,
    );
    await sendLine(visibleTerminal(page), "yes");
    await app.terminalText(id, 'LIFECYCLE_REQUEST:"yes"');
    await app.terminalText(id, "LIFECYCLE_DONE:");
    await expect(attention).toBeDisabled();
  },
);

test(
  "スマホの承認行から送信の失敗を再試行して回答する",
  { tag: "@phone" },
  async ({ page, registeredApp: app }) => {
    // AC-06: the mobile approval action reaches the Host without opening the CLI.
    const script = fileURLToPath(
      new URL("../host/fixtures/approval-cli.mjs", import.meta.url),
    );
    await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "claude",
        name: "claude",
        command: { shell: `'${process.execPath}' '${script}' claude` },
      }),
    });
    await app.open(page);
    await openFolder(page, app, true);
    await page.getByRole("button", { name: "New tab", exact: true }).tap();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "claude", exact: true })
      .tap();
    const id = await terminalId(visibleTerminal(page));
    await app.terminalText(id, "APPROVAL_READY");
    await app.input(
      id,
      JSON.stringify({ id: "inline", command: "echo approval" }) + "\r",
    );
    await page.getByRole("button", { name: "Open sidebar", exact: true }).tap();
    await page.getByRole("button", { name: "Home", exact: true }).tap();
    const home = page.locator('[data-iori-view="mobile-home"]');
    const row = home.locator(`[data-iori-attention-terminal="${id}"]`);
    const allow = row.getByRole("button", { name: "Allow", exact: true });
    const deny = row.getByRole("button", { name: "Deny", exact: true });
    await expect(allow).toBeVisible();
    await app.faults.fail("terminal.approval.respond");
    await allow.tap();
    await expect(row.getByRole("alert")).toHaveText(
      "Could not send. Check the connection and try again.",
    );
    await expect(allow).toBeEnabled();
    await expect(deny).toBeEnabled();
    await app.faults.hold("terminal.approval.respond");
    await allow.tap();
    await expect(allow).toHaveAttribute("aria-busy", "true");
    await expect(deny).toBeDisabled();
    await expect(row.getByRole("alert")).toHaveCount(0);
    await app.faults.clear();
    await expect(row).toHaveCount(0);
    await expect(home).toBeVisible();
  },
);
