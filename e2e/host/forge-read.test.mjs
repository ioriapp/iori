import assert from "node:assert/strict";
import test from "node:test";
import { symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
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
  }));

test("チーム外のCLIのioriはForgeを案内しチーム専用コマンドには理由を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const forge = await forgeFixture(t, dataRoot);
    const terminal = await forgeCli(client, dataRoot, forge);
    const help = await automationCommand(terminal, "help", ["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /iori issue list/u);
    assert.match(help.stdout, /^iori ci log \[JOB_ID\]$/mu);
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

test("Forgeの監視はpush先のPRとCIの印を接続中のClientへ知らせる", (t) =>
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

test("CIがないコミットでもForgeの監視でPRの印を知らせる", (t) =>
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

test("push先がないブランチにはForgeの印を出さない", (t) =>
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
        event.type === "forge.changed" &&
        event.path === forge.repository &&
        !event.status.checks,
    );
    assert.deepEqual(event.status, {});
    assert.equal(forge.requests.length, count);
  }));

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
