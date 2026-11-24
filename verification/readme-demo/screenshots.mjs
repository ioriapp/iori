import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";
import { inviteToText } from "../../packages/protocol/src/index.ts";
import { linkGit, writeFakeCli } from "../host/environment.mjs";
import { startHostTest } from "../host/process.mjs";
import { chromiumExecutable } from "../web/browser.mjs";
import { startWeb } from "../web/dev.mjs";

os.hostname = () => "workstation";
syncBuiltinESMExports();

const root = resolve(import.meta.dirname, "../..");
const imagesDir = join(root, "docs/images");
const fakeCliPath = fileURLToPath(new URL("./fake-cli.mjs", import.meta.url));
const hostnameHookPath = fileURLToPath(
  new URL("./hostname.mjs", import.meta.url),
);

const initialLoginForm = `import { useState } from "react";
import { signIn } from "./auth";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await signIn(email, password);
      setSubmitting(false);
    } catch {
      setError("We couldn't sign you in. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Welcome back</h1>
      <label>Email<input value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
`;

const fixedLoginForm = initialLoginForm.replace(
  `      await signIn(email, password);
      setSubmitting(false);
    } catch {
      setError("We couldn't sign you in. Please try again.");
    }`,
  `      await signIn(email, password);
    } catch {
      setError("We couldn't sign you in. Please try again.");
    } finally {
      setSubmitting(false);
    }`,
);

async function loadForbiddenValues() {
  const { forbidden } = JSON.parse(
    await readFile(join(os.homedir(), ".config/iori/publish.json"), "utf8"),
  );
  assert.ok(Array.isArray(forbidden) && forbidden.length > 0);
  return [...forbidden, "/root/projects"];
}

async function prepareSampleRepository(projectsDir) {
  const repository = join(projectsDir, "acme-web");
  const settingsWorktree = join(projectsDir, "acme-web-settings");
  const loginWorktree = join(projectsDir, "acme-web-login");
  await mkdir(join(repository, "src"), { recursive: true });
  await writeFile(join(repository, "src/LoginForm.tsx"), initialLoginForm);
  await writeFile(
    join(repository, "src/auth.ts"),
    'export async function signIn(email: string, password: string) {\n  return fetch("/api/session", { method: "POST", body: JSON.stringify({ email, password }) });\n}\n',
  );
  await writeFile(
    join(repository, "package.json"),
    JSON.stringify(
      { name: "acme-web", private: true, scripts: { test: "node --test" } },
      null,
      2,
    ) + "\n",
  );
  const git = (cwd, ...args) =>
    execFileSync(
      "git",
      [
        "-C",
        cwd,
        "-c",
        "user.name=Alex Developer",
        "-c",
        "user.email=alex@example.invalid",
        ...args,
      ],
      { stdio: "pipe" },
    );
  git(repository, "init", "-b", "main");
  git(repository, "add", ".");
  git(repository, "commit", "-m", "Add the sign-in form");
  git(
    repository,
    "worktree",
    "add",
    "-b",
    "feature/account-settings",
    settingsWorktree,
  );
  git(repository, "worktree", "add", "-b", "fix/login-retry", loginWorktree);
  return { repository, settingsWorktree, loginWorktree };
}

