import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { linkGit, writeFakeCli } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { forgeFixture } from "../../verification/host/forge-fixture.mjs";
import {
  registerAutomationCli,
  automationCommand,
} from "../../verification/host/automation-definition.mjs";

const listParams = (path, changes = {}) => ({
  path,
  state: "open",
  labels: [],
  page: 1,
  ...changes,
});

test("ForgeのIssueを新しい順とページで読み、ラベルで絞る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const forge = await forgeFixture(t, dataRoot);
    stage("Clientと同じ口からIssueのページを読む");
    const first = await client.request(
      "forge.issues.list",
      listParams(forge.repository),
    );
    assert.deepEqual(
      first.issues.map((item) => item.number),
      [3, 2],
    );
    assert.equal(first.hasMore, true);
    const next = await client.request(
      "forge.issues.list",
      listParams(forge.repository, { page: 2 }),
    );
    assert.deepEqual(
      next.issues.map((item) => item.number),
      [1],
    );
    assert.equal(next.hasMore, false);
    const labelled = await client.request(
      "forge.issues.list",
      listParams(forge.repository, { labels: ["agent-ready"] }),
    );
    assert.deepEqual(
      labelled.issues.map((item) => item.number),
      [2],
    );
    assert.ok(
      labelled.issues.every((issue) =>
        issue.labels.some((label) => label.name === "agent-ready"),
      ),
    );
    assert.ok(
      forge.requests.some((request) => request.query.get("type") === "issues"),
    );
  }));

test("ForgeのIssueの本文とコメントを読み、削除されたIssueは空で返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const { issue } = await client.request("forge.issues.show", {
      path: forge.repository,
      number: 2,
    });
    assert.equal(issue.body, "Issue body");
    assert.deepEqual(
      issue.thread.map((comment) => comment.body),
      ["First comment"],
    );
    forge.state.gone = true;
    assert.equal(
      (
        await client.request("forge.issues.show", {
          path: forge.repository,
          number: 2,
        })
      ).issue,
      undefined,
    );
  }));

test("ForgeのCIはpush先のcommitの実行とjobとログを返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const ci = await client.request("forge.ci", { path: forge.repository });
    assert.equal(ci.commit.sha, forge.sha);
    assert.equal(ci.runs[0].id, "7");
    assert.equal(ci.runs[0].jobs[0].id, "9");
    assert.equal(ci.runs[0].jobs[0].status, "failed");
    const log = await client.request("forge.ci.log", {
      path: forge.repository,
      job: "9",
    });
    assert.equal(log.text, "first line\n⚙️ failed\nlast line\n");
  }));

test("外部のForgeから形の違うIssue一覧が届いたら返さない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.malformed = true;
    await assert.rejects(
      client.request("forge.issues.list", listParams(forge.repository)),
      /Host request failed: forge\.issues\.list \(read_failed\)/u,
    );
  }));

async function forgeCli(client, dataRoot, forge) {
  const cliId = await registerAutomationCli(client, dataRoot);
  const { terminal: created } = await client.request("cli.launch", {
    cliId,
    cwd: forge.repository,
  });
  const terminal = await client.terminal(created.id);
  await terminal.output("AUTOMATION_READY");
  return terminal;
}

test("単独CLIのiori issue showは本文とコメントを返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const terminal = await forgeCli(client, dataRoot, forge);
    const shown = await automationCommand(terminal, "show", [
      "issue",
      "show",
      "2",
      "--json",
    ]);
    assert.equal(shown.code, 0);
    const { issue } = JSON.parse(shown.stdout).data;
    assert.equal(issue.title, "Issue 2");
    assert.equal(issue.body, "Issue body");
    assert.deepEqual(
      issue.comments.map((comment) => comment.body),
      ["First comment"],
    );
    const text = await automationCommand(terminal, "text", [
      "issue",
      "show",
      "2",
    ]);
    assert.ok(text.stdout.startsWith("#2 Issue 2\n"));
    assert.ok(text.stdout.includes("Issue body"));
    forge.state.gone = true;
    const gone = await automationCommand(terminal, "gone", [
      "issue",
      "show",
      "2",
    ]);
    assert.equal(gone.code, 1);
    assert.equal(gone.stdout, "Issue #2 was not found in owner/repo.\n");
  }));

