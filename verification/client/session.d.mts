import type { Page } from "@playwright/test";

export type RealClientPlatform = "windows" | "android";

export function startRealClient(
  platform: RealClientPlatform,
  options?: { updates?: boolean },
): Promise<{
  page: Page;
  back?: () => Promise<void>;
  background?: () => Promise<void>;
  resume?: () => Promise<void>;
  restartAfterUpdate?: (trigger: () => Promise<void>) => Promise<Page>;
  close(): Promise<void>;
}>;

export function waitForClientReady(page: Page): Promise<void>;

export function prepareRealClientPage(
  page: Page,
  options?: { language?: string },
): Promise<void>;
