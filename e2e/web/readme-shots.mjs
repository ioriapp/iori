import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fakeMarker } from "../fake-model/marker.mjs";
import { continueReadmeWorker } from "../fake-model/readme-shots.mjs";
import { readmeCapture } from "../../verification/web/readme-shots.mjs";
import {
  waitForOperation,
  childFailure,
  cliFailure,
} from "../../verification/web/operation.mjs";
import {
  register,
  openSettingsSection,
  closeSidebar,
  mobileHome,
} from "../connection/scenario.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import {
  observe,
  observeTerminalInstances,
  observedCurrentScreen,
} from "../terminal/scenario.mjs";
import { pressCliKey } from "../cli-screen/input.mjs";
import { waitForCliState, focusTerminal } from "../cli-screen/scenario.mjs";
import { pasteToCli } from "./cli-input.mjs";
import {
  openWorkspaceView,
  splitTab,
} from "../../verification/workspace/interaction.mjs";
import {
  returnToWorktree,
  saveStartupArguments,
} from "./agents-navigation.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const login = `import { useState } from "react";
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
export async function prepareReadmeRepository({ repository, worktree }) {
  // This is disposable E2E data, never a user's repository.
  for (const file of ["sample.txt", "commit-files"])
    await rm(join(worktree, file), { recursive: true, force: true });
  await mkdir(join(worktree, "src"), { recursive: true });
  await writeFile(join(worktree, "src/LoginForm.tsx"), login);
  await writeFile(
    join(worktree, "src/auth.ts"),
    'export async function signIn(email: string, password: string) {\n  return fetch("/api/session", { method: "POST", body: JSON.stringify({ email, password }) });\n}\n',
  );
  await writeFile(
    join(worktree, "package.json"),
    JSON.stringify(
      { name: "acme-web", private: true, scripts: { test: "node --test" } },
      null,
      2,
    ) + "\n",
  );
  await mkdir(join(worktree, "tasks"));
  const tasks = {
    "login-fix": [
      "Fix the login form: after a failed sign-in, the button stays disabled. Keep the email so users can retry.",
      "readme-hero",
    ],
    delegation: [
      "Please delegate the login fix to Worker and the independent review to Reviewer.",
      "readme-delegate",
    ],
    worker: [
      "Fix the login form. Read the component and check the error path.",
      "readme-worker",
    ],
    reviewer: [
      "Review the error handling and accessibility of the login form.",
      "readme-reviewer",
    ],
    plan: [
      "Write a goal and four ordered tasks for fixing and reviewing the login retry flow. Mark the reproduction done, the implementation and review in progress, and the final check pending.",
      "readme-plan",
    ],
    "plan-complete": [
      "Mark the implementation task complete now that the fix has been reported.",
      "readme-plan-complete",
    ],
    "product-question": [
      "Ask whether the email should be kept after a failed sign-in.",
      "readme-question",
    ],
    "retry-question": [
      "Ask the user whether a failed sign-in should keep the email address.",
      "readme-user-question",
    ],
    "regression-tests": [
      "Run the login form regression tests.",
      "readme-approval",
    ],
  };
  for (const [name, [text, marker]] of Object.entries(tasks))
    await writeFile(
      join(worktree, "tasks", `${name}.md`),
      `${text}\n${fakeMarker(marker)}\n`,
    );
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-C",
        worktree,
        "-c",
        "user.name=Alex Developer",
        "-c",
        "user.email=alex@example.invalid",
        ...args,
      ],
      { stdio: "ignore" },
    );
  git("add", ".");
  git("commit", "-m", "Add the sign-in form");
  git("branch", "-m", "fix/login-retry");
  git("branch", "feature/account-settings");
  // Both the main worktree and a sibling branch appear in the real sidebar.
  git(
    "worktree",
    "add",
    join(repository, "..", "acme-web-settings"),
    "feature/account-settings",
  );
}

