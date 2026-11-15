import { test, expect } from "./fixtures/test.ts";

test.use({ clientUpdates: true });

test(
  "旧版から自己更新して再起動後もHostとチームの下書きを保つ",
  { tag: ["@desktop", "@windows-only"] },
  async ({ page, registeredApp: app }) => {
    test.slow();

    await app.open(page);

    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "New team", exact: true }).click();
    const newTeamDialog = page.getByRole("dialog", {
      name: "New team",
      exact: true,
    });
    await newTeamDialog
      .getByRole("option", { name: "Development", exact: true })
      .click();
    await newTeamDialog
      .getByRole("button", { name: "Create", exact: true })
      .click();
    const teamName = page.getByRole("textbox", { name: "Name", exact: true });
    const draftName = "更新後にも残す下書き";
    await teamName.fill(draftName);
    await expect(teamName).toHaveValue(draftName);
    await expect(
      page.locator("[data-iori-team-name]", { hasText: draftName }),
    ).toBeVisible();

    await app.updates.publish();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-general"]').click();
    const updates = page.locator('[data-iori-view="client-update"]');
    await updates
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(
      updates.locator('[data-iori-state="update-version"]'),
    ).toHaveText(app.clientReleaseVersion!);
    await expect(
      updates.getByRole("checkbox", {
        name: "Also update connected iori Hosts (1)",
        exact: true,
      }),
    ).toBeChecked();
    const installButton = updates.getByRole("button", {
      name: "Restart to update",
      exact: true,
    });
    await expect(installButton).toBeEnabled({ timeout: 30_000 });

    const restartedPage = await app.updates.restart(page, () =>
      installButton.click(),
    );

    const hostUpdatesDialog = restartedPage.getByRole("dialog", {
      name: "Update iori Host",
      exact: true,
    });
    await expect(hostUpdatesDialog).toBeVisible({ timeout: 30_000 });
    await expect(
      hostUpdatesDialog.locator(`[data-iori-update-host="${app.hostKey}"]`),
    ).toHaveCount(1);
    await hostUpdatesDialog
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(hostUpdatesDialog).toBeHidden();

    await expect(
      restartedPage.locator(
        `[data-iori-host-key="${app.hostKey}"] .nav-host-name`,
      ),
    ).toHaveText(app.hostName);

    await restartedPage
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await restartedPage.getByRole("button", { name: draftName }).click();
    await restartedPage
      .getByRole("button", { name: "Team overview", exact: true })
      .click();
    await expect(
      restartedPage.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue(draftName);

    await restartedPage
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await restartedPage
      .locator('[data-iori-action="settings-general"]')
      .click();
    await expect(
      restartedPage.locator(
        '[data-iori-view="client-update"] .update-current-controls > span',
      ),
    ).toHaveText(app.clientReleaseVersion!);
  },
);
