import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

process.env.IORI_UI_RUN ??= `run-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`;
const evidence = resolve(".local/evidence/ui", process.env.IORI_UI_RUN);
export default defineConfig({
  testDir: ".",
  globalSetup: "./fixtures/global-setup.ts",
  fullyParallel: true,
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  outputDir: resolve(evidence, "artifacts"),
  reporter: [
    ["list"],
    ["json", { outputFile: resolve(evidence, "results.json") }],
    ["html", { outputFolder: resolve(evidence, "report"), open: "never" }],
  ],
  use: {
    locale: "en-US",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      grep: /@desktop/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    { name: "phone", grep: /@phone/, use: { ...devices["Pixel 7"] } },
  ],
});
