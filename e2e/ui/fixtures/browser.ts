import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CliNotification } from "../../../packages/protocol/src/index.ts";

/** Observe the development native boundary; no OS notification is displayed. */
export async function notificationRequests(page: Page) {
  const requests: CliNotification[] = [];
  await page.exposeBinding(
    "ioriObserveNotification",
    (_source, notification) => {
      requests.push(notification as CliNotification);
    },
  );
  await page.addInitScript(() => {
    window.addEventListener("iori:notification-request", (event) => {
      void (
        window as unknown as {
          ioriObserveNotification(value: unknown): Promise<void>;
        }
      ).ioriObserveNotification((event as CustomEvent).detail);
    });
  });
  return {
    async expectRequests(expected: Partial<CliNotification>[]) {
      await expect.poll(() => requests).toMatchObject(expected);
      expect(requests).toHaveLength(expected.length);
    },
  };
}

/** Supply the OS file picker boundary, retaining the Client's real save calls. */
export async function chooseSaveDestination(page: Page, path: string) {
  let completed = false;
  await page.exposeBinding("ioriSaveFile", async (_source, bytes: number[]) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(bytes));
    completed = true;
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", {
      value: async () => ({
        createWritable: async () => {
          const chunks: BlobPart[] = [];
          return {
            write: async (bytes: Uint8Array) => {
              chunks.push(new Uint8Array(bytes));
            },
            close: async () => {
              const bytes = await new Blob(chunks).arrayBuffer();
              await (
                window as unknown as {
                  ioriSaveFile(bytes: number[]): Promise<void>;
                }
              ).ioriSaveFile(Array.from(new Uint8Array(bytes)));
            },
            abort: async () => {},
          };
        },
      }),
    });
  });
  return {
    async contents() {
      await expect.poll(() => completed).toBe(true);
      return readFile(path);
    },
  };
}

export async function putClipboardImage(page: Page, png: Buffer) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async (bytes) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      }),
    ]);
  }, Array.from(png));
}

async function touchTarget(target: Locator) {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

export async function swipeToEarlierOutput(target: Locator) {
  const box = await touchTarget(target);
  const page = target.page();
  const session = await page.context().newCDPSession(page);
  try {
    const x = box.x + box.width / 2;
    const start = box.y + box.height / 4;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y: start }],
    });
    for (let step = 1; step <= 12; step++) {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: start + ((box.height / 2) * step) / 12 }],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

export async function longPress(target: Locator) {
  const box = await touchTarget(target);
  const page = target.page();
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    // Sortable rows open on release; other rows open their menu while held.
    await expect(
      page.locator('[data-sidebar-sorting="true"], [role="menu"]'),
    ).not.toHaveCount(0);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}
