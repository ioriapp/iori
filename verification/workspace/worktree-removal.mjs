import { local as verificationLocal } from "../native/local.mjs";
import assert from "node:assert/strict";
import { chromiumExecutable } from "../web/browser.mjs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { lockEntry } from "../native/locks.mjs";
import {
  gate,
  windows,
  ps,
  windowsBuildNode,
  windowsPnpm,
  prepareWindowsRuntime,
  cleanupWindowsRuntime,
  waitUntil,
} from "../native/remote.mjs";
import { writeWindows, windowsEnvironment } from "../connection/build.mjs";
import { createSourceArchive, windowsSourceMtimes } from "../native/source.mjs";
import { windowsCache } from "../native/cache.mjs";
import {
  stopOwnedWindowsProcesses,
  startWindowsProcess,
} from "../native/processes.mjs";
import { startHost } from "../connection/host.mjs";
import { inviteCli } from "../connection/cli.mjs";
import { startWeb } from "../web/dev.mjs";
import { ui, waitFor } from "../ui.mjs";
import { register, openSidebar } from "../../e2e/connection/scenario.mjs";
import { openFolder } from "../../e2e/workspace/scenario.mjs";
import {
  observe,
  create,
  typeTerminal,
  observed,
  say,
} from "../../e2e/terminal/scenario.mjs";

await lockEntry(import.meta.url);
gate();
const evidence = path.resolve(
  ".local/evidence/worktree-removal-windows",
  `run-${Date.now()}`,
);
await mkdir(evidence, { recursive: true });
const local = await mkdtemp(path.join(evidence, "source-"));
const root = `${verificationLocal.windows.home}\\iori-development\\worktree-removal-${process.pid}-${Date.now()}`;
const result = { passed: false, stage: "prepare", cleanup: false };
let allocated = false,
  runtime,
  host,
  invite,
  web,
  browser,
  page;