test("単独CLIのiori ci listとlogはpush先のCIと失敗したjobのログを返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const terminal = await forgeCli(client, dataRoot, forge);
    const ci = await automationCommand(terminal, "ci", [
      "ci",
      "list",
      "--json",
    ]);
    assert.equal(JSON.parse(ci.stdout).data.commit.sha, forge.sha);
    const defaultLog = await automationCommand(terminal, "failed", [
      "ci",
      "log",
      "--json",
    ]);
    assert.deepEqual(
      JSON.parse(defaultLog.stdout).data.jobs.map((job) => job.id),
      ["9"],
    );
    assert.equal(
      JSON.parse(defaultLog.stdout).data.jobs[0].log,
      "first line\n⚙️ failed\nlast line\n",
    );
    const log = await automationCommand(terminal, "log", ["ci", "log", "9"]);
    assert.equal(log.stdout, "first line\n⚙️ failed\nlast line\n\n");
    forge.git("branch", "--unset-upstream");
    const noPushList = await automationCommand(terminal, "no-push-list", [
      "ci",
      "list",
    ]);
    const noPushLog = await automationCommand(terminal, "no-push-log", [
      "ci",
      "log",
      "9",
    ]);
    assert.equal(noPushLog.stdout, noPushList.stdout);
    assert.match(noPushLog.stdout, /This branch has no push target/u);
  }));

function failedJobs(forge, ...jobs) {
  forge.state.ci[forge.sha] = {
    status: "failure",
    run: 7,
    value: {
      id: 7,
      index_in_repo: 7,
      commit_sha: forge.sha,
      workflow_id: "build.yml",
      status: "failure",
      event: "push",
    },
    jobs: jobs.map((id) => ({ id, name: `job ${id}`, status: "failure" })),
  };
}

test("Forgeに含まれる端末制御列はAgentのコマンド出力から除く", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot, { web: true });
    forge.issues[0].title = "Issue \x1b[31mcolored\x1b[0m";
    forge.issues[0].body = "Issue \x1b]0;metadata\x07body";
    forge.comments[0].body = "Comment \x1bPmetadata\x1b\\ok";
    forge.state.log =
      "Log\x1b]0;metadata\x07\n\t\x9b31mred\x1b[0m\x9fmetadata\x9c\x00\r\n";
    failedJobs(forge, 9);
    forge.state.ci[forge.sha].jobs[0].name = "job \x1b[31m9\x1b[0m";
    const terminal = await forgeCli(client, dataRoot, forge);
    const log = await automationCommand(terminal, "plain-log", [
      "ci",
      "log",
      "9",
    ]);
    assert.equal(log.stdout, "Log\n\tred\n\n");
    const list = await automationCommand(terminal, "plain-list", [
      "issue",
      "list",
      "--limit",
      "1",
    ]);
    assert.match(list.stdout, /#75 Issue colored \[bug\] · open/u);
    const issue = await automationCommand(terminal, "plain-issue", [
      "issue",
      "show",
      "75",
    ]);
    assert.match(issue.stdout, /^#75 Issue colored$/mu);
    assert.match(issue.stdout, /^Issue body$/mu);
    assert.match(issue.stdout, /^Comment ok$/mu);
    const ci = await automationCommand(terminal, "plain-ci", ["ci", "list"]);
    assert.match(ci.stdout, /^  failed  job 9 · job 9$/mu);
  }));

