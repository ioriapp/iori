import { fakeMarker } from "../fake-model/marker.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { waitFor, waitForOperation } from "../../verification/ui.mjs";
import { cliFailure } from "../../verification/web/operation.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import { openSettingsSection, openSidebar } from "../connection/scenario.mjs";
import { observe, observed } from "../terminal/scenario.mjs";
import { pressCliKey } from "../cli-screen/input.mjs";
import { automationIssueScripts } from "../fake-model/automation-issue.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const field = (name) => `[data-iori-field="automation-${name}"]`;
const view = '[data-iori-view="automations"]';
const row = (id) => `[data-iori-automation-run="${id}"]`;

export async function automationIssueScenario({
  client,
  fixture,
  record,
  shot,
  desktop,
  session,
  fakeModelRequests,
}) {
  const screen = client.screen;
  const { issueSetup: issues } = fixture;
  // The fixture decides the Issue number; the scripted command uses it and the
  // request must carry iori's instruction for that Issue.
  const issueStep = automationIssueScripts["automation-issue"][0];
  issueStep.input.cmd = issueStep.input.cmd.replaceAll(
    /printf '1\\n'|--issue 1\b/gu,
    (match) => match.replace("1", String(issues.a.number)),
  );
  issueStep.expectTokens = [`Work on issue #${issues.a.number}.`];
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('Host request failed');return r.result;})()`,
    );
  const capture = async (name, section) => {
    if (process.env.IORI_AUTOMATION_ISSUE_CAPTURE !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const [device, width, height] of [
      ["pc", 1440, 1000],
      ["wqhd", 2560, 1440],
      ["mobile", 390, 844],
    ]) {
      await client.browser.viewport({ width, height });
      await screen.evaluate(
        `document.querySelector(${JSON.stringify(section)}).scrollIntoView({block:'start'})`,
      );
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`${device}-automation-issue-${name}-${theme}`);
      }
    }
    await client.browser.viewport({ width: 1440, height: 1000 });
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  const listPath = `/api/v1/repos/${fixture.owner}/${fixture.repository}/issues?state=open&type=issues&labels=agent-ready`;
  const count = () => fixture.requestCount(listPath);
  const nextPoll = (before) =>
    waitForOperation(
      "Issueの次の見回り",
      count,
      (n) => n > before,
      async () => false,
    );
  const show = async () => {
    await openSidebar(screen);
    await screen.click(action("open-agents-teams"));
    await screen.click(action("teams-automations"));
    await screen.wait(view);
  };
  await desktop();
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await openFolder(screen, fixture.clonePath, false);
  await openSettingsSection(screen, "open-integrations");
  const site = `[data-iori-forge-site=${JSON.stringify(fixture.origin)}]`;
  await screen.wait(`${site} [data-iori-state="site-unregistered"]`);
  await screen.click(`${site} ${action("site-register-token")}`);
  await screen.input(
    `${site} [data-iori-field="site-token"]`,
    issues.writeToken,
  );
  await screen.click(`${site} ${action("site-token-save")}`);
  await screen.wait(`${site} [data-iori-state="site-registered"]`);
  await screen.key("Escape");
  await show();
  await screen.click(action("automation-new"));
  await screen.input(field("name"), "Issue automation");
  await screen.input(field("folder"), fixture.clonePath);
  await screen.input(
    field("instruction"),
    "Issue の番号を書いたファイル issue.txt を作って commit し、指示どおり Pull request を作ってください。" +
      fakeMarker("automation-issue"),
  );
  await screen.click(`${view} ${action("candidate-model")}`);
  await screen.input(".model-picker input", "Codex gpt-6-luna");
  await screen.wait('[cmdk-item][data-cli="codex"][data-selected="true"]');
  await screen.key("Enter");
  await screen.click(`${view} .team-permission-summary`);
  for (const [label, value] of [
    ["approval_policy", "never"],
    ["sandbox_mode", "danger-full-access"],
  ]) {
    await screen.click(`[aria-label="${label}"]`);
    await waitFor(() =>
      screen.evaluate(
        `Boolean([...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(value)}))`,
      ),
    );
    await screen.evaluate(
      `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(value)}).click()`,
    );
  }
  if (
    (await screen.attribute(
      `${view} .team-permission-summary`,
      "aria-expanded",
    )) === "true"
  )
    await screen.click(`${view} .team-permission-summary`);
  await waitFor(
    () => screen.attribute(`${view} .team-permission-summary`, "aria-expanded"),
    (value) => value === "false",
  );
  await capture("off", field("issue"));
  await screen.click(field("issue"));
  assert.equal(await screen.value(field("issue-label")), "agent-ready");
  await capture("on", field("issue"));
  await screen.input(field("issue-label"), "");
  await screen.click(action("automation-save"));
  await screen.wait(`${view} [role="alert"]`);
  assert.match(
    await screen.text(`${view} [role="alert"]`),
    /Automationを保存できません/u,
  );
  await screen.input(field("issue-label"), "agent-ready");
  await screen.click(action("automation-save"));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('${view} ${action("automation-save")}')?.disabled === true`,
    ),
  );
  const automation = (await request("automation.list")).automations.find(
    (a) => a.name === "Issue automation",
  );
  assert.ok(automation?.id);
  const history = async () =>
    (await request("automation.history", { id: automation.id })).runs;
  await issues.label(issues.a.number, true);
  let before = await count();
  await nextPoll(before);
  assert.equal((await history()).length, 0, "別の利用者のlabelでは起動しない");
  await record("別の利用者のlabelは見回り後も起動しない");
  await issues.unlabel(issues.a.number);
  await issues.label(issues.a.number);
  const timeline = await issues.timeline(issues.a.number);
  const event = timeline
    .filter(
      (item) => item.type === "label" && item.label?.name === "agent-ready",
    )
    .at(-1);
  assert.ok(event?.created_at);
  // Forgejo records event times in seconds; ensure B's mark follows A's.
  await waitForOperation(
    "Aのlabelの次の秒",
    () => Date.now(),
    (now) => now >= Date.parse(event.created_at) + 1000,
    async () => false,
  );
  await issues.label(issues.b.number);
  const a = await waitForOperation(
    "Issue Aの会話",
    async () =>
      (await history()).find(
        (run) => run.issue?.number === issues.a.number && run.terminalId,
      ),
    Boolean,
    async () => (await history()).find((run) => run.launchError)?.launchError,
  );
  assert.deepEqual(
    (await history()).map((run) => run.issue?.number),
    [issues.a.number],
  );
  let active = false;
  const completedAt = await waitForOperation(
    "Issue AのCLIの終了",
    async () => {
      const terminal = (await request("terminal.list")).terminals.find(
        (t) => t.id === a.terminalId,
      );
      if (["active", "waiting"].includes(terminal?.cliStatus?.state))
        active = true;
      if (
        ["idle", "done"].includes(terminal?.cliStatus?.state) &&
        (active ||
          (await issues.pulls()).some((p) =>
            p.body?.includes(`Closes #${issues.a.number}`),
          ))
      )
        return terminal.cliStatus.since;
      return undefined;
    },
    Boolean,
    cliFailure(screen, a.terminalId),
  );
  const b = await waitForOperation(
    "Issue Bの会話",
    async () =>
      (await history()).find(
        (run) =>
          run.issue?.number === issues.b.number &&
          run.startedAt &&
          run.terminalId,
      ),
    Boolean,
    async () => (await history()).find((run) => run.launchError)?.launchError,
  );
  assert.ok(b.startedAt >= completedAt, "BはAのidle/doneの観測後に起動");
  await request("terminal.close", { terminalId: b.terminalId, confirm: true });
  await screen.reveal(`${row(a.id)} ${action("automation-conversation")}`);
  const rowText = await screen.text(row(a.id));
  assert.match(rowText, /Issue/u);
  assert.ok(rowText.includes(`#${issues.a.number} ${issues.a.title}`));
  await screen.wait(`${row(a.id)} ${action("automation-issue-open")}`);
  assert.match(
    await screen.text(`${row(a.id)} ${action("automation-issue-open")}`),
    /ブラウザーで開く/u,
  );
  await capture("history", '[data-iori-view="automation-history"]');
  const worktrees = execFileSync(
    "git",
    ["-C", fixture.clonePath, "worktree", "list", "--porcelain"],
    { encoding: "utf8" },
  );
  const worktree = worktrees
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice(9))
    .find(
      (path) =>
        path !== fixture.clonePath &&
        (path.includes(`${issues.a.number}-`) ||
          path.endsWith(`issue-${issues.a.number}`)),
    );
  assert.ok(worktree, "Issueのworktree");
  const pulls = await issues.pulls();
  const pull = pulls.find(
    (p) =>
      p.head?.ref ===
      execFileSync("git", ["-C", worktree, "branch", "--show-current"], {
        encoding: "utf8",
      }).trim(),
  );
  assert.ok(pull);
  assert.match(pull.title, /^WIP:/u);
  assert.match(pull.body, new RegExp(`Closes #${issues.a.number}\\b`, "u"));
  assert.equal(
    execFileSync("git", ["-C", worktree, "show", "HEAD:issue.txt"], {
      encoding: "utf8",
    }).trim(),
    String(issues.a.number),
  );
  const saved = await session(a.terminalId);
  const transcript = await readFile(saved.session.file, "utf8");
  assert.match(
    transcript,
    new RegExp(`iori pr create[^\\n]*--issue[ =]+${issues.a.number}\\b`, "u"),
  );
  if (fakeModelRequests)
    // Codex shows the tool output before it sends the next model request.
    await waitForOperation(
      "Issue A の番号を指す iori の指示がモデル要求に含まれる",
      () =>
        fakeModelRequests.some(
          (request) =>
            request.marker === "automation-issue" &&
            request.step === 0 &&
            request.tokensPresent?.[`Work on issue #${issues.a.number}.`],
        ),
      Boolean,
      cliFailure(screen, a.terminalId),
    );
  await record(
    "ownerのlabelからIssueごとのworktreeと実Codexによるcommit・WIP PRを作り、A終了後にBを起動",
  );
  await screen.click(action("automation-back"));
  await screen.click(action("automation-new"));
  await screen.input(field("name"), "Main branch automation");
  await screen.input(field("folder"), fixture.clonePath);
  await screen.input(
    field("instruction"),
    "iori pr create --title x を実行し、その出力をそのまま返してください。" +
      fakeMarker("automation-issue-main"),
  );
  await screen.click(`${view} ${action("candidate-model")}`);
  await screen.input(".model-picker input", "Codex gpt-6-luna");
  await screen.wait('[cmdk-item][data-cli="codex"][data-selected="true"]');
  await screen.key("Enter");
  await screen.click(`${view} .team-permission-summary`);
  await screen.click('[aria-label="sandbox_mode"]');
  await waitFor(() =>
    screen.evaluate(
      `Boolean([...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()==='workspace-write'))`,
    ),
  );
  await screen.evaluate(
    `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()==='workspace-write').click()`,
  );
  if (
    (await screen.attribute(
      `${view} .team-permission-summary`,
      "aria-expanded",
    )) === "true"
  )
    await screen.click(`${view} .team-permission-summary`);
  await waitFor(
    () => screen.attribute(`${view} .team-permission-summary`, "aria-expanded"),
    (value) => value === "false",
  );
  await screen.click(action("automation-save"));
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector('${view} ${action("automation-save")}')?.disabled === true`,
    ),
  );
  const mainAutomation = (await request("automation.list")).automations.find(
    (item) => item.name === "Main branch automation",
  );
  assert.ok(mainAutomation?.id);
  await screen.click(action("automation-run"));
  const main = await waitForOperation(
    "mainの手動自動化の会話",
    async () =>
      (
        await request("automation.history", { id: mainAutomation.id })
      ).runs.find((run) => run.terminalId),
    Boolean,
    async () =>
      (
        await request("automation.history", { id: mainAutomation.id })
      ).runs.find((run) => run.launchError)?.launchError,
  );
  await screen.click(`${row(main.id)} ${action("automation-conversation")}`);
  await screen.wait(
    `[data-iori-terminal-id="${main.terminalId}"][data-iori-stream-state="ready"]`,
  );
  const mainSession = await waitForOperation(
    "mainのCodex会話ID",
    () => session(main.terminalId),
    (value) => Boolean(value?.session?.id),
    cliFailure(screen, main.terminalId),
  );
  const answeredApprovals = new Set();
  await observed(
    client,
    "Cannot create a Pull request from the default branch (main)",
    undefined,
    "main-default-branch",
    async () => {
      const failure = await cliFailure(screen, main.terminalId)();
      if (failure) return failure;
      const status = (await request("terminal.list")).terminals.find(
        (terminal) => terminal.id === main.terminalId,
      )?.cliStatus;
      if (
        status?.attention?.kind === "approval" &&
        !answeredApprovals.has(status.since)
      ) {
        answeredApprovals.add(status.since);
        await pressCliKey(client, "Enter");
      }
      const lines = (await readFile(mainSession.session.file, "utf8")).split(
        "\n",
      );
      const finished = lines.find((line) => {
        try {
          const item = JSON.parse(line);
          return (
            item.type === "response_item" &&
            item.payload?.type === "message" &&
            item.payload?.role === "assistant" &&
            item.payload?.phase === "final_answer"
          );
        } catch {
          return false;
        }
      });
      return finished &&
        !finished.includes(
          "Cannot create a Pull request from the default branch",
        )
        ? "Codexが既定ブランチの理由を返さず応答を終えました"
        : false;
    },
  );
  if (fakeModelRequests)
    // Codex shows the tool output before it sends the next model request.
    await waitForOperation(
      "既定ブランチの理由が iori のコマンドの出力としてモデル要求に含まれる",
      () =>
        fakeModelRequests.some(
          (request) =>
            request.marker === "automation-issue-main" &&
            request.step === 1 &&
            request.tokensPresent?.[
              "Cannot create a Pull request from the default branch (main)"
            ],
        ),
      Boolean,
      cliFailure(screen, main.terminalId),
    );
  assert.equal((await issues.pulls()).length, pulls.length);
  await request("terminal.close", {
    terminalId: main.terminalId,
    confirm: true,
  });
  await record(
    "mainの手動自動化からPR作成を呼ぶと既定ブランチの理由を返しPRは増えない",
  );
  await show();
  await screen.click(action("automation-back"));
  await screen.click(`[data-iori-automation-id="${automation.id}"]`);
  before = await count();
  await fixture.stop();
  const failure = `${view} [data-iori-forge-failure="unreachable"]`;
  await waitForOperation(
    "Forgejo切断後のIssueの理由",
    async () =>
      (await request("automation.list")).automations.find(
        (item) => item.id === automation.id,
      )?.issueError?.reason === "unreachable",
    Boolean,
    async () => false,
  );
  await screen.reveal(failure);
  assert.match(await screen.text(failure), /接続できません/u);
  await screen.wait(`${failure} ${action("automation-issue-retry")}`);
  await capture("unreachable", field("issue"));
  await fixture.start();
  await screen.click(`${failure} ${action("automation-issue-retry")}`);
  await waitFor(() =>
    screen.evaluate(`!document.querySelector(${JSON.stringify(failure)})`),
  );
  await record(
    "Forgejoが停止するとIssueの理由と再試行を示し、復帰後の再試行で消える",
  );
  await request("terminal.close", { terminalId: a.terminalId, confirm: true });
}