export async function readmeShotsScenario({
  client,
  invitation,
  repository,
  worktree,
  desktop,
  mobile,
  shot,
  record,
  teamRecords,
  teamCommand,
  readmePrivacyFile,
  readmeEvidence,
  readmeTheme,
  readmeRecording,
}) {
  let screen = client.screen;
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const response=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!response.ok)throw new Error('README fixture request failed');return response.result;})()`,
    );
  await register(screen, invitation, "Alex's laptop");
  await screen.key("Escape");
  await openSettingsSection(screen, "settings-display");
  await screen.click(action("display-language"));
  await screen.click('[data-iori-option="language-en"]');
  await screen.click(action("display-theme"));
  await screen.click(`[data-iori-option="theme-${readmeTheme}"]`);
  await screen.click(action("settings-close"));
  await record("README: 英語表示に設定");
  await openFolder(screen, repository, false);
  await selectWorktree(screen, worktree, false);
  await record("README: 架空のリポジトリとworktreeを選択");
  client = await readmeRecording.open();
  screen = client.screen;
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  const { capture, finish, startVideo, stopVideo } = await readmeCapture({
    client,
    shot,
    evidence: readmeEvidence,
    privacyFile: readmePrivacyFile,
    theme: readmeTheme,
    recording: readmeRecording,
  });
  const theme = (dark) =>
    screen.evaluate(
      `document.documentElement.classList.toggle('dark',${dark})`,
    );
  const candidate = (id) => ({
    id,
    cli: "claude",
    model: "sonnet",
    tools: [],
    minimum: "",
  });
  await saveStartupArguments(screen, "claude", "--model sonnet");
  await returnToWorktree(screen, worktree);
  const definition = {
    name: "Web development",
    description: "Small changes, independent review",
    parent: candidate("parent"),
    instruction:
      "Help improve this web app. Delegate implementation to Worker and independent review to Reviewer when requested. End each turn after the requested action.",
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
      instruction:
        "Read the parent's request, work on the login form, and use iori report for the result. Do not create other agents.",
      request: "Follow the parent request.",
      report: "Changes, verification, remaining risks.",
      candidates: Object.fromEntries(
        ["low", "medium", "high"].map((level) => [
          level,
          [
            {
              ...candidate(`${name}-${level}`),
              cli: "codex",
              model: "gpt-6-luna",
              effort: "low",
            },
          ],
        ]),
      ),
    })),
  };
  const { saved } = await request("teams.create", { definition });
  await screen.click(action("open-agents-teams"));
  await screen.click(action("teams-list"));
  const teamSwitch = '.team-surface:not([hidden]) [role="switch"]';
  if ((await screen.attribute(teamSwitch, "aria-checked")) !== "true")
    await screen.click(teamSwitch);
  await returnToWorktree(screen, worktree);
  await screen.click(
    `[data-iori-view="workspace-start"] [data-iori-team-id="${saved.id}"]`,
  );
  await screen.wait('[data-iori-tab-cli="claude"]');
  const parentId = (
    await screen.attribute('[data-iori-tab-cli="claude"]', "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await waitForCliState(client, parentId, ["idle", "done"]);
  await theme(readmeTheme === "dark");
  await pasteToCli(
    client,
    "Read tasks/login-fix.md and follow its instructions.",
  );
  await waitForCliState(client, parentId, ["active"]);
  await openWorkspaceView(screen, "files");
  await screen.click('[data-iori-file="src"]');
  await screen.click('[data-iori-file="src/LoginForm.tsx"]');
  await splitTab(screen, 'button[data-iori-tab-kind="files"]', "right");
  await screen.wait('[data-iori-view="files"] .reading-body');
  await screen.click(`[data-iori-tab-id="terminal:${parentId}"]`);
  await capture("hero");
  await record("README: Claude CodeとFilesの分割画面");

  await screen.click('button[data-iori-tab-kind="files"]');
  await screen.click(
    '.dock-tab-header:has([data-iori-tab-kind="files"]) [data-iori-action="workspace-close-tab"]',
  );
  await screen.click(`[data-iori-tab-id="terminal:${parentId}"]`);
  await focusTerminal(client, parentId);
  await pressCliKey(client, "Escape");
  await waitForCliState(client, parentId, ["stopped"]);
  await pasteToCli(client, "Read tasks/plan.md and follow its instructions.");
  await waitForOperation(
    "README: 親のPlanに4タスクを保存",
    () => teamCommand(parentId, ["plan", "show"]),
    (value) =>
      value.data.tasks.length === 4 && value.data.tasks[0].state === "done",
    cliFailure(screen, parentId),
  );
  await waitForCliState(client, parentId, ["idle", "done"]);
  await startVideo();
  await pasteToCli(
    client,
    "Read tasks/delegation.md and follow its instructions.",
  );
  await waitForOperation(
    "README: Workerへの委譲",
    teamRecords,
    (value) => value.children.some((c) => c.roleName === "Worker"),
    cliFailure(screen, parentId),
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await openWorkspaceView(screen, "board");
  const records = await waitForOperation(
    "README: Reviewerの報告",
    teamRecords,
    (value) =>
      value.children.some(
        (c) => c.roleName === "Reviewer" && c.state === "reported",
      ),
    childFailure(teamRecords, (children) =>
      children.find((c) => c.roleName === "Reviewer"),
    ),
  );
  const worker = records.children.find((c) => c.roleName === "Worker");
  assert.ok(worker?.terminalId);
  await screen.wait(`[data-iori-board-agent="${worker.id}"]`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const reviewer = records.children.find((c) => c.roleName === "Reviewer");
  await screen.wait(
    `[data-iori-board-agent="${reviewer.id}"] .agent-current[title^="Reported"]`,
  );
  await theme(readmeTheme === "dark");
  await screen.wait('[data-iori-plan-task="4"]');
  assert.match(
    await screen.text('[data-iori-plan-task="2"] .todo-assignee'),
    /Worker/u,
  );
  assert.match(
    await screen.text('[data-iori-plan-task="3"] .todo-assignee'),
    /Reviewer/u,
  );
  await waitForOperation(
    "README: Workerの実編集がBoardに表示される",
    () => screen.text(`[data-iori-board-agent="${worker.id}"] .agent-diff`),
    (value) =>
      value.includes("+2") && value.includes("−1") && value.includes("1 file"),
    childFailure(teamRecords, (children) =>
      children.find((child) => child.id === worker.id),
    ),
  );
  await capture("team-board");
  await theme(readmeTheme === "dark");
  // Reuse the fake API's existing `after` gate: resume the real worker
  // after its real edit and Running state are photographed, then let it report.
  continueReadmeWorker();
  await waitForOperation(
    "README: Workerの報告",
    teamRecords,
    (value) =>
      value.children.find((c) => c.id === worker.id)?.state === "reported",
    childFailure(teamRecords, (children) =>
      children.find((c) => c.id === worker.id),
    ),
  );
  await screen.wait(
    `[data-iori-board-agent="${worker.id}"] .agent-current[title^="Reported"]`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await pasteToCli(
    client,
    "Read tasks/plan-complete.md and follow its instructions.",
  );
  await waitForOperation(
    "README: 親が実装タスクを完了",
    () => teamCommand(parentId, ["plan", "show"]),
    (value) =>
      value.data.tasks.find((task) => task.number === 2)?.state === "done",
    cliFailure(screen, parentId),
  );
  await openWorkspaceView(screen, "board");
  await screen.wait('[data-iori-plan-task="2"] .todo-status.done');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await stopVideo();
  await record("README: 親のPlan・委譲・子の報告を連続した動画で記録");

  await openWorkspaceView(screen, "git");
  await screen.click(
    '[data-iori-action="git-change-select"][data-path="src/LoginForm.tsx"]',
  );
  await screen.wait('[data-iori-scroll="git-diff"]');
  await capture("worktrees-git");
  await teamCommand(parentId, [
    "finish",
    worker.id,
    "--decision",
    "accept",
    "--reason",
    "The fix and review are complete.",
    "--worktree",
    "keep",
  ]);
  await theme(readmeTheme === "dark");
  await screen.click(action("open-agents-teams"));
  await screen.click(action("teams-records"));
  await screen.wait("[data-iori-record-candidate]");
  await screen.click(
    '.record-filters > .record-filter:last-child [data-slot="select-trigger"]',
  );
  await screen.click('[data-slot="select-item"]:nth-child(2)');
  await capture("records");

  for (const [name, schedule] of [
    ["Morning maintenance", { kind: "daily", time: "09:00" }],
    ["Review dependency updates", { kind: "manual" }],
    ["Weekly code health", { kind: "weekly", time: "10:00", days: [1] }],
  ]) {
    await request("automation.save", {
      definition: {
        name,
        instruction:
          "Review recent changes, run the project checks, and report any actionable maintenance work. Keep changes small and explain the result.",
        cwd: worktree,
        target: { kind: "team", teamId: saved.id },
        schedule,
        missed: "skip",
        enabled: false,
      },
    });
  }
  await screen.click(action("teams-automations"));
  await screen.wait("[data-iori-automation-id]");
  await capture("automations-list");
  await screen.click("[data-iori-automation-id]");
  await screen.wait('[data-iori-field="automation-name"]');
  await capture("automations");
  await returnToWorktree(screen, worktree);
  await screen.click(
    `[data-iori-child-id="${records.children.find((c) => c.roleName === "Reviewer").id}"] .nav-child-button`,
  );
  await waitForCliState(
    client,
    records.children.find((c) => c.roleName === "Reviewer").terminalId,
    ["idle", "done"],
  );
  await pasteToCli(
    client,
    "Read tasks/product-question.md and follow its instructions.",
  );
  await waitForOperation(
    "README: 子の質問",
    teamRecords,
    (value) => value.children.some((c) => c.state === "question"),
    cliFailure(
      screen,
      records.children.find((c) => c.roleName === "Reviewer").terminalId,
    ),
  );
  await screen.click(`[data-iori-terminal-row="${parentId}"]`);
  await pasteToCli(
    client,
    "Read tasks/regression-tests.md and follow its instructions.",
  );
  await waitForCliState(client, parentId, ["waiting"]);
  // Attention holds direct CLI decisions. Team questions stay on their Board.
  // Launch a separate real Claude Code to show its normal question hook too.
  await screen.click(action("workspace-add-tab"));
  await screen.click('[data-iori-cli-id="claude"]');
  const directTab = `[data-iori-tab-cli="claude"]:not([data-iori-tab-id="terminal:${parentId}"])`;
  await screen.wait(directTab);
  const directId = (
    await screen.attribute(directTab, "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await waitForCliState(client, directId, ["idle", "done"]);
  await pasteToCli(
    client,
    "Read tasks/retry-question.md and follow its instructions.",
  );
  await waitForCliState(client, directId, ["waiting"]);
  await mobile({ width: 390, height: 844 });
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await observeTerminalInstances(client);
  await theme(readmeTheme === "dark");
  await mobileHome(screen);
  await screen.wait(`[data-iori-attention-terminal="${parentId}"]`);
  await screen.wait(`[data-iori-attention-terminal="${directId}"]`);
  await capture("mobile-attention");
  await screen.click(`[data-iori-attention-terminal="${parentId}"]`);
  await closeSidebar(screen);
  await screen.wait(
    `[data-iori-terminal-id="${parentId}"][data-iori-displayed="true"][data-iori-stream-state="ready"]`,
  );
  await observedCurrentScreen(
    client,
    parentId,
    /Do you want to proceed\?/u,
    cliFailure(screen, parentId),
  );
  await capture("mobile-terminal");
  await desktop();
  await finish();
  await record(`README: ${readmeTheme}のPNG8枚・実動画GIF、禁止の値を照合`);
}