test("Agentは大きなCIログを末尾から読み、beforeで前の出力を取得できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot, { web: true });
    forge.state.log = `first line\n${"確認中🙂\n".repeat(6_000)}last line\n`;
    failedJobs(forge, 9, 10);
    const terminal = await forgeCli(client, dataRoot, forge);
    const log = await automationCommand(terminal, "log-tail", [
      "ci",
      "log",
      "9",
    ]);
    assert.equal(log.code, 0);
    assert.ok(Buffer.byteLength(log.stdout.trimEnd()) <= 64 * 1024);
    assert.doesNotMatch(log.stdout, /first line|\uFFFD/u);
    assert.match(log.stdout, /last line\n/u);
    const before = /iori ci log 9 --before (\d+)/u.exec(log.stdout)?.[1];
    assert.ok(before);
    const earlier = await automationCommand(terminal, "log-earlier", [
      "ci",
      "log",
      "9",
      "--before",
      before,
    ]);
    assert.equal(earlier.code, 0);
    assert.match(earlier.stdout, /^first line\n/u);
    assert.doesNotMatch(earlier.stdout, /last line|\uFFFD/u);
    const failed = await automationCommand(terminal, "failed-tail", [
      "ci",
      "log",
    ]);
    assert.equal(failed.code, 0);
    assert.ok(Buffer.byteLength(failed.stdout.trimEnd()) <= 64 * 1024);
    assert.match(failed.stdout, /iori ci log 10/u);
    // The Forge fixture returns HTTP 200 even when the requested window is smaller.
    forge.state.log = `${"確認中🙂\n".repeat(30_000)}last line\n`;
    const window = await client.request("forge.ci.log", {
      path: forge.repository,
      job: "9",
    });
    assert.equal(window.end, Buffer.byteLength(forge.state.log));
    assert.ok(window.start > 0);
    assert.match(window.text, /last line\n$/u);
  }));

test("Agentは大きなIssueのコメントの続きに移動できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot, { web: true });
    forge.comments[0].body = `First comment\n${"確認🙂".repeat(3_500)}`;
    forge.comments[1].body = `Second comment\n${"詳細🙂".repeat(3_500)}`;
    const terminal = await forgeCli(client, dataRoot, forge);
    const issue = await automationCommand(terminal, "issue-first", [
      "issue",
      "show",
      "75",
    ]);
    assert.equal(issue.code, 0);
    assert.ok(Buffer.byteLength(issue.stdout.trimEnd()) <= 64 * 1024);
    assert.match(issue.stdout, /First comment/u);
    assert.doesNotMatch(issue.stdout, /Second comment|\uFFFD/u);
    const offset = /iori issue show 75 --comments-offset (\d+)/u.exec(
      issue.stdout,
    )?.[1];
    assert.equal(offset, "1");
    const next = await automationCommand(terminal, "issue-next", [
      "issue",
      "show",
      "75",
      "--comments-offset",
      offset,
      "--comments-limit",
      "1",
    ]);
    assert.equal(next.code, 0);
    assert.match(next.stdout, /Second comment/u);
    assert.doesNotMatch(next.stdout, /First comment|\uFFFD/u);
  }));

test("チーム外のCLIのioriはForgeを案内しチーム専用コマンドには理由を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const terminal = await forgeCli(client, dataRoot, forge);
    const help = await automationCommand(terminal, "help", ["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /iori issue list/u);
    assert.match(help.stdout, /^iori ci log \[JOB_ID\] \[--before N\]$/mu);
    assert.doesNotMatch(help.stdout, /iori delegate|iori report/u);
    const tasks = await automationCommand(terminal, "tasks", ["tasks"]);
    assert.equal(tasks.code, 1);
    assert.match(tasks.stdout, /Only a CLI in an iori team conversation/u);
  }));

test("既定ブランチのCLIからPRを作ろうとすると理由を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const cliId = await registerAutomationCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: forge.repository,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("AUTOMATION_READY");
    const result = await automationCommand(terminal, "pr", [
      "pr",
      "create",
      "--title",
      "Change",
    ]);
    assert.equal(result.code, 1);
    assert.match(
      result.stdout,
      /Cannot create a Pull request from the default branch \(main\)/u,
    );
  }));

test("PR作成のpush先がタグならpushせずに理由を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.git("checkout", "-b", "feature");
    forge.git(
      "config",
      "remote.origin.push",
      "refs/heads/feature:refs/tags/v1",
    );
    assert.equal(
      forge.git(
        "for-each-ref",
        "--format=%(push:remoteref)",
        "refs/heads/feature",
      ),
      "refs/tags/v1",
    );
    const terminal = await forgeCli(client, dataRoot, forge);
    const result = await automationCommand(terminal, "tag-pr", [
      "pr",
      "create",
      "--title",
      "Change",
    ]);
    assert.equal(result.code, 1);
    assert.equal(
      forge.requests.some(({ path }) => path.startsWith("/owner/repo.git/")),
      false,
    );
    assert.match(
      result.stdout,
      /The Git push destination must be a valid branch/u,
    );
  }));

