import { expect } from "@playwright/test";

const launchers = {
  android: async () => (await import("./android.mjs")).startAndroidUiClient(),
  windows: async () => (await import("./windows.mjs")).startWindowsUiClient(),
};

export async function startRealClient(platform) {
  const launch = launchers[platform];
  if (!launch) {
    throw new Error(`未対応の Client platform です: ${platform}`);
  }
  const client = await launch();
  try {
    await waitForClientReady(client.page);
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export async function waitForClientReady(page) {
  await page.waitForFunction(
    () =>
      location.protocol !== "about:" &&
      document.readyState === "complete" &&
      Boolean(window.__TAURI__?.core?.invoke),
  );
}

export async function prepareRealClientPage(page, { language = "en" } = {}) {
  await waitForClientReady(page);
  await page.evaluate(
    async ({ lang }) => {
      const invoke = window.__TAURI__.core.invoke;
      const current = (await invoke("native_load_client_preferences")) ?? {};
      await invoke("native_save_client_preferences", {
        preferences: {
          ...current,
          language: lang,
        },
      });
    },
    { lang: language },
  );
  await page.reload();
  await waitForClientReady(page);
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    language.startsWith("ja") ? "ja" : "en",
  );
}
