import { fakeMarker } from "../fake-model/marker.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { waitFor, waitForOperation } from "../../verification/ui.mjs";
import { cliFailure } from "../../verification/web/operation.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import { openSettingsSection, openSidebar } from "../connection/scenario.mjs";
import { observe } from "../terminal/scenario.mjs";
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
  await issues.label(issues.a.number);
  const a = await waitForOperation(
    "Issue Aの会話",
    async () =>
      (await history()).find(
        (run) => run.issue?.number === issues.a.number && run.terminalId,
      ),
    Boolean,
    async () => (await history()).find((run) => run.launchError)?.launchError,
  );
  let active = false;
  await waitForOperation(
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
  await record("ownerのlabelから実Codexの会話を開き、commitとWIP PRを作る");
  await show();
  await screen.click(action("automation-back"));
  await screen.click(`[data-iori-automation-id="${automation.id}"]`);
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