test("別名remoteのWebサイトをHostへ保存すると再起動後もForgeを読める", (t) =>
  runHostTest(t, async ({ client, dataRoot, restart }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.git("remote", "set-url", "origin", "forge-alias:owner/repo.git");
    await client.request("forge.mapping.set", {
      remoteHost: "forge-alias",
      webUrl: forge.origin,
    });
    client = await restart();
    const { repository } = await client.request("forge.issues.repository", {
      path: forge.repository,
    });
    assert.equal(repository.owner, "owner");
    assert.equal(repository.url, `${forge.origin}/owner/repo/issues`);
    assert.equal(
      (await client.request("forge.ci", { path: forge.repository })).commit.sha,
      forge.sha,
    );
  }));

test("iori issue listの既定30件とlimitと全ラベルの条件をCLIから使える", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.issueCount = 35;
    const cliId = await registerAutomationCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: forge.repository,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("AUTOMATION_READY");
    const defaultList = JSON.parse(
      (
        await automationCommand(terminal, "default", [
          "issue",
          "list",
          "--json",
        ])
      ).stdout,
    ).data;
    assert.equal(defaultList.repository.owner, "owner");
    assert.equal(defaultList.issues.length, 30);
    assert.ok(defaultList.issues.every((issue) => issue.state === "open"));
    assert.equal(defaultList.more, true);
    assert.equal(defaultList.issues[0].number, 35);
    const limited = JSON.parse(
      (
        await automationCommand(terminal, "limit", [
          "issue",
          "list",
          "--limit",
          "2",
          "--json",
        ])
      ).stdout,
    ).data;
    assert.equal(limited.issues.length, 2);
    assert.equal(limited.more, true);
    const text = await automationCommand(terminal, "text", [
      "issue",
      "list",
      "--limit",
      "2",
    ]);
    const lines = text.stdout.trimEnd().split("\n");
    assert.equal(
      lines[0],
      "Open Issues of owner/repo (Forgejo), newest first:",
    );
    assert.match(lines[1], /^#35 /u);
    assert.equal(lines.length, 4);
    assert.equal(lines.at(-1), "More Issues exist; use --limit to show more.");
    const labelled = JSON.parse(
      (
        await automationCommand(terminal, "single-label", [
          "issue",
          "list",
          "--label",
          "agent-ready",
          "--json",
        ])
      ).stdout,
    ).data;
    assert.equal(labelled.issues[0].number, 2);
    assert.ok(
      labelled.issues.every((issue) => issue.labels.includes("agent-ready")),
    );
    const absent = JSON.parse(
      (
        await automationCommand(terminal, "labels", [
          "issue",
          "list",
          "--label",
          "agent-ready",
          "--label",
          "missing",
          "--json",
        ])
      ).stdout,
    ).data;
    assert.deepEqual(absent.issues, []);
    const absentText = await automationCommand(terminal, "absent", [
      "issue",
      "list",
      "--label",
      "missing",
    ]);
    assert.equal(
      absentText.stdout,
      "There are no open Issues with the label missing in owner/repo.\n",
    );
    assert.ok(
      forge.requests.some(
        (request) =>
          request.query.get("state") === "open" &&
          request.query.get("labels") === "agent-ready,missing",
      ),
    );
  }));

test("Forgeの監視はpush先のPRとCIのアイコンを接続中のClientへ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.pull = true;
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await client.request("forge.watch", {
      paths: [forge.repository],
      selected: forge.repository,
    });
    const event = await events.waitFor(
      (event) =>
        event.type === "forge.changed" &&
        event.path === forge.repository &&
        event.status.checks,
    );
    assert.equal(event.status.checks.state, "failed");
    assert.equal(event.status.pullRequest.number, 5);
    assert.equal(event.status.pullRequest.state, "open");
    assert.equal(
      event.status.pullRequest.url,
      `${forge.origin}/owner/repo/pulls/5`,
    );
  }));

test("CIがないコミットでもForgeの監視でPRのアイコンを知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.state.pull = true;
    forge.state.noStatuses = true;
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await client.request("forge.watch", {
      paths: [forge.repository],
      selected: forge.repository,
    });
    const event = await events.waitFor(
      (event) =>
        event.type === "forge.changed" &&
        event.path === forge.repository &&
        event.status.pullRequest,
    );
    assert.equal(event.status.pullRequest.number, 5);
    assert.equal(event.status.pullRequest.state, "open");
    assert.equal(event.status.checks, undefined);
  }));

