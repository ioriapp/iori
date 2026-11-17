import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch:
    process.env.IORI_DEMO_LAYOUT === "1" ? "layout.spec.ts" : "capture.spec.ts",
  globalSetup: "../../e2e/ui/fixtures/global-setup.ts",
  workers: 1,
  retries: 0,
  timeout: 0,
  outputDir: resolve(process.env.IORI_DEMO_OUTPUT!, "playwright"),
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: resolve(process.env.IORI_DEMO_OUTPUT!, "results.json") },
    ],
  ],
  use: {
    launchOptions: { args: ["--force-device-scale-factor=2"] },
    viewport: { width: 1920, height: 800 },
    deviceScaleFactor: 2,
    locale: "en-US",
    colorScheme: "dark",
  },
});
