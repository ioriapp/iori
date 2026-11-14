import { openPath } from "./fixtures/journeys.ts";
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
    const candidate = {
      id: "scripted",
      cli: childCli,
      model: "",
      tools: [],
      minimum: "",
    };
    const { saved } = await app.request("teams.create", {
      definition: {
        name: "Approval team",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent", cli: app.cliId },
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "",
            limit: "",
            reuse: true,
            split: false,
            instruction: "",
            request: "",
            report: "",
            candidates: { high: [], medium: [candidate], low: [] },
          },
        ],
      },
    });
    await app.request("teams.settings", {
      enabled: true,
      defaultTeam: saved.id,
      limits: {},
    });
    await page.goto(app.url);
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
    await page.goto(app.url);
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