test("headを無視するForgeでもPRのアイコンを知らせ一覧の2ページ目以降を読まない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.git("checkout", "-b", "feature/gitea-pr");
    forge.git("update-ref", "refs/remotes/origin/feature/gitea-pr", forge.sha);
    forge.git("config", "branch.feature/gitea-pr.remote", "origin");
    forge.git(
      "config",
      "branch.feature/gitea-pr.merge",
      "refs/heads/feature/gitea-pr",
    );
    forge.state.pullPages = [
      [
        {
          number: 99,
          state: "open",
          html_url: `${forge.origin}/owner/repo/pulls/99`,
          base: { ref: "main" },
          head: {
            ref: "other-branch",
            sha: forge.sha,
            repo: { full_name: "owner/repo" },
          },
        },
      ],
      [
        {
          number: 42,
          state: "open",
          html_url: `${forge.origin}/owner/repo/pulls/42`,
          base: { ref: "main" },
          head: {
            ref: "feature/gitea-pr",
            sha: forge.sha,
            repo: { full_name: "owner/repo" },
          },
        },
      ],
    ];
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await client.request("forge.watch", {
      paths: [forge.repository],
      selected: forge.repository,
    });
    const event = await events.waitFor(
      (event) =>
        event.type === "forge.changed" &&
        event.path === forge.repository &&
        event.status.pullRequest,
    );
    assert.equal(event.status.pullRequest.number, 42);
    assert.equal(event.status.pullRequest.state, "open");
    assert.equal(
      event.status.pullRequest.url,
      `${forge.origin}/owner/repo/pulls/42`,
    );
    assert.equal(
      forge.requests.some(
        (request) =>
          request.path.endsWith("/pulls") &&
          Number(request.query.get("page") ?? 1) > 1,
      ),
      false,
    );
  }));

test("監視を再開してもpush先がなくなったブランチのアイコンは再表示しない", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const initial = await client.events();
    await initial.waitFor((event) => event.type === "snapshot");
    await client.request("forge.watch", {
      paths: [forge.repository],
      selected: forge.repository,
    });
    await initial.waitFor(
      (event) =>
        event.type === "forge.changed" &&
        event.path === forge.repository &&
        event.status.checks,
    );
    await client.request("forge.watch", { paths: [] });
    forge.git("branch", "--unset-upstream");
    const count = forge.requests.length;
    const events = await client.events();
    await events.waitFor((event) => event.type === "snapshot");
    await client.request("forge.watch", {
      paths: [forge.repository],
      selected: forge.repository,
    });
    const event = await events.waitFor(
      (event) =>
        event.type === "forge.changed" && event.path === forge.repository,
    );
    assert.deepEqual(event.status, {});
    assert.equal(forge.requests.length, count);
  }));

test(
  "GitHubは選択したghアカウントで読み、保存済みアカウントがなければ環境変数で読める",
  { skip: process.platform === "win32" ? "台本のghはPOSIX専用" : false },
  (t) =>
    runHostTest(
      t,
      async ({ client, dataRoot }) => {
        const forge = await forgeFixture(t, dataRoot);
        forge.git(
          "remote",
          "set-url",
          "origin",
          "https://github.com/example/repository.git",
        );
        const bin = join(dataRoot, "bin");
        const accountsFile = join(bin, "gh-accounts");
        await writeFile(accountsFile, "active,other");
        await writeFakeCli(
          bin,
          "gh",
          `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
const accountsFile = join(import.meta.dirname, "gh-accounts");
const accounts = existsSync(accountsFile)
  ? readFileSync(accountsFile, "utf8").split(",")
  : [];
const args = process.argv.slice(2);
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (args[0] === "auth" && args[1] === "status") {
  const logins = token ? [token, ...accounts] : accounts;
  console.log(JSON.stringify(logins.map((login, index) => ({
    login, active: index === 0, state: "success",
  }))));
} else if (args[0] === "auth" && args[1] === "token") {
  const user = args[args.indexOf("--user") + 1];
  if (token || !accounts.includes(user)) process.exit(1);
  console.log(user);
} else if (args[0] === "api" && args.at(-1).startsWith("/repos/example/repository/labels?")) {
  const login = token || accounts[0];
  console.log(JSON.stringify([[{ name: login, color: "abcdef" }]]));
} else {
  process.exit(1);
}
`,
        );
        const select = (githubAccount) =>
          client.request("repository.git.set", {
            path: forge.repository,
            githubAccount,
          });
        const label = async () =>
          (
            await client.request("forge.issues.labels", {
              path: forge.repository,
            })
          ).labels[0].name;
        await select("active");
        assert.equal(await label(), "active");
        await select("other");
        assert.equal(await label(), "other");
        await select("");
        assert.equal(await label(), "active");
        const { accounts } = await client.request("github.accounts");
        assert.deepEqual(
          accounts.map(({ login, active }) => ({ login, active })),
          [
            { login: "active", active: true },
            { login: "other", active: false },
          ],
        );
        await rm(accountsFile);
        assert.deepEqual(
          (await client.request("github.accounts")).accounts,
          [],
        );
        assert.equal(await label(), "environment");
      },
      { environment: { GH_TOKEN: "environment", GITHUB_TOKEN: "fallback" } },
    ),
);

