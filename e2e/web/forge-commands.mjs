import { local as verificationLocal } from "../../verification/native/local.mjs";
import assert from "node:assert/strict";
import { issueWorktreeName } from "../../packages/protocol/src/worktree-name.ts";
import { readIssuesExpectation } from "../../verification/web/forge-fixture.mjs";
import { waitFor } from "../../verification/ui.mjs";
import { observe } from "../terminal/scenario.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import {
  closeSidebar,
  openSidebar,
  openWorkspaceSettings,
} from "../connection/scenario.mjs";
import { forgeCapture, startedClaude } from "./forge-issue-start.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const field = (name) => `[data-iori-field="${name}"]`;
const pane = '[data-iori-view="issues"]:not([hidden])';
const row = (number) =>
  `${pane} [data-iori-part="issues-rows"] [data-iori-issue="${number}"]`;
const detail = (number) =>
  `${pane} [data-iori-part="issue-detail"][data-iori-issue-detail="${number}"]`;
const issuesButton = (path) =>
  `${action("repository-issues")}[data-iori-repository-path=${JSON.stringify(path)}]`;
const creator = '[data-iori-view="worktree-create"]';
const json = (result) => {
  assert.equal(result.code, 0, result.stdout);
  const value = JSON.parse(result.stdout);
  assert.equal(value.ok, true, value.text);
  return value.data;
};

/**
 * From a Claude Code outside a team, the real `iori` reads Issues and CI of
 * the CLI's worktree through the real Host: what the Forge answers, the reason
 * when it cannot read, never a token, and no team command.
 */
