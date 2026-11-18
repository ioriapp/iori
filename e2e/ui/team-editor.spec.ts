import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createTeam } from "./fixtures/journeys.ts";
import {
  test,
  expect,
  openFolder,
  visibleTerminal,
  terminalId,
} from "./fixtures/test.ts";

test(
  "チームを編集して保存し保存の競合を解決する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const saved = await createTeam(app, {
      name: "Editor team",
      roles: [],
      makeDefault: false,
    });
    await app.open(page);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Teams", exact: true }).click();
    await page.getByRole("button", { name: /Editor team Version/ }).click();
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Edited team");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await name.fill("My changes");
    const current = await app.request("teams.read", { teamId: saved.id });
    await app.request("teams.save", {
      teamId: saved.id,
      definition: { ...current.saved, name: "Other changes" },
      baseVersion: current.saved.version,
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "This team was changed on another device",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(name).toHaveValue("Other changes");
  },
);

test(
  "モデルの一覧が無い CLI を『既定』で候補に追加して保存する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const script = fileURLToPath(
      new URL("../../verification/host/scripted-cli.mjs", import.meta.url),
    );
    await app.request("cli.definition.simple", {
      simple: {
        name: "no-models-cli",
        command: `'${process.execPath}' '${script}'`,
        modelArgument: "",
        models: [],
      },
    });
    const saved = await createTeam(app, {
      name: "Default model team",
      roles: [{ name: "Worker" }],
      makeDefault: false,
    });
    await app.open(page);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Teams", exact: true }).click();
    await page
      .getByRole("button", { name: /Default model team Version/ })
      .click();
    await page.getByRole("button", { name: "Worker", exact: true }).click();
    await page
      .getByRole("button", { name: "Add candidate", exact: true })
      .click();
    await page
      .getByRole("option", { name: "no-models-cli › Default", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", {
        name: "CLI and model: no-models-cli › Default",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    const current = await app.request("teams.read", { teamId: saved.id });
    expect(
      current.saved.roles[0].candidates.medium.some(
        (candidate) =>
          candidate.cli === "no-models-cli" && candidate.model === "",
      ),
    ).toBe(true);
  },
);

test(
  "親の見守り設定を編集して保存し再表示で保たれる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const saved = await createTeam(app, {
      name: "Watch settings team",
      roles: [],
      makeDefault: false,
    });
    const openParentSettings = async () => {
      await page
        .getByRole("button", { name: "AI Agents/Teams", exact: true })
        .click();
      await page.getByRole("button", { name: "Teams", exact: true }).click();
      await page
        .getByRole("button", { name: /Watch settings team Version/ })
        .click();
      await page.getByRole("button", { name: "Parent", exact: true }).click();
    };
    await app.open(page);
    await openParentSettings();

    const parentInput = page.getByRole("switch", {
      name: "Allow parent input to children",
      exact: true,
    });
    const checkInterval = page.getByRole("switch", {
      name: "Check on working children",
      exact: true,
    });
    const backgroundReminder = page.getByRole("switch", {
      name: "Remind children waiting on background commands",
      exact: true,
    });
    const checkMinutes = page.getByRole("spinbutton", {
      name: "Check on working children: Interval in minutes",
      exact: true,
    });
    const save = page.getByRole("button", { name: "Save", exact: true });

    await expect(backgroundReminder).toBeChecked();
    await expect(
      page.getByRole("spinbutton", {
        name: "Remind children waiting on background commands: Interval in minutes",
        exact: true,
      }),
    ).toHaveValue("15");
    await expect(parentInput).not.toBeChecked();
    await expect(checkInterval).not.toBeChecked();

    await parentInput.click();
    await checkInterval.click();
    await expect(checkMinutes).toHaveValue("15");
    await save.click();
    await expect(save).toBeDisabled();

    const afterEnable = await app.request("teams.read", { teamId: saved.id });
    expect(afterEnable.saved.parentInput).toBe(true);
    expect(afterEnable.saved.checkMinutes).toBe(15);

    await page.reload();
    await openParentSettings();
    await expect(parentInput).toBeChecked();
    await expect(checkInterval).toBeChecked();
    await expect(checkMinutes).toHaveValue("15");

    await parentInput.click();
    await checkInterval.click();
    await backgroundReminder.click();
    await save.click();
    await expect(save).toBeDisabled();

    const afterDisable = await app.request("teams.read", { teamId: saved.id });
    expect("parentInput" in afterDisable.saved).toBe(false);
    expect("checkMinutes" in afterDisable.saved).toBe(false);
    expect(afterDisable.saved.backgroundWakeMinutes).toBe(0);
  },
);

// AC-14: テンプレートから作ったチームで親を設定し直さず会話を始められる。
test(
  "テンプレートの親に先頭のCLIが入り作成後すぐに会話を始められる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.request("cli.order.set", { order: [app.cliId] });
    await app.request("teams.settings", {
      enabled: true,
      defaultTeam: "",
      limits: {},
    });
    await app.open(page);
    await openFolder(page, app);
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Teams", exact: true }).click();
    await page
      .getByRole("button", { name: "New team", exact: true })
      .last()
      .click();
    const dialog = page.getByRole("dialog", { name: "New team", exact: true });
    await dialog
      .getByRole("option", { name: "Development", exact: true })
      .click();
    await expect(
      dialog.getByRole("combobox", {
        name: `CLI and model: ${app.cliId} › Default`,
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Parent", exact: true }).click();
    await expect(
      page.getByRole("combobox", {
        name: `CLI and model: ${app.cliId} › Default`,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Worker", exact: true }).click();
    await expect(
      page.getByText(
        `No candidates. Runs with the parent's settings (${app.cliId} › Default).`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Candidates are tried in this order.", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: basename(app.folder), exact: true })
      .click();
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Development/ })
      .click();
    const terminal = visibleTerminal(page);
    await expect(terminal).toBeVisible();
    await app.terminalText(await terminalId(terminal), "ACTOR_READY");
  },
);