const installedGh = (() => {
  try {
    return execFileSync("which", ["gh"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
})();

test(
  "ghにログインしていないHostのCLIはログインの案内を返す",
  { skip: installedGh ? false : "この環境に gh が入っていない" },
  (t) =>
    runHostTest(t, async ({ client, dataRoot }) => {
      const forge = await forgeFixture(t, dataRoot);
      await symlink(installedGh, join(dataRoot, "bin", "gh"));
      forge.git(
        "remote",
        "set-url",
        "origin",
        "https://github.com/example/repository.git",
      );
      const terminal = await forgeCli(client, dataRoot, forge);
      const result = await automationCommand(terminal, "github", [
        "issue",
        "list",
      ]);
      assert.equal(result.code, 1);
      assert.equal(
        result.stdout,
        "This Host's gh is not signed in to GitHub. Run gh auth login in a Terminal on this Host.\n",
      );
    }),
);

test("remoteの無いリポジトリでiori issue listはremote追加の案内を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    await linkGit(join(dataRoot, "bin"));
    const repo = join(dataRoot, "local-repo");
    await mkdir(repo);
    execFileSync("git", ["-C", repo, "init", "-b", "main"], { stdio: "pipe" });
    const cliId = await registerAutomationCli(client, dataRoot);
    const { terminal: created } = await client.request("cli.launch", {
      cliId,
      cwd: repo,
    });
    const terminal = await client.terminal(created.id);
    await terminal.output("AUTOMATION_READY");
    const list = await automationCommand(terminal, "no-remote-list", [
      "issue",
      "list",
    ]);
    assert.equal(list.code, 1);
    assert.equal(
      list.stdout,
      "This repository has no remote. Add a remote with git remote add, then try again.\n",
    );
    const show = await automationCommand(terminal, "no-remote-show", [
      "issue",
      "show",
      "1",
    ]);
    assert.equal(show.code, 1);
    assert.equal(
      show.stdout,
      "This repository has no remote. Add a remote with git remote add, then try again.\n",
    );
  }));

function samplePull(origin, branch, changes = {}) {
  return {
    number: 42,
    title: "Change",
    body: "Description",
    state: "open",
    user: { login: "author" },
    head: { ref: branch, repo: { full_name: "owner/repo" } },
    base: { ref: "release" },
    html_url: `${origin}/owner/repo/pulls/42`,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    labels: [{ name: "fix", color: "aabbcc" }],
    ...changes,
  };
}

test("GitHubのPR詳細でファイル・レビュー・返信先と行を表示できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const origin = "https://github.com";
    forge.git("remote", "set-url", "origin", `${origin}/owner/repo.git`);
    forge.git("switch", "-c", "feature/ui");
    const pull = samplePull(origin, "feature/ui", { draft: true });
    const review = {
      id: 12,
      user: { login: "reviewer" },
      state: "CHANGES_REQUESTED",
    };
    const comment = {
      id: 2,
      user: review.user,
      body: "Reply",
      created_at: pull.created_at,
      line: 11,
      side: "LEFT",
      path: "new.txt",
      diff_hunk: "@@ -11 +12 @@",
      in_reply_to_id: 1,
      html_url: "https://example.invalid/comment",
    };
    const bin = join(dataRoot, "bin");
    await writeFile(
      join(bin, "pr-responses.json"),
      JSON.stringify({
        "/repos/owner/repo/pulls": [
          samplePull(origin, "feature/ui", {
            state: "closed",
            updated_at: "2026-02-01T00:00:00Z",
            number: 77,
          }),
          pull,
        ],
        "/repos/owner/repo/pulls/42/files": [
          {
            filename: "new.txt",
            previous_filename: "old.txt",
            status: "renamed",
            additions: 2,
            deletions: 1,
          },
        ],
        "/repos/owner/repo/issues/42/comments": [
          { ...comment, id: 3, body: "Discussion" },
        ],
        "/repos/owner/repo/pulls/42/comments": [comment],
        "/repos/owner/repo/pulls/42/reviews": [review],
      }),
    );
    await writeFakeCli(
      bin,
      "gh",
      `
import {readFileSync} from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") console.log(JSON.stringify([{login:"owner", active:true, state:"success"}]));
else {
  const url = new URL(args.at(-1), "https://github.com");
  if (url.pathname.endsWith("/pulls") && (url.searchParams.get("head") !== "owner:feature/ui" || url.searchParams.get("state") !== "all")) process.exit(1);
  const values = JSON.parse(readFileSync(new URL("./pr-responses.json", import.meta.url)))[url.pathname];
  if (!values) process.exit(1);
  console.log(JSON.stringify(args.includes("--slurp") ? [values] : values));
}`,
    );
    const { pr, canCreate } = await client.request("forge.pr", {
      path: forge.repository,
    });
    assert.equal(canCreate, false);
    assert.equal(pr.state, "draft");
    assert.equal(pr.number, 42);
    assert.equal(pr.baseBranch, "release");
    assert.deepEqual(pr.labels, [{ name: "fix", color: "#aabbcc" }]);
    assert.deepEqual(pr.files, [
      {
        path: "new.txt",
        oldPath: "old.txt",
        status: "renamed",
        additions: 2,
        deletions: 1,
      },
    ]);
    assert.deepEqual(pr.reviewers, [
      { login: "reviewer", state: "changes_requested" },
    ]);
    assert.equal(pr.comments.find((row) => !row.path).body, "Discussion");
    assert.deepEqual(
      pr.comments.find((row) => row.path),
      {
        id: "2",
        body: "Reply",
        author: "reviewer",
        createdAt: Date.parse(pull.created_at),
        path: "new.txt",
        side: "old",
        line: 11,
        diffHunk: "@@ -11 +12 @@",
        inReplyToId: "1",
      },
    );
  }));