try {
  const archive = path.join(local, "source.tar");
  await createSourceArchive(
    fileURLToPath(new URL("../../", import.meta.url)),
    archive,
  );
  windows(`[IO.Directory]::CreateDirectory(${ps(root)}) | Out-Null`);
  allocated = true;
  await writeWindows(root + "\\source.tar", await readFile(archive));
  windows(
    `${windowsEnvironment}tar -mxf ${ps(root + "\\source.tar")} -C ${ps(root)};if($LASTEXITCODE -ne 0){throw 'extract failed'};Set-Location ${ps(root)};${windowsSourceMtimes}$env:CARGO_TARGET_DIR=${ps(windowsCache + "\\cargo-target")};$env:CARGO_BUILD_JOBS='2';& ${ps(windowsBuildNode)} ${ps(windowsPnpm)} install --frozen-lockfile --store-dir ${ps(windowsCache + "\\pnpm-store")};if($LASTEXITCODE -ne 0){throw 'install failed'};node verification/native/node-pty.mjs;if($LASTEXITCODE -ne 0){throw 'node-pty build failed'};& ${ps(windowsBuildNode)} ${ps(windowsPnpm)} --filter @iori/host build:native;if($LASTEXITCODE -ne 0){throw 'native build failed'}`,
  );
  const repository = root + "\\repository",
    worktree = root + "\\task";
  windows(
    `[IO.Directory]::CreateDirectory(${ps(repository)}) | Out-Null;git -C ${ps(repository)} init -q -b main;if($LASTEXITCODE -ne 0){throw 'init failed'};git -C ${ps(repository)} -c user.name=iori -c user.email=e2e@example.invalid commit -q --allow-empty -m initial;if($LASTEXITCODE -ne 0){throw 'commit failed'};git -C ${ps(repository)} worktree add -q -b task ${ps(worktree)};if($LASTEXITCODE -ne 0){throw 'worktree failed'}`,
  );
  runtime = prepareWindowsRuntime();
  host = await startHost("windows", root, "removal-data", {
    windowsPathEntries: [path.win32.dirname(windowsBuildNode)],
  });
  invite = await inviteCli("windows", root, host.dataHome);
  web = await startWeb({ storageRoot: path.join(local, "client"), port: 0 });
  const { chromium } = await import(
    pathToFileURL(
      process.env.IORI_PLAYWRIGHT_MODULE ??
        "/root/.pi/agent/npm/node_modules/playwright/index.mjs",
    )
  );
  const executablePath = await chromiumExecutable(chromium);
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: "ja-JP",
  });
  const cdp = await page.context().newCDPSession(page);
  const evaluate = (expression) => page.evaluate(expression);
  const client = {
    screen: ui(evaluate, {
      key: (key) => page.keyboard.press(key),
      evaluateAsync: evaluate,
    }),
    browser: {
      evaluate,
      evaluateAsync: evaluate,
      call: (method, params) => cdp.send(method, params),
    },
  };
  await page.goto(web.url);
  result.stage = "register";
  await register(
    client.screen,
    invite.invitation,
    "worktree removal verification",
  );
  result.stage = "close-settings";
  await client.screen.click('[data-iori-action="settings-close"]');
  result.stage = "open-folder";
  await openFolder(client.screen, repository, false);
  result.stage = "select-worktree";
  await client.screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await waitFor(
    () =>
      client.screen.attribute(
        "[data-iori-current-worktree-path]",
        "data-iori-current-worktree-path",
      ),
    (value) => value === worktree,
  );
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  result.stage = "start-terminal";
  const terminal = await create(client);
  const pidFile = root + "\\terminal.pid";
  result.stage = "terminal-command";
  await typeTerminal(
    client,
    `[IO.File]::WriteAllText('${pidFile}',[string]$PID);${say("windows", "REMOVAL_READY")}`,
  );
  await observed(client, "REMOVAL_READY");
  const pid = Number(windows(`Get-Content -LiteralPath ${ps(pidFile)} -Raw`));
  assert.ok(pid > 0);
  result.stage = "preview";
  await openSidebar(client.screen);
  await client.screen.contextMenu(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  await client.screen.click('[data-iori-action="worktree-delete"]');
  await client.screen.wait(
    '[data-iori-view="worktree-removal"] [data-slot="dialog-description"]',
  );
  await page.screenshot({
    path: path.join(evidence, "windows-host-delete.png"),
  });
  result.stage = "delete";
  await client.screen.click('[data-iori-action="worktree-removal-confirm"]');
  await waitFor(
    () => client.screen.visible('[data-iori-view="worktree-removal"]'),
    (value) => !value,
  );
  await waitUntil(
    () => windows(`Test-Path -LiteralPath ${ps(worktree)}`),
    (value) => value === "False",
  );
  await waitUntil(
    () =>
      windows(`@(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Count`),
    (value) => value === "0",
  );
  assert.equal(
    await client.screen.visible(`[data-iori-terminal-row="${terminal}"]`),
    false,
  );
  result.terminalStoppedAndFolderRemoved = true;
  result.stage = "prepare-open-file";
  const blocked = root + "\\blocked-task";
  const heldFile = blocked + "\\held.txt";
  const otherFile = blocked + "\\untouched.txt";
  const ready = root + "\\lock-ready";
  const lockScript = root + "\\hold-file.ps1";
  windows(
    `git -C ${ps(repository)} worktree add -q -b blocked-task ${ps(blocked)};if($LASTEXITCODE -ne 0){throw 'worktree failed'};[IO.File]::WriteAllText(${ps(heldFile)},'held');[IO.File]::WriteAllText(${ps(otherFile)},'untouched')`,
  );
  await writeWindows(
    lockScript,
    Buffer.from(
      `$stream=[IO.File]::Open(${ps(heldFile)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[IO.File]::WriteAllText(${ps(ready)},'ready');while($true){Start-Sleep -Seconds 1}}finally{$stream.Dispose()}`,
    ),
  );
  const holder = startWindowsProcess(
    `pwsh -NoProfile -ExecutionPolicy Bypass -File "${lockScript}"`,
  );
  assert.ok(holder > 0);
  await waitUntil(
    () => windows(`Test-Path -LiteralPath ${ps(ready)}`),
    (value) => value === "True",
  );
  result.stage = "open-file-preview";
  await openSidebar(client.screen);
  await client.screen.contextMenu(
    `button[data-iori-worktree-path=${JSON.stringify(blocked)}]`,
  );
  await client.screen.click('[data-iori-action="worktree-delete"]');
  await client.screen.wait(
    '[data-iori-view="worktree-removal"] [data-slot="dialog-description"]',
  );
  result.stage = "open-file-delete";
  await client.screen.click('[data-iori-action="worktree-removal-confirm"]');
  await client.screen.wait('[data-iori-removal-failure="true"]');
  assert.equal(
    await client.screen.visible('[data-iori-view="worktree-removal"]'),
    false,
  );
  assert.match(
    await client.screen.text('[data-iori-removal-failure="true"]'),
    /ファイルを開いているプログラム|A program has files open/u,
  );
  assert.equal(windows(`[IO.File]::ReadAllText(${ps(heldFile)})`), "held");
  assert.equal(
    windows(`[IO.File]::ReadAllText(${ps(otherFile)})`),
    "untouched",
  );
  assert.equal(
    windows(`Test-Path -LiteralPath ${ps(blocked + "\\.git")}`),
    "True",
  );
  assert.ok(
    windows(`git -C ${ps(repository)} worktree list --porcelain`).includes(
      "blocked-task",
    ),
  );
  await page.screenshot({
    path: path.join(evidence, "windows-open-file-refused.png"),
  });
  windows(`Stop-Process -Id ${holder} -Force`);
  result.openFileRefusedWithoutRemoval = true;
  result.stage = "open-file-retry";
  await waitUntil(
    () =>
      windows(
        `@(Get-Process -Id ${holder} -ErrorAction SilentlyContinue).Count`,
      ),
    (value) => value === "0",
  );
  await client.screen.click('[data-iori-action="worktree-removal-retry"]');
  await client.screen.wait('[data-iori-action="worktree-removal-confirm"]');
  await client.screen.click('[data-iori-action="worktree-removal-confirm"]');
  await waitFor(
    () => client.screen.visible('[data-iori-view="worktree-removal"]'),
    (value) => !value,
  );
  await waitUntil(
    () => windows(`Test-Path -LiteralPath ${ps(blocked)}`),
    (value) => value === "False",
  );
  result.openFileReleasedAndRemoved = true;
  result.passed = true;
  result.stage = "complete";
} catch (error) {
  result.error = error.message;
  result.stack = error.stack;
  if (page && !["prepare", "register"].includes(result.stage))
    await page
      .screenshot({ path: path.join(evidence, "failure.png") })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  const failures = [];
  for (const [name, close] of [
    ["browser", () => browser?.close()],
    ["web", () => web?.close()],
    ["invite", () => invite?.stop()],
    ["host", () => host?.stop()],
    [
      "processes",
      () => {
        if (allocated) stopOwnedWindowsProcesses(root);
      },
    ],
    [
      "remote folder",
      () => {
        if (allocated)
          windows(
            `if(Test-Path -LiteralPath ${ps(root)}){cmd /c ('rd /s /q "'+${ps("\\\\?\\" + root)}+'"')}`,
          );
      },
    ],
    [
      "runtime",
      () => {
        if (runtime) cleanupWindowsRuntime(runtime);
      },
    ],
    ["local folder", () => rm(local, { recursive: true, force: true })],
  ]) {
    try {
      await close();
    } catch {
      failures.push(name);
    }
  }
  result.cleanup = failures.length === 0;
  result.cleanupFailures = failures;
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, evidence }));
}