async function waitUntil(description, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for: ${description}${lastError ? `\n${lastError}` : ""}`,
  );
}

async function assertNoForbiddenText(page, forbidden) {
  const found = await page.evaluate((values) => {
    const normalize = (v) => v.toLowerCase().replace(/\s+/gu, "");
    let text = document.body.innerText;
    for (const el of document.querySelectorAll("input,textarea")) {
      if (el.checkVisibility()) text += "\n" + el.value;
    }
    const renderer = (element) => {
      for (let owner = element; owner; owner = owner.parentElement) {
        const key = Object.keys(owner).find((k) =>
          k.startsWith("__reactFiber$"),
        );
        for (let fiber = key && owner[key]; fiber; fiber = fiber.return) {
          for (
            let hook = fiber.memoizedState;
            hook && typeof hook === "object";
            hook = hook.next
          ) {
            const current = hook.memoizedState?.current;
            if (current?.element === element && current.buffer?.active)
              return current;
          }
        }
      }
    };
    for (const el of document.querySelectorAll(
      '[data-iori-view="terminal"][data-iori-displayed="true"] .xterm',
    )) {
      if (!el.checkVisibility()) continue;
      const terminal = renderer(el);
      if (!terminal) continue;
      const buffer = terminal.buffer.active;
      for (
        let row = buffer.viewportY;
        row < buffer.viewportY + terminal.rows;
        row++
      ) {
        text += "\n" + (buffer.getLine(row)?.translateToString() ?? "");
      }
    }
    const normalized = normalize(text);
    for (const value of values) {
      const n = normalize(value);
      if (n && normalized.includes(n)) return true;
    }
    return false;
  }, forbidden);
  assert.equal(found, false, "Forbidden value appeared on screen");
}

async function runTheme(theme, forbidden) {
  const cleanups = [];
  const t = {
    after: (cleanup) => cleanups.push(cleanup),
    diagnostic: (text) => console.error(text),
  };
  const terminals = new Map();
  let host;
  let web;
  let browser;
  try {
    let ackDir;
    let sessionDir;
    host = await startHostTest(t, {
      environment: {
        TZ: "Asia/Tokyo",
        IORI_README_THEME: theme,
        NODE_OPTIONS: `--import ${hostnameHookPath}`,
      },
      prepareEnvironment: async (dataRoot) => {
        const bin = join(dataRoot, "bin");
        ackDir = join(dataRoot, "ack");
        sessionDir = join(dataRoot, "sessions");
        await mkdir(ackDir, { recursive: true });
        await mkdir(sessionDir, { recursive: true });
        await linkGit(bin);
        for (const name of ["claude", "codex"]) {
          await writeFakeCli(
            bin,
            name,
            `process.env.IORI_README_CLI = ${JSON.stringify(name)};\nawait import(${JSON.stringify(`file://${fakeCliPath}`)});\n`,
          );
        }
        return {
          IORI_README_ACK_DIR: ackDir,
          IORI_README_SESSION_DIR: sessionDir,
        };
      },
    });

    const projectsDir = join(host.dataRoot, "projects");
    const { repository, loginWorktree } =
      await prepareSampleRepository(projectsDir);

    const { invite } = await host.client.request("invite.create");
    const inviteText = inviteToText(invite);

    web = await startWeb({
      storageRoot: join(host.dataRoot, "client"),
      port: 0,
    });
    const bridgeUrl = await (async () => {
      // startWeb sets vite.config.define.__IORI_WEB_BRIDGE_URL__, so fetch index or use a tiny probe?
      // Actually startWeb already injects __IORI_WEB_BRIDGE_URL__ into the web bundle,
      // and we can read it from the page or pair via UI. Let's pair via UI for simplicity!
      return null;
    })();
    void bridgeUrl;

    const executablePath = await chromiumExecutable(chromium);
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US",
      colorScheme: theme,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(web.url);

    // Pair via bridge URL extracted from page module or UI invitation flow
    const connectBtn = page.getByRole("button", {
      name: "Connect with an invitation",
      exact: true,
    });
    if (await connectBtn.isVisible().catch(() => false)) {
      await connectBtn.click();
    }
    await page
      .getByRole("textbox", { name: "Invitation", exact: true })
      .fill(inviteText);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await page
      .getByRole("button", { name: "Add folder", exact: true })
      .waitFor({ state: "visible" });

    // Set Display language=en and theme=dark/light
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator('[data-iori-action="settings-display"]').click();
    await page.locator('[data-iori-action="display-language"]').click();
    await page.locator('[data-iori-option="language-en"]').click();
    await page.locator('[data-iori-action="display-theme"]').click();
    await page.locator(`[data-iori-option="theme-${theme}"]`).click();
    await page.locator('[data-iori-action="settings-close"]').click();

    // Open acme-web folder and select fix/login-retry worktree
    await page.getByRole("button", { name: "Add folder", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Folder path", exact: true })
      .fill(repository);
    await page.locator('[data-iori-action="folder-open"]').click();
    await page.locator(`[data-iori-worktree-path="${loginWorktree}"]`).click();
    await waitUntil("fix/login-retry selected", async () => {
      const current = await page
        .locator("[data-iori-current-worktree-path]")
        .getAttribute("data-iori-current-worktree-path");
      return current === loginWorktree;
    });

    // Helper to send command to fake CLI over PTY and wait for ack file
    let stepSeq = 0;
    async function cliStep(terminalId, step) {
      const label = step.command
        ? `cmd:${step.command.slice(0, 2).join(" ")}`
        : Object.keys(step).join(",");
      console.log(`  cliStep(${terminalId.slice(0, 6)}, ${label})`);
      if (!terminals.has(terminalId)) {
        terminals.set(
          terminalId,
          await host.client.terminal(terminalId, { claimSize: false }),
        );
      }
      const id = `step-${++stepSeq}`;
      const ackFile = join(ackDir, `${id}.json`);
      await terminals
        .get(terminalId)
        .input(JSON.stringify({ id, ...step }) + "\r");
      const result = await waitUntil(
        `cliStep ${id} (${label})`,
        async () => {
          try {
            await access(ackFile);
            const content = await readFile(ackFile, "utf8");
            return JSON.parse(content);
          } catch {
            return null;
          }
        },
        15_000,
      );
      if (result && result.ok === false) {
        throw new Error(
          `cliStep ${id} (${label}) failed: ${JSON.stringify(result)}`,
        );
      }
      return result;
    }

    async function capture(name) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await assertNoForbiddenText(page, forbidden);
      const outPath = join(imagesDir, `${name}-${theme}.png`);
      await page.screenshot({ path: outPath });
      const info = await stat(outPath);
      console.log(`Captured ${name}-${theme}.png (${info.size} bytes)`);
    }

    async function openView(kind) {
      const tab = page.locator(`[data-iori-tab-kind="${kind}"]`);
      if (await tab.count()) {
        await tab.first().click();
        return;
      }
      await page
        .getByRole("button", { name: "New tab", exact: true })
        .first()
        .click();
      await page.locator(`[data-iori-action="workspace-open-${kind}"]`).click();
    }

    // Create Team "Web development"
    const candidate = (id, cli, model, effort) => ({
      id,
      cli,
      model,
      ...(effort ? { effort } : {}),
      tools: [],
      minimum: "",
    });
    const { saved: team } = await host.client.request("teams.create", {
      definition: {
        name: "Web development",
        description: "Small changes, independent review",
        parent: candidate("parent", "claude", "sonnet"),
        instruction:
          "Help improve this web app. Delegate implementation to Worker and independent review to Reviewer.",
        roles: ["Worker", "Reviewer"].map((name) => ({
          id: name.toLowerCase(),
          name,
          when:
            name === "Worker"
              ? "Implement the fix"
              : "Review correctness and accessibility",
          limit: "1",
          reuse: true,
          split: false,
          instruction: "Work on the login form and report with iori report.",
          request: "Follow the parent request.",
          report: "Changes, verification, remaining risks.",
          candidates: Object.fromEntries(
            ["low", "medium", "high"].map((level) => [
              level,
              [candidate(`${name}-${level}`, "codex", "gpt-6-luna", "low")],
            ]),
          ),
        })),
      },
    });
    await host.client.request("teams.settings", {
      defaultTeam: team.id,
      limits: {},
    });

    // Launch team from New tab dialog
    await page
      .getByRole("button", { name: "New tab", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Web development", exact: true })
      .click();
    const parentTab = page.locator('[data-iori-tab-cli="claude"]').first();
    await parentTab.waitFor({ state: "visible" });
    const parentId = (await parentTab.getAttribute("data-iori-tab-id")).replace(
      /^terminal:/u,
      "",
    );
    await page
      .locator(
        `[data-iori-view="terminal"][data-iori-terminal-id="${parentId}"][data-iori-stream-state="ready"]`,
      )
      .waitFor({ state: "visible" });

    // 1. HERO: Claude Code active + Files split right showing src/LoginForm.tsx
    console.log("Step 1: hero");
    await cliStep(parentId, { hook: "UserPromptSubmit", payload: {} });
    const existingFiles = page.locator('[data-iori-tab-kind="files"]');
    if (await existingFiles.count()) {
      await existingFiles.first().hover();
      await page
        .getByRole("button", { name: "Files Close", exact: true })
        .click();
    }
    await page
      .getByRole("button", { name: "Split right", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "New tab", exact: true })
      .last()
      .click();
    await page.locator('[data-iori-action="workspace-open-files"]').click();
    const startTab = page.locator('[data-iori-tab-kind="start"]');
    while (await startTab.count()) {
      await startTab.first().hover();
      await page
        .getByRole("button", { name: "Start Close", exact: true })
        .first()
        .click();
    }
    await page.locator('[data-iori-file="src"]').click();
    await page.locator('[data-iori-file="src/LoginForm.tsx"]').click();
    await page
      .locator('[data-iori-view="files"] .reading-body')
      .waitFor({ state: "visible" });
    await page.locator(`[data-iori-tab-id="terminal:${parentId}"]`).click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await cliStep(parentId, { render: "hero" });
    await capture("hero");

    // Close Files pane
    await page.locator('[data-iori-tab-kind="files"]').first().hover();
    await page
      .getByRole("button", { name: "Files Close", exact: true })
      .click();
    await page.locator(`[data-iori-tab-id="terminal:${parentId}"]`).click();

    // 2. TEAM BOARD: 4 tasks plan, Worker running (+2 -1), Reviewer reported
    console.log("Step 2: team-board");
    await cliStep(parentId, {
      command: ["plan", "goal", "--body", "Restore a reliable sign-in flow"],
    });
    await cliStep(parentId, {
      command: ["plan", "add", "--title", "Reproduce the retry bug"],
    });
    await cliStep(parentId, {
      command: [
        "plan",
        "add",
        "--title",
        "Fix the submit state",
        "--after",
        "1",
      ],
    });
    await cliStep(parentId, {
      command: [
        "plan",
        "add",
        "--title",
        "Review error handling",
        "--after",
        "2",
      ],
    });
    await cliStep(parentId, {
      command: [
        "plan",
        "add",
        "--title",
        "Verify the retry flow",
        "--after",
        "3",
      ],
    });
    await cliStep(parentId, {
      command: [
        "plan",
        "update",
        "1",
        "--state",
        "done",
        "--checkpoint",
        "Confirmed: failed sign-in leaves the button disabled",
      ],
    });
    await cliStep(parentId, {
      command: ["plan", "update", "2", "--state", "in_progress"],
    });
    await cliStep(parentId, {
      command: ["plan", "update", "3", "--state", "in_progress"],
    });

    const wDel = await cliStep(parentId, {
      command: [
        "delegate",
        "--role",
        "Worker",
        "--difficulty",
        "low",
        "--title",
        "Fix the login form",
        "--worktree",
        "parent",
        "--plan",
        "2",
        "--body",
        "Fix the login form: reset isSubmitting in finally.",
      ],
    });
    const rDel = await cliStep(parentId, {
      command: [
        "delegate",
        "--role",
        "Reviewer",
        "--difficulty",
        "low",
        "--title",
        "Review the error handling",
        "--worktree",
        "parent",
        "--plan",
        "3",
        "--body",
        "Review error handling and accessibility of the login form.",
      ],
    });
    console.log("  delegated:", JSON.stringify({ wDel, rDel }));

    const isRole = (c, name) =>
      c.role === name || c.roleName === name || c.role === name.toLowerCase();
    let lastChildren = [];
    const { children } = await waitUntil(
      "Worker and Reviewer spawned",
      async () => {
        const res = await host.client.request("teams.children", {
          cwd: loginWorktree,
        });
        lastChildren = res.children;
        const w = res.children.find((c) => isRole(c, "Worker") && c.terminalId);
        const r = res.children.find(
          (c) => isRole(c, "Reviewer") && c.terminalId,
        );
        return w && r ? res : null;
      },
      10_000,
    ).catch((err) => {
      console.error("  lastChildren:", JSON.stringify(lastChildren, null, 2));
      throw err;
    });
    console.log(
      "  children ready:",
      children.map(
        (c) => `${c.role ?? c.roleName}:${c.terminalId?.slice(0, 6)}`,
      ),
    );
    const worker = children.find((c) => isRole(c, "Worker"));
    const reviewer = children.find((c) => isRole(c, "Reviewer"));

    // Worker makes the real file edit and stays Running with tokens
    await cliStep(worker.terminalId, {
      writeFile: { path: "src/LoginForm.tsx", content: fixedLoginForm },
    });
    await cliStep(worker.terminalId, {
      tokens: { input: 18000, output: 900, cacheRead: 12000, reasoning: 200 },
    });
    await cliStep(worker.terminalId, { hook: "UserPromptSubmit", payload: {} });
    await cliStep(worker.terminalId, { render: "worker" });

    // Reviewer records tokens and reports
    await cliStep(reviewer.terminalId, {
      tokens: { input: 12000, output: 600, cacheRead: 7000, reasoning: 100 },
    });
    await cliStep(reviewer.terminalId, {
      command: [
        "report",
        "--body",
        "Review complete: keep the error message visible, restore the submit button in finally, and retain the email for retry.",
      ],
    });
    await cliStep(reviewer.terminalId, { hook: "Stop", payload: {} });
    await cliStep(parentId, { hook: "Stop", payload: {} });

    await openView("board");
    await waitUntil(
      "Board shows 4 tasks, Worker diff, Reviewer reported",
      async () => {
        const hasTask4 = await page
          .locator('[data-iori-plan-task="4"]')
          .isVisible()
          .catch(() => false);
        const workerText = await page
          .locator(`[data-iori-board-agent="${worker.id}"]`)
          .innerText()
          .catch(() => "");
        const reviewerText = await page
          .locator(`[data-iori-board-agent="${reviewer.id}"]`)
          .innerText()
          .catch(() => "");
        return (
          hasTask4 &&
          workerText.includes("+2") &&
          reviewerText.includes("Reported")
        );
      },
    );
    await capture("team-board");

    // 3. WORKTREES & GIT: 3 worktrees in sidebar + Git diff of src/LoginForm.tsx
    console.log("Step 3: worktrees-git");
    await openView("git");
    await page
      .locator(
        '[data-iori-action="git-change-select"][data-path="src/LoginForm.tsx"]',
      )
      .click();
    await page
      .locator('[data-iori-scroll="git-diff"]')
      .waitFor({ state: "visible" });
    await capture("worktrees-git");

    // 4. RECORDS: Worker reports and is accepted, open Records with X axis = Tokens
    console.log("Step 4: records");
    await cliStep(worker.terminalId, {
      command: [
        "report",
        "--body",
        "Fixed: the submit button is restored in finally after failed sign-in.",
      ],
    });
    await cliStep(worker.terminalId, { hook: "Stop", payload: {} });
    await cliStep(parentId, {
      command: [
        "finish",
        worker.id,
        "--decision",
        "accept",
        "--reason",
        "The fix and review are complete.",
        "--worktree",
        "keep",
      ],
    });
    await page
      .getByRole("button", { name: "AI Agents/Teams", exact: true })
      .click();
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await page
      .locator("[data-iori-record-candidate]")
      .first()
      .waitFor({ state: "visible" });
    await page.getByRole("combobox", { name: "X axis", exact: true }).click();
    await page.getByRole("option", { name: "Tokens", exact: true }).click();
    await capture("records");

    // 5 & 6. AUTOMATIONS LIST & AUTOMATIONS EDIT
    console.log("Step 5 & 6: automations");
    for (const [name, schedule] of [
      ["Morning maintenance", { kind: "daily", time: "09:00" }],
      ["Review dependency updates", { kind: "manual" }],
      ["Weekly code health", { kind: "weekly", time: "10:00", days: [1] }],
    ]) {
      await host.client.request("automation.save", {
        definition: {
          name,
          instruction:
            "Review recent changes, run the project checks, and report any actionable maintenance work. Keep changes small and explain the result.",
          cwd: "/workspace/acme-web",
          target: { kind: "team", teamId: team.id },
          schedule,
          missed: "skip",
          enabled: false,
        },
      });
    }
    await page
      .getByRole("button", { name: "Automations", exact: true })
      .click();
    await page
      .locator("[data-iori-automation-id]")
      .first()
      .waitFor({ state: "visible" });
    await capture("automations-list");

    await page
      .locator("[data-iori-automation-id]")
      .filter({ hasText: "Morning maintenance" })
      .click();
    await page
      .locator('[data-iori-field="automation-name"]')
      .waitFor({ state: "visible" });
    await capture("automations");

    // 7 & 8. MOBILE ATTENTION & MOBILE TERMINAL
    console.log("Step 7 & 8: mobile");
    await page.locator(`[data-iori-worktree-path="${loginWorktree}"]`).click();
    // Reviewer asks a question (shows Question 1 in Boards on Mobile Attention)
    await cliStep(reviewer.terminalId, {
      command: [
        "ask",
        "--body",
        "Should a failed sign-in keep the email address so the user can retry?",
      ],
    });
    // Parent waits for Bash approval
    await cliStep(parentId, {
      hook: "PermissionRequest",
      payload: {
        tool_name: "Bash",
        tool_input: {
          command: "npm run test -- LoginForm",
          description: "Check the login form regression tests",
        },
      },
    });
    // Launch a direct Claude Code tab that asks a user question
    await page
      .getByRole("button", { name: "New tab", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Claude Code", exact: true })
      .click();
    const directTab = page
      .locator(
        `[data-iori-tab-cli="claude"]:not([data-iori-tab-id="terminal:${parentId}"])`,
      )
      .first();
    await directTab.waitFor({ state: "visible" });
    const directId = (await directTab.getAttribute("data-iori-tab-id")).replace(
      /^terminal:/u,
      "",
    );
    await page
      .locator(
        `[data-iori-view="terminal"][data-iori-terminal-id="${directId}"][data-iori-stream-state="ready"]`,
      )
      .waitFor({ state: "visible" });
    await cliStep(directId, {
      hook: "PreToolUse",
      payload: {
        tool_name: "AskUserQuestion",
        tool_input: {
          questions: [
            {
              question: "Should a failed sign-in keep the email address?",
              header: "Retry behavior",
            },
          ],
        },
      },
    });

    // Open a real mobile context (touch + mobile UA, 390x844) so the mobile key bar renders
    const storageState = await context.storageState();
    const mobileContext = await browser.newContext({
      ...devices["Pixel 7"],
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      locale: "en-US",
      colorScheme: theme,
      storageState,
    });
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultTimeout(20_000);
    await mobilePage.goto(web.url);

    // Navigate to mobile Home (Attention) view
    const openSidebarBtn = mobilePage.getByRole("button", {
      name: "Open sidebar",
      exact: true,
    });
    await openSidebarBtn.waitFor({ state: "visible" });
    const mobileHome = mobilePage.locator('[data-iori-view="mobile-home"]');
    if (!(await mobileHome.isVisible().catch(() => false))) {
      await openSidebarBtn.tap();
      await mobilePage.getByRole("button", { name: "Home", exact: true }).tap();
    }
    await mobileHome
      .locator(`[data-iori-attention-terminal="${parentId}"]`)
      .waitFor({ state: "visible" });
    await mobileHome
      .locator(`[data-iori-attention-terminal="${directId}"]`)
      .waitFor({ state: "visible" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await assertNoForbiddenText(mobilePage, forbidden);
    const mobileAttentionPath = join(
      imagesDir,
      `mobile-attention-${theme}.png`,
    );
    await mobilePage.screenshot({ path: mobileAttentionPath });
    console.log(
      `Captured mobile-attention-${theme}.png (${(await stat(mobileAttentionPath)).size} bytes)`,
    );

    // Open parent terminal from Attention and render mobile approval screen with key bar
    await mobileHome
      .locator(`[data-iori-attention-terminal="${parentId}"]`)
      .tap();
    await mobilePage
      .locator(
        `[data-iori-view="terminal"][data-iori-terminal-id="${parentId}"][data-iori-displayed="true"][data-iori-stream-state="ready"]`,
      )
      .waitFor({ state: "visible" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await cliStep(parentId, { render: "approval" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    await assertNoForbiddenText(mobilePage, forbidden);
    const mobileTerminalPath = join(imagesDir, `mobile-terminal-${theme}.png`);
    await mobilePage.screenshot({ path: mobileTerminalPath });
    console.log(
      `Captured mobile-terminal-${theme}.png (${(await stat(mobileTerminalPath)).size} bytes)`,
    );
    await mobileContext.close();
  } catch (error) {
    console.error("runTheme error:", error);
    throw error;
  } finally {
    console.log("Cleaning up...");
    for (const term of terminals.values()) {
      await term.close?.().catch(() => {});
    }
    await browser?.close().catch(() => {});
    await web?.close().catch(() => {});
    for (const cleanup of cleanups.reverse()) {
      await cleanup().catch(() => {});
    }
  }
}

const themeArg = process.argv
  .find((arg) => arg.startsWith("--theme="))
  ?.slice(8);
const themes = themeArg ? [themeArg] : ["dark", "light"];
const forbidden = await loadForbiddenValues();

for (const theme of themes) {
  console.log(`\n=== Capturing ${theme} theme ===`);
  await runTheme(theme, forbidden);
}
console.log("\nAll requested README screenshots captured successfully.");
