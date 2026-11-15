import {
  test as base,
  expect,
  type Page,
  type Locator,
  type BrowserContext,
} from "@playwright/test";
import { fork } from "node:child_process";
import type {
  RequestMethod,
  RequestParamsByMethod,
  ResultByMethod,
} from "../../../packages/protocol/src/index.ts";
import {
  prepareRealClientPage,
  startRealClient,
} from "../../../verification/client/session.mjs";

export type ClientPlatform = "web" | "windows" | "android";
export type TestOptions = {
  clientUpdates: boolean;
  clientPlatform: ClientPlatform;
};

type Started = {
  id: number;
  deviceId: number;
  url: string;
  folder: string;
  cliId: string;
  hostMs: number;
  hostKey: string;
  hostName: string;
  inviteText: string;
  updateVersion?: string;
  clientReleaseVersion?: string;
};
type RequestHost = <M extends RequestMethod>(
  method: M,
  params: RequestParamsByMethod[M],
) => Promise<ResultByMethod[M]>;
export type HostFixture = Omit<Started, "deviceId" | "url"> & {
  request: RequestHost;
  stop(options?: { stopDaemon?: boolean }): Promise<void>;
  start(): Promise<void>;
  restart(options?: { stopDaemon?: boolean }): Promise<void>;
  releaseAsset(): Promise<void>;
  forge(): Promise<{
    origin: string;
    repository: string;
    worktree: string;
    token: string;
  }>;
};
export type App = Started & {
  open(page: Page): Promise<void>;
  back(page: Page): Promise<void>;
  background(page: Page): Promise<void>;
  resume(page: Page): Promise<void>;
  request: RequestHost;
  input(terminalId: string, data: string): Promise<void>;
  register(): Promise<void>;
  terminalText(terminalId: string, expected: string | RegExp): Promise<string>;
  waitForTerminalResize(
    terminal: Locator,
    terminalId: string,
    previousCols: number,
    direction: number,
  ): Promise<number>;
  faults: {
    fail(method: string): Promise<void>;
    hold(method: string): Promise<void>;
    clear(): Promise<void>;
  };
  host: HostFixture;
  addHost(options?: { updates?: boolean }): Promise<HostFixture>;
  registerHost(host: HostFixture): Promise<void>;
  addDevice(options?: {
    register?: boolean;
  }): Promise<{ app: App; page: Page; context: BrowserContext }>;
  setOffline(value: boolean): Promise<void>;
  files(files: Record<string, string>): Promise<void>;
  updates: { publish(): Promise<void>; failDownload(): Promise<void> };
};
type Fixtures = {
  app: App;
  registeredApp: App;
  clientUpdates: boolean;
  clientPlatform: ClientPlatform;
};

const queuedUiRegistration = new WeakSet<App>();
const realClients = new WeakMap<
  Page,
  Awaited<ReturnType<typeof startRealClient>>
>();

async function registerRealClientThroughUi(
  page: Page,
  descriptor: Started,
  platform: Exclude<ClientPlatform, "web">,
) {
  await page
    .getByRole("textbox", { name: "Invitation", exact: true })
    .fill(descriptor.inviteText);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('[data-iori-value="host-name"]')).toHaveText(
    descriptor.hostName,
  );
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: platform === "android" ? "Open sidebar" : "Add folder",
      exact: true,
    }),
  ).toBeVisible();
}