test("ForgejoのPR詳細で同名のforkを除き、終了したPRから次の作成へ進める", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    forge.git("switch", "-c", "feature");
    const merged = samplePull(forge.origin, "feature", {
      state: "closed",
      merged: true,
    });
    forge.state.pullPages = [
      [
        samplePull(forge.origin, "feature", {
          head: { ref: "feature", repo: { full_name: "fork/repo" } },
        }),
        merged,
      ],
    ];
    const user = { login: "reviewer" };
    forge.state.prFiles = [
      { filename: "removed.txt", status: "deleted", deletions: 2 },
    ];
    forge.state.prReviews = [
      { id: 7, user, state: "REQUEST_CHANGES" },
      { id: 8, user: { login: "other" }, state: "COMMENT" },
    ];
    forge.state.prReviewComments = {
      7: [
        {
          id: 9,
          user,
          created_at: merged.created_at,
          body: "Review this",
          path: "removed.txt",
          position: 0,
          original_position: 2,
          diff_hunk: "@@ -2 +0 @@",
        },
      ],
    };
    const { pr, canCreate, branches, defaultBranch } = await client.request(
      "forge.pr",
      { path: forge.repository },
    );
    assert.equal(pr.state, "merged");
    assert.equal(pr.title, "Change");
    assert.equal(canCreate, true);
    assert.equal(defaultBranch, "main");
    assert.ok(branches.includes("release"));
    assert.equal(pr.files[0].status, "deleted");
    assert.deepEqual(pr.reviewers[0], {
      login: "reviewer",
      state: "changes_requested",
    });
    const inline = pr.comments.find((row) => row.path);
    assert.equal(inline.body, "Review this");
    assert.equal(inline.line, 2);
    assert.equal(inline.side, "old");
  }));

