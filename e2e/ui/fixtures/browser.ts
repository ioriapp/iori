import { createECDH, randomBytes } from "node:crypto";
import type { App } from "./test.ts";
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

/** Observe the native file manager request, without opening an OS window. */
export async function fileManagerReveals(page: Page) {
  type Reveal = { path: string; openDirectory: boolean };
  const requests: Reveal[] = [];
  await page.exposeBinding(
    "ioriObserveFileManagerReveal",
    (_source, reveal) => {
      requests.push(reveal as Reveal);
    },
  );
  await page.addInitScript(() => {
    window.addEventListener("iori:reveal-in-file-manager", (event) => {
      void (
        window as unknown as {
          ioriObserveFileManagerReveal(value: unknown): Promise<void>;
        }
      ).ioriObserveFileManagerReveal((event as CustomEvent).detail);
    });
  });
  return {
    async expectRequests(expected: Reveal[]) {
      await expect.poll(() => requests).toEqual(expected);
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

// Androidだけを通信の中継で再現し、本物のHostからの応答を記録する。
export async function unifiedPushAndroid(page: Page, app: App) {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const subscription = {
    endpoint: "https://push.example.test/iori",
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  const received: { params: unknown; response: unknown }[] = [];
  let foreground: ((value: boolean) => void) | undefined;
  let disconnects = 0;
  let saved: { distributor?: string; subscription?: typeof subscription } = {};
  await page.routeWebSocket(
    new URL(app.url).searchParams.get("iori-bridge")!,
    (route) => {
      foreground = (value) =>
        route.send(
          JSON.stringify({
            event: "native://foreground",
            payload: { foreground: value },
          }),
        );
      const server = route.connectToServer();
      const requests = new Map<number, unknown>();
      route.onMessage((data) => {
        const request = JSON.parse(String(data)) as {
          id: number;
          command: string;
          args: { distributor?: string; json?: string };
        };
        const respond = (result?: unknown) =>
          route.send(JSON.stringify({ id: request.id, result }));
        if (request.command === "native_disconnect") disconnects++;
        if (request.command === "native_unifiedpush_distributors")
          return respond([{ id: "io.heckel.ntfy", name: "ntfy" }]);
        if (request.command === "native_unifiedpush_state")
          return respond(saved);
        if (request.command === "native_unifiedpush_register") {
          saved = { distributor: request.args.distributor, subscription };
          respond();
          route.send(
            JSON.stringify({
              event: "native://unifiedpush",
              payload: { kind: "endpoint", subscription },
            }),
          );
          return;
        }
        if (request.command === "native_unifiedpush_unregister") {
          saved = {};
          return respond();
        }
        if (request.command === "native_request" && request.args.json) {
          const message = JSON.parse(request.args.json) as {
            method: string;
            params: unknown;
          };
          if (message.method === "notifications.push.set")
            requests.set(request.id, message.params);
        }
        server.send(data);
      });
      server.onMessage((data) => {
        const response = JSON.parse(String(data)) as {
          id?: number;
          result?: string;
        };
        if (response.id !== undefined && requests.has(response.id)) {
          received.push({
            params: requests.get(response.id),
            response: JSON.parse(response.result!),
          });
          requests.delete(response.id);
        }
        route.send(data);
      });
    },
  );
  return {
    background() {
      foreground?.(false);
    },
    async expectDisconnected() {
      await expect.poll(() => disconnects).toBeGreaterThan(0);
    },
    async expectRegistrationFailure() {
      await expect
        .poll(() => received)
        .toContainEqual({
          params: { subscription, language: "en", waiting: true, done: true },
          response: expect.objectContaining({ ok: false }),
        });
    },
    async expectUnregistered() {
      await expect.poll(() => app.pushSettings()).toEqual([]);
    },
    async expectRegistered() {
      await expect
        .poll(() => received)
        .toContainEqual({
          params: { subscription, language: "en", waiting: true, done: true },
          response: expect.objectContaining({ ok: true }),
        });
      await expect
        .poll(() => app.pushSettings())
        .toContainEqual({
          subscription,
          language: "en",
          waiting: true,
          done: true,
        });
    },
  };
}
