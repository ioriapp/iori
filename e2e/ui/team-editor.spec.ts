import { randomUUID } from "node:crypto";
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
      await page
        .getByRole("button", { name: "Orchestrator", exact: true })
        .click();
    };
    await app.open(page);
    await openParentSettings();

    const parentInput = page.getByRole("switch", {
      name: "Allow orchestrator input to children",
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
    await app.open(page);
    await openFolder(page, app);
    await page.locator('[data-iori-action="open-agents-teams"]').click();
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
    await page
      .getByRole("button", { name: "Orchestrator", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", {
        name: `CLI and model: ${app.cliId} › Default`,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Worker", exact: true }).click();
    await expect(
      page.getByText(
        `No candidates. Runs with the orchestrator's settings (${app.cliId} › Default).`,
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

test(
  "ロール候補の残量の下限で対象の利用枠を選択して保存し再読み込み後も保持される",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    const uploadId = randomUUID();
    const script = `console.log(JSON.stringify({
      windows: [
        { remaining: 20, minutes: 300 },
        { remaining: 80, minutes: 10080 }
      ]
    }));`;
    await app.request("cli.definition.file.write", {
      uploadId,
      first: true,
      data: Buffer.from(script).toString("base64"),
    });
    await app.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "usage-window-cli",
        name: "Usage window CLI",
        command: { shell: "node --version" },
        usage: { script: "usage.mjs" },
      }),
      files: [{ name: "usage.mjs", uploadId }],
    });
    await createTeam(app, {
      name: "Window minimum team",
      roles: [{ name: "Worker" }],
      makeDefault: false,
    });
    const openWorker = async () => {
      await page
        .getByRole("button", { name: "AI Agents/Teams", exact: true })
        .click();
      await page.getByRole("button", { name: "Teams", exact: true }).click();
      await page
        .getByRole("button", { name: /Window minimum team Version/ })
        .click();
      await page.getByRole("button", { name: "Worker", exact: true }).click();
    };
    await app.open(page);
    await openWorker();

    await page
      .getByRole("button", { name: "Add candidate", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Usage window CLI › Default", exact: true })
      .click();

    const minimumInput = page.getByRole("spinbutton", {
      name: "Minimum remaining 2",
      exact: true,
    });
    const windowPicker = page.getByRole("button", {
      name: "Usage window 2",
      exact: true,
    });
    const warning = page.getByText(
      "This candidate is currently below the minimum remaining usage and will not be assigned.",
      { exact: true },
    );

    await expect(windowPicker).toBeVisible();
    await expect(windowPicker).toHaveText("Auto");

    await minimumInput.fill("50");
    await expect(warning).toBeVisible();

    await windowPicker.click();
    await page.getByRole("menuitemradio", { name: "7d", exact: true }).click();
    await expect(windowPicker).toHaveText("7d");
    await expect(warning).toHaveCount(0);

    const save = page.getByRole("button", { name: "Save", exact: true });
    await save.click();
    await expect(save).toBeDisabled();

    await page.reload();
    await openWorker();
    await expect(windowPicker).toHaveText("7d");
    await expect(warning).toHaveCount(0);

    await minimumInput.fill("90");
    await expect(warning).toBeVisible();
  },
);