async function localPushRemote(forge, dataRoot, url) {
  const bare = join(dataRoot, "remote.git");
  forge.git("init", "--bare", bare);
  const bin = join(dataRoot, "bin");
  await writeFakeCli(
    bin,
    "local-receive",
    `
import {spawnSync} from "node:child_process";
process.exit(spawnSync("git", ["receive-pack", ${JSON.stringify(bare)}], {stdio:"inherit"}).status ?? 1);
`,
  );
  forge.git("config", "core.sshCommand", "local-receive");
  forge.git("config", "ssh.variant", "ssh");
  forge.git("remote", "set-url", "origin", url);
  return bare;
}

test("未pushのブランチからDraft・ベースを指定してPRを作成し、既存のPRを再利用する", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const bare = await localPushRemote(
      forge,
      dataRoot,
      "forge-alias:owner/repo.git",
    );
    await client.request("forge.mapping.set", {
      remoteHost: "forge-alias",
      webUrl: forge.origin,
    });
    await client.request("forge.token.set", {
      origin: forge.origin,
      token: forge.token,
    });
    const path = forge.repository;
    const create = (params) =>
      client.request("forge.pr.create", {
        path,
        title: "Change",
        body: "Notes",
        ...params,
      });
    assert.equal(
      (await client.request("forge.pr", { path })).reason,
      "default_branch",
    );
    await assert.rejects(create({ base: "release" }), /git_failed/u);
    for (const [branch, draft] of [
      ["topic", false],
      ["next", true],
    ]) {
      forge.git("switch", "-c", branch);
      const view = await client.request("forge.pr", { path });
      assert.equal(view.currentBranch, branch);
      assert.equal(view.canCreate, true);
      await assert.rejects(
        create({ base: branch }),
        /\(git_failed\):.*different from the work branch/u,
      );
      await assert.rejects(
        create({ base: "bad..branch" }),
        /\(git_failed\):.*valid branch name/u,
      );
      assert.deepEqual(await create({ draft, base: "release", issue: 3 }), {
        url: `${forge.origin}/owner/repo/pulls/42`,
        created: true,
      });
      assert.deepEqual(forge.state.createdPull, {
        head: branch,
        base: "release",
        title: draft ? "WIP: Change" : "Change",
        body: "Notes\n\nCloses #3",
      });
      assert.equal(
        forge.git("--git-dir", bare, "rev-parse", `refs/heads/${branch}`),
        forge.sha,
      );
      forge.state.pullPages = [[samplePull(forge.origin, branch)]];
      assert.equal((await create({})).created, false);
    }
  }));

test("GitHubのPR作成で既定のDraftと選択したベース・通常のPRを送信できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    await localPushRemote(forge, dataRoot, "git@github.com:owner/repo.git");
    const bin = join(dataRoot, "bin");
    await writeFakeCli(
      bin,
      "gh",
      `
import {writeFileSync} from "node:fs";
const args=process.argv.slice(2);
if (args[0]==="auth" && args[1]==="status") console.log(JSON.stringify([{login:"owner",active:true,state:"success"}]));
else if (args.includes("POST") && args.includes("/repos/owner/repo/pulls")) {
  writeFileSync(new URL("./submitted.json",import.meta.url), JSON.stringify(args));
  console.log(JSON.stringify({html_url:"https://github.com/owner/repo/pull/42"}));
} else if (args.includes("/repos/owner/repo")) console.log(JSON.stringify({permissions:{push:true},default_branch:"main"}));
else if (args.at(-1).startsWith("/repos/owner/repo/pulls?")) console.log("[]");
else process.exit(1);`,
    );
    for (const [branch, params, expected] of [
      ["draft", {}, ["base=main", "draft=true"]],
      [
        "ready",
        { base: "release", draft: false },
        ["base=release", "draft=false"],
      ],
    ]) {
      forge.git("switch", "-c", branch);
      const result = await client.request("forge.pr.create", {
        path: forge.repository,
        title: "Change",
        body: "",
        ...params,
      });
      assert.deepEqual(result, {
        url: "https://github.com/owner/repo/pull/42",
        created: true,
      });
      const submitted = JSON.parse(
        await readFile(join(bin, "submitted.json"), "utf8"),
      );
      for (const field of expected) assert.ok(submitted.includes(field));
    }
  }));
