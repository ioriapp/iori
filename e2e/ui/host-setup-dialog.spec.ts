import type { Page } from "@playwright/test";
import { test, expect, type App } from "./fixtures/test.ts";

// Supply desktop setup replies at the browser-to-native bridge boundary.
async function localHostStatus(
  page: Page,
  app: App,
  status: () => Record<string, unknown>,
) {
  const url = new URL(app.url).searchParams.get("iori-bridge")!;
  await page.routeWebSocket(url, (socket) => {
    const bridge = socket.connectToServer();
    let initial: number;
    socket.onMessage((message) => {
      const { id, command } = JSON.parse(String(message)) as {
        id: number;
        command: string;
      };
      if (command === "native_host_setup_status")
        socket.send(JSON.stringify({ id, ...status() }));
      else if (command === "native_host_firewall_status")
        socket.send(JSON.stringify({ id, result: true }));
      else {
        if (command === "native_initial_state") initial = id;
        bridge.send(message);
      }
    });
    bridge.onMessage((message) => {
      const response = JSON.parse(String(message)) as {
        id?: number;
        result?: Record<string, unknown>;
      };
      if (response.id === initial && response.result) {
        response.result.canSetupHost = true;
        socket.send(JSON.stringify(response));
      } else socket.send(message);
    });
  });
}

test(
  "Hostのセットアップをキャンセルして開き直すと現在の導入状態を表示する",
  { tag: "@desktop" },
  async ({ page, app }) => {
    let installed = false;
    await localHostStatus(page, app, () => ({
      result: { installed, canAllowConnections: false },
    }));
    await app.open(page);
    const setup = page.getByRole("button", {
      name: "Set up iori Host",
      exact: true,
    });
    const dialog = page.getByRole("dialog", { name: "Set up iori Host" });
    await setup.click();
    await expect(
      dialog.getByRole("button", { name: "Install", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();

    installed = true;
    await setup.click();
    await expect(
      dialog.getByRole("button", { name: "Register with this iori Host" }),
    ).toBeEnabled();
  },
);

test(
  "接続の設定でこのPCのHostの状態を読み込めなかったら再試行できる",
  { tag: "@desktop" },
  async ({ page, registeredApp: app }) => {
    let failed = true;
    await localHostStatus(page, app, () =>
      failed
        ? { error: "Local Host status unavailable" }
        : {
            result: {
              installed: true,
              canAllowConnections: true,
              host: { publicKey: app.hostKey },
            },
          },
    );
    await app.open(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Connection", exact: true }).click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Could not check iori Host on this PC." });
    await expect(alert).toBeVisible();

    failed = false;
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByText("Connections from other devices are allowed"),
    ).toBeVisible();
    await expect(alert).toBeHidden();
  },
);