export const test = base.extend<Fixtures>({
  clientUpdates: [false, { option: true }],
  clientPlatform: ["web", { option: true }],
  page: [
    async ({ page, clientPlatform }, use, info) => {
      if (clientPlatform === "web") {
        await use(page);
        return;
      }
      const launchStarted = performance.now();
      const client = await startRealClient(clientPlatform);
      realClients.set(client.page, client);
      info.annotations.push({
        type: "clientLaunchMs",
        description: String(performance.now() - launchStarted),
      });
      try {
        await use(client.page);
      } finally {
        realClients.delete(client.page);
        if (info.status !== info.expectedStatus) {
          const screenshot = await client.page
            .screenshot()
            .catch(() => undefined);
          if (screenshot) {
            await info.attach("real-client-failure", {
              body: screenshot,
              contentType: "image/png",
            });
          }
        }
        const closing = performance.now();
        await client.close();
        info.annotations.push({
          type: "clientCleanupMs",
          description: String(performance.now() - closing),
        });
      }
    },
    { scope: "test", timeout: 90_000 },
  ],
  app: async ({ browser, clientUpdates, clientPlatform }, use, info) => {
    const child = fork(new URL("./runtime.mjs", import.meta.url), [], {
      execArgv: [],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name !== "CLAUDECODE" && !name.startsWith("CLAUDE_CODE_"),
        ),
      ),
    });
    let next = 0;
    const contexts = new Set<BrowserContext>();
    const pending = new Map<
      number,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    child.on(
      "message",
      (message: { id: number; result?: unknown; error?: string }) => {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request?.reject(new Error(message.error));
        else request?.resolve(message.result);
      },
    );
    child.on("exit", (code) => {
      for (const request of pending.values())
        request.reject(new Error(`UI runtime exited (${code})`));
      pending.clear();
    });
    const call = <T>(method: string, params?: unknown): Promise<T> =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve: (value) => resolve(value as T), reject });
        child.send({ id, method, params });
      });
    const makeHost = (descriptor: Started): HostFixture => ({
      ...descriptor,
      request: (method, params) =>
        call("request", { hostId: descriptor.id, method, params }),
      stop: (options) =>
        call("hostControl", {
          hostId: descriptor.id,
          action: "stop",
          ...options,
        }),
      start: () =>
        call("hostControl", { hostId: descriptor.id, action: "start" }),
      restart: (options) =>
        call("hostControl", {
          hostId: descriptor.id,
          action: "restart",
          ...options,
        }),
      releaseAsset: () =>
        call("updates", { hostId: descriptor.id, action: "releaseAsset" }),
      forge: () => call("forge", { hostId: descriptor.id }),
    });
    const observe = async (
      sample: () => Promise<{ satisfied: boolean; output: string }>,
    ) => {
      await expect.poll(sample).toMatchObject({ satisfied: true });
    };
    const realClient = clientPlatform !== "web";
    const unsupported = (name: string) => () => {
      throw new Error(
        `${name} is not supported on real ${clientPlatform} client`,
      );
    };
    const makeApp = (descriptor: Started): App => {
      const instance: App = {
        ...descriptor,
        open: async (targetPage) => {
          if (clientPlatform === "web") {
            await targetPage.goto(descriptor.url);
            return;
          }
          await prepareRealClientPage(targetPage, { language: "en" });
          if (clientPlatform === "windows") {
            await targetPage
              .getByRole("button", {
                name: "Connect with an invitation",
                exact: true,
              })
              .click();
          }
          if (queuedUiRegistration.has(instance)) {
            queuedUiRegistration.delete(instance);
            const registrationStarted = performance.now();
            await registerRealClientThroughUi(
              targetPage,
              descriptor,
              clientPlatform,
            );
            info.annotations.push({
              type: "registrationMs",
              description: String(performance.now() - registrationStarted),
            });
          }
        },
        back: async (targetPage) => {
          const client = realClients.get(targetPage);
          if (client?.back) {
            await client.back();
            return;
          }
          await targetPage.keyboard.press("Alt+ArrowLeft");
        },
        background: async (targetPage) => {
          const client = realClients.get(targetPage);
          if (client?.background) {
            await client.background();
            return;
          }
          throw new Error(
            `app.background is not supported on ${clientPlatform} client`,
          );
        },
        resume: async (targetPage) => {
          const client = realClients.get(targetPage);
          if (client?.resume) {
            await client.resume();
            return;
          }
          throw new Error(
            `app.resume is not supported on ${clientPlatform} client`,
          );
        },
        host: makeHost(descriptor),
        request: (method, params) => call("request", { method, params }),
        register: realClient
          ? unsupported("app.register")
          : () => call("register", { deviceId: descriptor.deviceId }),
        input: (terminalId, data) => call("input", { terminalId, data }),
        terminalText: async (terminalId, expected) => {
          let text = "";
          const pattern =
            typeof expected === "string"
              ? new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              : expected;
          await observe(async () => {
            text = await call<string>("terminalText", {
              deviceId: descriptor.deviceId,
              terminalId,
            });
            return { satisfied: pattern.test(text), output: text };
          });
          return text;
        },
        waitForTerminalResize: async (
          terminal,
          terminalId,
          previousCols,
          direction,
        ) => {
          let attempt = 0,
            cols = previousCols;
          await observe(async () => {
            const marker = `IORI_SIZE_${++attempt}:`;
            await sendLine(terminal, `printf '${marker}'; /usr/bin/stty size`);
            const output = await call<string>("terminalText", {
              deviceId: descriptor.deviceId,
              terminalId,
            });
            const match = [
              ...output.matchAll(/IORI_SIZE_\d+:(\d+) (\d+)\r?\n/g),
            ].at(-1);
            if (match) cols = Number(match[2]);
            return { satisfied: (cols - previousCols) * direction > 0, output };
          });
          return cols;
        },
        faults: realClient
          ? {
              fail: unsupported("app.faults.fail"),
              hold: unsupported("app.faults.hold"),
              clear: unsupported("app.faults.clear"),
            }
          : {
              fail: (method) =>
                call("fault", {
                  deviceId: descriptor.deviceId,
                  action: "fail",
                  args: [method],
                }),
              hold: (method) =>
                call("fault", {
                  deviceId: descriptor.deviceId,
                  action: "hold",
                  args: [method],
                }),
              clear: () =>
                call("fault", {
                  deviceId: descriptor.deviceId,
                  action: "clear",
                  args: [],
                }),
            },
        addHost: async (options) =>
          makeHost(await call<Started>("addHost", options)),
        registerHost: realClient
          ? unsupported("app.registerHost")
          : (host) =>
              call("register", {
                hostId: host.id,
                deviceId: descriptor.deviceId,
                fresh: true,
              }),
        addDevice: realClient
          ? unsupported("app.addDevice")
          : async ({ register = true } = {}) => {
              const device = await call<{ deviceId: number; url: string }>(
                "addDevice",
              );
              if (register)
                await call("register", {
                  deviceId: device.deviceId,
                  fresh: true,
                  name: "Second UI device",
                });
              const context = await browser.newContext({
                viewport: { width: 1440, height: 900 },
                locale: "en-US",
              });
              contexts.add(context);
              return {
                app: makeApp({ ...descriptor, ...device }),
                context,
                page: await context.newPage(),
              };
            },
        setOffline: realClient
          ? unsupported("app.setOffline")
          : (value) =>
              call("offline", { deviceId: descriptor.deviceId, value }),
        files: (files) => call("files", { files }),
        updates: realClient
          ? {
              publish: unsupported("app.updates.publish"),
              failDownload: unsupported("app.updates.failDownload"),
            }
          : {
              publish: () => call("updates", { action: "publish" }),
              failDownload: () => call("updates", { action: "failDownload" }),
            },
      };
      return instance;
    };
    const started = performance.now();
    let bodyStarted: number | undefined;
    try {
      const app = await call<Started>("start", {
        updates: clientUpdates,
        realClient,
      });
      info.annotations.push(
        { type: "hostMs", description: String(app.hostMs) },
        { type: "setupMs", description: String(performance.now() - started) },
      );
      bodyStarted = performance.now();
      await use(makeApp(app));
    } finally {
      if (bodyStarted !== undefined) {
        const registrationMs = Number(
          info.annotations.find((a) => a.type === "registrationMs")
            ?.description ?? 0,
        );
        info.annotations.push({
          type: "bodyMs",
          description: String(performance.now() - bodyStarted - registrationMs),
        });
      }
      const closing = performance.now();
      for (const context of contexts) await context.close();
      await call("close");
      info.annotations.push({
        type: "cleanupMs",
        description: String(performance.now() - closing),
      });
    }
  },
  registeredApp: async ({ app, clientPlatform }, use, info) => {
    if (clientPlatform === "web") {
      const started = performance.now();
      await app.register();
      info.annotations.push({
        type: "registrationMs",
        description: String(performance.now() - started),
      });
    } else {
      queuedUiRegistration.add(app);
    }
    await use(app);
  },
});
export { expect };

export async function openFolder(page: Page, app: App, mobile = false) {
  if (mobile)
    await page
      .getByRole("button", { name: "Open sidebar", exact: true })
      .click();
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Folder path", exact: true })
    .fill(app.folder);
  await page.locator('[data-iori-action="folder-open"]').click();
  await expect(
    page.locator("[data-iori-current-worktree-path]"),
  ).toHaveAttribute("data-iori-current-worktree-path", app.folder);
}
export function visibleTerminal(page: Page) {
  return page.locator(
    '[data-iori-view="terminal"][data-iori-displayed="true"]',
  );
}
export async function terminalId(terminal: Locator) {
  await expect(terminal).toHaveAttribute("data-iori-terminal-id", /.+/);
  return (await terminal.getAttribute("data-iori-terminal-id"))!;
}
export async function sendLine(terminal: Locator, line: string) {
  // xterm's accessible input is supplied by xterm itself.
  const input = terminal.getByRole("textbox");
  await input.pressSequentially(line);
  await input.press("Enter");
}
