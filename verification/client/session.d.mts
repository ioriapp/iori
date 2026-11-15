import type { Page } from "@playwright/test";

export type RealClientPlatform = "windows" | "android";

export function startRealClient(platform: RealClientPlatform): Promise<{
  page: Page;
  back?: () => Promise<void>;
  background?: () => Promise<void>;
  resume?: () => Promise<void>;
  close(): Promise<void>;
}>;

export function waitForClientReady(page: Page): Promise<void>;

export function prepareRealClientPage(
  page: Page,
  options?: { language?: string },
): Promise<void>;
