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
type Fixtures = { app: App; registeredApp: App; clientUpdates: boolean };

export const test = base.extend<Fixtures>({
  clientUpdates: [false, { option: true }],
  app: async ({ browser, clientUpdates }, use, info) => {
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
    const makeApp = (descriptor: Started): App => ({
      ...descriptor,
      host: makeHost(descriptor),
      request: (method, params) => call("request", { method, params }),
      register: () => call("register", { deviceId: descriptor.deviceId }),
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
      faults: {
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
      registerHost: (host) =>
        call("register", {
          hostId: host.id,
          deviceId: descriptor.deviceId,
          fresh: true,
        }),
      addDevice: async ({ register = true } = {}) => {
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
      setOffline: (value) =>
        call("offline", { deviceId: descriptor.deviceId, value }),
      files: (files) => call("files", { files }),
      updates: {
        publish: () => call("updates", { action: "publish" }),
        failDownload: () => call("updates", { action: "failDownload" }),
      },
    });
    const started = performance.now();
    let bodyStarted: number | undefined;
    try {
      const app = await call<Started>("start", { updates: clientUpdates });
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
  registeredApp: async ({ app }, use, info) => {
    const started = performance.now();
    await app.register();
    info.annotations.push({
      type: "registrationMs",
      description: String(performance.now() - started),
    });
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
