import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import type { TestOptions } from "./fixtures/test.ts";

process.env.IORI_UI_RUN ??= `run-${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`;
const evidence = resolve(".local/evidence/ui", process.env.IORI_UI_RUN);
const requestedRealClient =
  Boolean(process.env.IORI_UI_CLIENT_PROJECT) ||
  process.argv.some(
    (arg) => arg.includes("windows-client") || arg.includes("android-client"),
  );
const requestedWorkers = process.env.IORI_PLAYWRIGHT_WORKERS ?? "";
const workerCount = Number(requestedWorkers);
const browserWorkers =
  /^\d+$/.test(requestedWorkers) &&
  Number.isSafeInteger(workerCount) &&
  workerCount > 0
    ? workerCount
    : 4;
export default defineConfig<TestOptions>({
  testDir: ".",
  globalSetup: "./fixtures/global-setup.ts",
  fullyParallel: !requestedRealClient,
  workers: requestedRealClient ? 1 : browserWorkers,
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
      grepInvert: /@windows-only/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      grep: /@phone/,
      grepInvert: /@android-only/,
      use: { ...devices["Pixel 7"] },
    },
    ...(requestedRealClient
      ? [
          {
            name: "windows-client",
            grep: /@desktop/,
            grepInvert: /@web-only/,
            use: { clientPlatform: "windows" as const },
          },
          {
            name: "android-client",
            grep: /@phone/,
            grepInvert: /@web-only/,
            use: { clientPlatform: "android" as const },
          },
        ]
      : []),
  ],
});
