import { test, expect } from "./fixtures/test.ts";

test.use({ clientUpdates: true });

test(
  "Client更新の確認と進行と失敗を表示し設定を保持する",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-general"]').click();
    const updates = page.locator('[data-iori-view="client-update"]');
    await updates
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(updates.getByRole("alert")).toBeVisible();
    await app.updates.publish();
    await updates
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(
      updates.locator('[data-iori-state="update-version"]'),
    ).toHaveText(app.clientReleaseVersion!);
    const development = page.locator(
      '[data-iori-action="receive-development-versions"]',
    );
    await development.click();
    await expect(development).toBeChecked();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-general"]').click();
    await expect(development).toBeChecked();
    await updates
      .getByRole("button", { name: "Restart to update", exact: true })
      .click();
    await expect(
      updates.getByRole("button", { name: "Downloading update", exact: true }),
    ).toBeDisabled();
    await app.updates.failDownload();
    await expect(updates.getByRole("alert")).toBeVisible();
    await expect(
      updates.getByRole("button", {
        name: "Restart to update",
        exact: true,
      }),
    ).toBeEnabled();
  },
);

test(
  "Androidの更新は確認画面を開き直せる時だけインストールを続けるボタンを表示する",
  { tag: ["@phone", "@web-only"] },
  async ({ page, registeredApp: app }) => {
    // Replace only Android's native installer at the browser bridge.
    let confirmation: (available: boolean) => void;
    await page.routeWebSocket(
      new URL(app.url).searchParams.get("iori-bridge")!,
      (route) => {
        const server = route.connectToServer();
        let optionsId: number;
        confirmation = (available) =>
          route.send(
            JSON.stringify({
              event: "native://update-confirmation",
              payload: available,
            }),
          );
        route.onMessage((data) => {
          const { id, command } = JSON.parse(String(data)) as {
            id: number;
            command: string;
          };
          if (command === "native_update_options") optionsId = id;
          if (command === "native_update_download")
            route.send(JSON.stringify({ id }));
          // Android's installation command remains pending while the
          // PackageInstaller confirmation is open.
          else if (command === "native_update_install") return;
          else if (command === "native_update_resume_installation") {
            confirmation(false);
            route.send(JSON.stringify({ id }));
          } else server.send(data);
        });
        server.onMessage((data) => {
          const response = JSON.parse(String(data)) as {
            id?: number;
            result?: Record<string, unknown>;
          };
          if (response.id === optionsId && response.result) {
            response.result.restartsAfterInstall = false;
            response.result.foregroundOnly = true;
            route.send(JSON.stringify(response));
          } else route.send(data);
        });
      },
    );

    await app.updates.publish();
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-general"]').click();
    const updates = page.locator('[data-iori-view="client-update"]');
    await updates
      .getByRole("button", { name: "Download and install", exact: true })
      .click();
    const installing = updates.getByRole("button", {
      name: "Installing update",
      exact: true,
    });
    const resume = updates.getByRole("button", {
      name: "Continue installation",
      exact: true,
    });
    await expect(installing).toBeDisabled();
    await expect(resume).toBeHidden();

    confirmation!(true);
    await expect(resume).toBeEnabled();
    await expect(installing).toBeHidden();

    await resume.click();
    await expect(installing).toBeDisabled();
    await expect(resume).toBeHidden();
  },
);