export async function forgeCommandsScenario({
  client,
  fixture,
  tokenFixture,
  session,
  cliCommand,
  mobile,
  desktop,
  shot,
  record,
}) {
  const screen = client.screen;
  const { capture, wide } = forgeCapture(client, shot, "IORI_START_CAPTURE");
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('request failed');return r.result;})()`,
    );
  const known = new Set(
    (await request("terminal.list")).terminals.map((item) => item.id),
  );
  // Claude Code started as the user starts it: a new tab of the worktree.
  const claude = async (path) => {
    await selectWorktree(screen, path, false);
    // A worktree opened for the first time shows the start tab's list.
    await screen.wait(
      'button[data-iori-tab-kind="start"][data-state="active"]',
    );
    await screen.click('[data-iori-cli-id="claude"]');
    return (await startedClaude(client, session, path, known)).id;
  };
  await openFolder(screen, fixture.repository, false);
  // The remote names an SSH alias; the workspace's Git settings give its site.
  await openWorkspaceSettings(screen, fixture.repository);
  const mapping = `[data-iori-forge-host=${JSON.stringify(fixture.remoteHost)}] ${field("forge-web-url")}`;
  await screen.wait(mapping);
  await screen.input(mapping, fixture.origin);
  await screen.key("Enter");
  await screen.wait(
    `[data-iori-forge-host=${JSON.stringify(fixture.remoteHost)}] [data-iori-state="saved"]`,
  );
  await screen.key("Escape");
  await openFolder(screen, fixture.githubRepository, false);
  await openFolder(screen, tokenFixture.clonePath, false);

  // The public Forgejo, in the worktree whose push target's CI failed.
  const forge = await claude(fixture.ciFailed);
  const run = (...args) => cliCommand(forge, args);
  const help = await run("--help");
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^iori issue list /mu);
  assert.match(help.stdout, /^iori ci log \[JOB_ID\]$/mu);
  assert.doesNotMatch(help.stdout, /iori delegate|iori report/u);
  const tasks = await run("tasks");
  assert.equal(tasks.code, 1);
  assert.match(
    tasks.stdout,
    /^Only a CLI in an iori team conversation can use iori tasks\.$/mu,
  );
  await record(
    "チームでない会話のClaude Codeの環境で、PATHの先頭のioriがForgeのコマンドだけを案内し、チームのコマンドは理由を返して終了コード1",
  );

  const expected = await readIssuesExpectation(fixture);
  const list = json(await run("issue", "list", "--json"));
  assert.equal(
    list.repository.owner,
    verificationLocal.forge.repository.split("/")[0],
  );
  assert.equal(list.issues[0].number, expected.newest);
  assert.equal(list.issues.length, Math.min(30, expected.total));
  assert.equal(list.more, expected.total > 30);
  assert.ok(list.issues.every((issue) => issue.state === "open"));
  const short = await run("issue", "list", "--limit", "2");
  const lines = short.stdout.trimEnd().split("\n");
  assert.equal(
    lines[0],
    `Open Issues of ${verificationLocal.forge.repository} (Forgejo), newest first:`,
  );
  assert.match(lines[1], new RegExp(`^#${expected.newest} `, "u"));
  assert.equal(lines.length, 3 + Number(expected.total > 2));
  if (expected.total > 2)
    assert.equal(lines.at(-1), "More Issues exist; use --limit to show more.");
  const labelled = json(
    await run("issue", "list", "--label", expected.label, "--json"),
  );
  assert.equal(labelled.issues[0]?.number, expected.labelledNewest);
  assert.ok(
    labelled.issues.every((issue) => issue.labels.includes(expected.label)),
  );
  // Forgejo drops a label the repository lacks; nothing is listed for it.
  const absent = await run("issue", "list", "--label", "no-such-label-iori");
  assert.equal(
    absent.stdout,
    `There are no open Issues with the label no-such-label-iori in ${verificationLocal.forge.repository}.\n`,
  );
  const live = await (
    await fetch(
      `${fixture.origin}/api/v1/repos/${verificationLocal.forge.repository}/issues/${expected.discussed.number}`,
    )
  ).json();
  const comments = await (
    await fetch(
      `${fixture.origin}/api/v1/repos/${verificationLocal.forge.repository}/issues/${expected.discussed.number}/comments`,
    )
  ).json();
  const shown = json(
    await run("issue", "show", String(expected.discussed.number), "--json"),
  );
  assert.equal(shown.issue.title, live.title);
  assert.equal(shown.issue.body, live.body);
  assert.deepEqual(
    shown.issue.comments.map((comment) => comment.body),
    comments.map((comment) => comment.body),
  );
  const text = await run("issue", "show", String(expected.discussed.number));
  assert.ok(text.stdout.startsWith(`#${live.number} ${live.title}\n`));
  assert.ok(text.stdout.includes(live.body));
  await record(
    "iori issue list・showが公開ForgejoのIssueを既定のOpen・30件・--limit・--label（全てを持つ）で返し、本文とコメントをForgeが返すまま返す",
    { newest: expected.newest, total: expected.total },
  );

  const api = `${fixture.origin}/api/v1/repos/${verificationLocal.forge.repository}`;
  const runs = (
    await (
      await fetch(`${api}/actions/runs?head_sha=${fixture.failedSha}`)
    ).json()
  ).workflow_runs;
  const jobs = (
    await Promise.all(
      runs.map(async (item) =>
        (await fetch(`${api}/actions/runs/${item.id}/jobs`)).json(),
      ),
    )
  ).flat();
  const failedJob = jobs.find((job) => job.status === "failure");
  assert.ok(failedJob, "公開Forgejoの対象commitに失敗したjobがある");
  const rawLog = await (
    await fetch(`${api}/actions/jobs/${failedJob.id}/logs`)
  ).text();
  const ci = json(await run("ci", "list", "--json"));
  assert.equal(ci.commit.sha, fixture.failedSha);
  assert.deepEqual(
    ci.runs.flatMap((item) => item.jobs.map((job) => job.id)).sort(),
    jobs.map((job) => String(job.id)).sort(),
  );
  assert.equal(
    ci.runs
      .flatMap((item) => item.jobs)
      .find((job) => job.id === String(failedJob.id)).status,
    "failed",
  );
  const failedLog = json(await run("ci", "log", "--json"));
  assert.deepEqual(
    failedLog.jobs.map((job) => job.id),
    jobs.filter((job) => job.status === "failure").map((job) => String(job.id)),
  );
  assert.equal(failedLog.jobs[0].log, rawLog);
  const named = await run("ci", "log", String(failedJob.id));
  assert.equal(named.stdout, `${rawLog}\n`);
  await record(
    "iori ci list・logがCLIのworktreeのpush先の最新のcommitのCIと、失敗したjob（ID省略時）と指定したjobのログ全体をForgejoが返すまま返す",
    { job: failedJob.id },
  );

  // GitHub without gh's sign-in on this Host: the reason and what helps.
  const github = await claude(fixture.githubRepository);
  const signedOut = await cliCommand(github, ["issue", "list"]);
  assert.equal(signedOut.code, 1);
  assert.equal(
    signedOut.stdout,
    "This Host's gh is not signed in to GitHub. Run gh auth login in a Terminal on this Host.\n",
  );
  await record(
    "ghにログインしていないHostのGitHubのリポジトリでは、画面と同じ理由とgh auth loginの案内を英語の短い文で返す",
  );

  // A private repository on a sign-in-only Forgejo, before and after its token.
  const { origin, readToken } = tokenFixture;
  const owned = `${tokenFixture.owner}/${tokenFixture.repository}`;
  const privateCli = await claude(tokenFixture.clonePath);
  const missing = await cliCommand(privateCli, ["issue", "list"]);
  assert.equal(missing.code, 1);
  assert.equal(
    missing.stdout,
    `No token is registered for ${origin}. Register one in iori: Settings > Integrations of this Host.\n`,
  );
  await request("forge.token.set", { origin, token: readToken });
  const answers = [];
  for (const args of [
    ["issue", "list", "--json"],
    ["issue", "show", String(tokenFixture.issueNumber), "--json"],
    ["ci", "list", "--json"],
  ]) {
    const result = await cliCommand(privateCli, args, readToken);
    assert.equal(result.secretInEnvironment, false, "CLIの環境にtokenが無い");
    assert.ok(!result.stdout.includes(readToken), "答えにtokenが無い");
    answers.push(json(result));
  }
  assert.ok(
    answers[0].issues.some(
      (issue) => issue.number === tokenFixture.issueNumber,
    ),
  );
  assert.equal(answers[1].issue.title, "Keep the token out of the logs");
  assert.equal(answers[2].commit.sha, tokenFixture.sha);
  await tokenFixture.deleteIssue(tokenFixture.goneIssueNumber);
  const gone = await cliCommand(privateCli, [
    "issue",
    "show",
    String(tokenFixture.goneIssueNumber),
  ]);
  assert.equal(gone.code, 1);
  assert.equal(
    gone.stdout,
    `Issue #${tokenFixture.goneIssueNumber} was not found in ${owned}.\n`,
  );
  await record(
    "tokenの無い非公開のForgejoでは登録の案内を返し、連携で登録した後は読めて、tokenはCLIの環境と答えに出ず、消えたIssueはその物が無いと返す",
  );

  // An ASCII title becomes the number and the delegated worktree's name.
  const ascii = issueWorktreeName(
    tokenFixture.issueNumber,
    "Keep the token out of the logs",
  );
  await openSidebar(screen);
  await screen.click(issuesButton(tokenFixture.clonePath));
  await screen.reveal(row(tokenFixture.issueNumber));
  await screen.click(row(tokenFixture.issueNumber), { scroll: false });
  await screen.wait(detail(tokenFixture.issueNumber));
  const start = `${detail(tokenFixture.issueNumber)} ${action("issue-start")}`;
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(start)})?.disabled === false`,
    ),
  );
  await screen.click(start);
  await screen.wait(creator);
  await waitFor(
    () => screen.value(field("worktree-name")),
    (value) => value === ascii,
    undefined,
    "ASCIIの題名を番号と整えた題名の名前にする",
  );
  await capture("pc-issue-start-ascii-creator");
  await wide("wqhd-issue-start-ascii-creator");
  await screen.click(action("worktree-create-close"));
  if (process.env.IORI_START_CAPTURE === "1") {
    await mobile({ width: 390, height: 844 });
    await openSidebar(screen);
    await screen.tap(issuesButton(tokenFixture.clonePath));
    await closeSidebar(screen);
    await screen.wait(detail(tokenFixture.issueNumber));
    await screen.tap(start);
    await screen.wait(creator);
    await capture("phone-issue-start-ascii-creator");
    await screen.tap(action("worktree-create-close"));
    await desktop();
  }
  await record(
    "ASCIIの題名のIssueから開いた作成画面は、番号とdelegateと同じ整え方の題名を名前にする",
    { name: ascii },
  );
}
