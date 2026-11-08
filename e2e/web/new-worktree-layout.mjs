import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { openSettingsSection, openSidebar } from "../connection/scenario.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import {
  openWorkspaceView,
  splitTab,
} from "../../verification/workspace/interaction.mjs";

export async function newWorktreeLayout({ client, repository, shot, record }) {
  const { screen } = client;
  const request = (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('Host request failed');return r.result;})()`,
    );
  const capture = async (state) => {
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark',${theme === "dark"})`,
      );
      await shot(`pc-${state}-${theme}`);
    }
  };
  const settings = () => openSettingsSection(screen, "settings-display");
  const closeSettings = async () => {
    await screen.key("Escape");
    await waitFor(
      async () => !(await screen.visible('[data-iori-view="settings"]')),
    );
  };
  await settings();
  assert.equal(
    await screen.attribute(
      '[data-iori-action="save-worktree-layout"]',
      "disabled",
    ),
    "",
  );
  await capture("layout-no-worktree");
  await closeSettings();
  await openFolder(screen, repository, false);
  await settings();
  await capture("layout-unsaved");
  await closeSettings();
  const originalTeams = await request("teams.list", {});
  const saved = await request("teams.create", {
    definition: {
      name: "配置確認チーム",
      description: "",
      parent: {
        id: "parent",
        cli: "pi",
        model: "gpt-6-luna",
        tools: [],
        minimum: "",
      },
      instruction: "",
      roles: [],
    },
  });
  await request("teams.settings", {
    enabled: true,
    defaultTeam: saved.saved.id,
    limits: originalTeams.limits,
  });
  const terminals = [];
  const create = async (name, team) => {
    await openSidebar(screen);
    await screen.click(
      `[data-iori-action="new-worktree"][data-iori-repository-path=${JSON.stringify(repository)}]`,
    );
    await screen.wait('[data-iori-view="worktree-create"]');
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-field="worktree-setup-command"]')?.disabled === false`,
      ),
    );
    await screen.input('[data-iori-field="worktree-name"]', name);
    await screen.click('[data-iori-field="worktree-launcher"]');
    await screen.click(
      `[data-iori-launch-choice=${JSON.stringify(team ? `team:${saved.saved.id}` : "cli:pi")}]`,
    );
    await screen.click('[data-iori-action="worktree-create"]');
    const cwd = `${repository}-${name}`;
    const terminal = await waitFor(async () =>
      (await request("terminal.list", {})).terminals.find(
        (item) => item.cwd === cwd,
      ),
    );
    terminals.push(terminal.id);
    await screen.wait(
      `button[data-iori-tab-id="terminal:${terminal.id}"][data-state="active"]`,
    );
    return terminal;
  };
  const tabs = () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('button[data-iori-tab-kind]'),tab=>({kind:tab.dataset.ioriTabKind,id:tab.dataset.ioriTabId,group:tab.closest('[data-iori-group-id]').dataset.ioriGroupId,x:tab.getBoundingClientRect().left}))`,
    );
  try {
    const source = await create("layout-source", true);
    // The template contains only Board at left and the parent at right.
    for (const kind of ["files", "git"])
      await screen.click(
        `[data-tab-kind="${kind}"] [data-iori-action="workspace-close-tab"]`,
      );
    await openWorkspaceView(screen, "board");
    await screen.click(`button[data-iori-tab-id="terminal:${source.id}"]`);
    await splitTab(
      screen,
      `button[data-iori-tab-id="terminal:${source.id}"]`,
      "right",
    );
    await screen.contextMenu(
      `button[data-iori-tab-id="terminal:${source.id}"]`,
    );
    await screen.wait('[data-iori-action="save-worktree-layout-menu"]');
    await capture("layout-tab-menu");
    await screen.click('[data-iori-action="save-worktree-layout-menu"]');
    await screen.wait('[data-iori-notice-key="new-worktree-default"]');
    await settings();
    await waitFor(() =>
      screen.evaluate(
        `!document.querySelector('[data-iori-action="reset-worktree-layout"]').disabled`,
      ),
    );
    await capture("layout-saved");
    await closeSettings();
    await create("layout-team", true);
    const teamTabs = await tabs();
    assert.deepEqual(teamTabs.map((tab) => tab.kind).sort(), [
      "board",
      "terminal",
    ]);
    assert.ok(
      teamTabs.find((tab) => tab.kind === "board").x <
        teamTabs.find((tab) => tab.kind === "terminal").x,
    );
    assert.equal(new Set(teamTabs.map((tab) => tab.group)).size, 2);
    await capture("layout-applied");
    await create("layout-cli", false);
    const cliTabs = await tabs();
    assert.deepEqual(
      cliTabs.map((tab) => tab.kind),
      ["terminal"],
    );
    assert.equal(new Set(cliTabs.map((tab) => tab.group)).size, 1);
    await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click("button[data-iori-shell-id]");
    const sourceShell = await waitFor(async () =>
      (await request("terminal.list", {})).terminals.find(
        (item) =>
          item.cwd === `${repository}-layout-cli` &&
          !terminals.includes(item.id),
      ),
    );
    terminals.push(sourceShell.id);
    await screen.wait(`button[data-iori-tab-id="terminal:${sourceShell.id}"]`);
    await screen.contextMenu(
      `button[data-iori-tab-id="terminal:${sourceShell.id}"]`,
    );
    await screen.click('[data-iori-action="save-worktree-layout-menu"]');
    await screen.wait('[data-iori-notice-key="new-worktree-default"]');
    const launched = await create("layout-shell", false);
    const restoredShell = await waitFor(async () =>
      (await request("terminal.list", {})).terminals.find(
        (item) =>
          item.cwd === `${repository}-layout-shell` && item.id !== launched.id,
      ),
    );
    terminals.push(restoredShell.id);
    await screen.wait(
      `button[data-iori-tab-id="terminal:${restoredShell.id}"]`,
    );
    assert.deepEqual((await tabs()).map((tab) => tab.kind).sort(), [
      "terminal",
      "terminal",
    ]);
    await settings();
    await screen.click('[data-iori-action="reset-worktree-layout"]');
    await waitFor(() =>
      screen.evaluate(
        `document.querySelector('[data-iori-action="reset-worktree-layout"]').disabled`,
      ),
    );
    await closeSettings();
    await create("layout-reset", false);
    assert.deepEqual(
      (await tabs()).map((tab) => tab.kind),
      ["terminal", "files", "git"],
    );
    await record(
      "Boardと親の左右配置を保存し、チームで復元、CLIのみなら幅を使用、設定で戻すとFiles・Gitの既定で開く",
    );
  } finally {
    for (const terminalId of terminals)
      await request("terminal.close", { terminalId, confirm: true });
    await request("teams.settings", {
      enabled: originalTeams.enabled,
      defaultTeam: originalTeams.defaultTeam,
      limits: originalTeams.limits,
    });
    await request("teams.delete", { teamId: saved.saved.id });
  }
}
