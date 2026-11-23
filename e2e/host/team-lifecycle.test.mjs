import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { linkGit } from "../../verification/host/environment.mjs";
import { runHostTest } from "../../verification/host/process.mjs";
import { actorCommand } from "../../verification/host/scripted-definition.mjs";
import { registerLifecycleCli } from "../../verification/host/lifecycle-definition.mjs";
import { registerResponseCli } from "../../verification/host/response-definition.mjs";

async function setup(client, dataRoot, actions, limit = "", cwd = dataRoot) {
  const parentCli = await registerLifecycleCli(client, dataRoot, "parent");
  const candidates = [];
  for (const action of actions) {
    const cli =
      action === "trust"
        ? "muse-code"
        : action === "response"
          ? await registerResponseCli(client, dataRoot)
          : await registerLifecycleCli(client, dataRoot, action);
    candidates.push({ id: action, cli, model: "", tools: [], minimum: "" });
  }
  const team = await client.request("teams.create", {
    definition: {
      name: "Lifecycle",
      description: "",
      instruction: "",
      parent: {
        id: "parent",
        cli: parentCli,
        model: "",
        tools: [],
        minimum: "",
      },
      roles: [
        {
          id: "worker",
          name: "Worker",
          when: "",
          limit,
          reuse: true,
          split: false,
          instruction: "",
          request: "",
          report: "",
          candidates: { high: [], low: [], medium: candidates },
        },
      ],
    },
  });
  await client.request("teams.settings", {
    defaultTeam: team.saved.id,
    limits: {},
  });
  const events = await client.events();
  await events.waitFor((event) => event.type === "snapshot");
  const { terminal } = await client.request("team.launch", {
    teamId: team.saved.id,
    cwd,
  });
  const parent = await client.terminal(terminal.id);
  await parent.output("LIFECYCLE_READY:startup");
  await parent.output("LIFECYCLE_PARENT_INPUT:");
  return { parent, parentId: terminal.id, events };
}

test("追加したリポジトリのworktreeだけチーム起動時に信頼を渡す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    await linkGit(join(dataRoot, "bin"));
    const repositories = [join(dataRoot, "trusted"), join(dataRoot, "other")];
    for (const root of repositories) {
      await mkdir(root);
      const git = (...args) => execFileSync("git", ["-C", root, ...args]);
      git("init", "-b", "main");
      git("config", "user.name", "Worktree E2E");
      git("config", "user.email", "worktree@localhost");
      await writeFile(join(root, "source.txt"), "initial");
      git("add", ".");
      git("commit", "-m", "initial");
    }
    const script = join(dataRoot, "trust-cli.mjs");
    await writeFile(
      script,
      'console.log("TRUST_ARGS:" + JSON.stringify(process.argv.slice(2))); process.stdin.resume();',
    );
    await client.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "muse-code",
        name: "Muse Code",
        command: { shell: `'${process.execPath}' '${script}'` },
      }),
    });
    await client.request("folders.open", { path: repositories[0] });
    const context = await setup(
      client,
      dataRoot,
      ["trust"],
      "",
      repositories[0],
    );
    for (const [id, repo, trusted] of [
      ["added", repositories[0], true],
      ["other", repositories[1], false],
    ]) {
      const result = await actorCommand(context.parent, id, [
        "delegate",
        "--role",
        "Worker",
        "--difficulty",
        "low",
        "--title",
        id,
        "--worktree",
        "new",
        "--repo",
        repo,
        "--body",
        "Do the work.",
      ]);
      const child = await childTerminal(client, context, result.data.child);
      const output = await child.output(/TRUST_ARGS:.+\r?\n/u);
      const args = JSON.parse(output.match(/TRUST_ARGS:(.+)\r?\n/u)[1]);
      assert.equal(args.includes("--trust-workspace"), trusted);
    }
    const { terminal } = await client.request("cli.launch", {
      cliId: "muse-code",
      cwd: repositories[0],
    });
    const output = await (
      await client.terminal(terminal.id)
    ).output(/TRUST_ARGS:.+\r?\n/u);
    assert.equal(
      JSON.parse(output.match(/TRUST_ARGS:(.+)\r?\n/u)[1]).includes(
        "--trust-workspace",
      ),
      false,
    );
    await client.request("folders.sidebar.remove", { path: repositories[0] });
    const nestedRepository = join(dataRoot, "nested");
    const nestedFolder = join(nestedRepository, "docs");
    await mkdir(nestedFolder, { recursive: true });
    const openedFolder = await client.request("folders.open", {
      path: nestedFolder,
    });
    assert.equal(openedFolder.folder.workspacePath, nestedFolder);
    const sidebar = await client.request("folders.history", {});
    assert.deepEqual(
      sidebar.folders
        .filter((folder) => folder.inSidebar)
        .map((folder) => folder.workspacePath),
      [nestedFolder],
    );
    const nestedGit = (...args) =>
      execFileSync("git", ["-C", nestedRepository, ...args]);
    nestedGit("init", "-b", "main");
    nestedGit("config", "user.name", "Worktree E2E");
    nestedGit("config", "user.email", "worktree@localhost");
    await writeFile(join(nestedRepository, "source.txt"), "nested repository");
    nestedGit("add", ".");
    nestedGit("commit", "-m", "initial");
    const nestedResult = await actorCommand(context.parent, "nested-folder", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Nested folder",
      "--worktree",
      "new",
      "--repo",
      nestedRepository,
      "--body",
      "Do the work.",
    ]);
    const nestedChild = await childTerminal(
      client,
      context,
      nestedResult.data.child,
    );
    const nestedOutput = await nestedChild.output(/TRUST_ARGS:.+\r?\n/u);
    assert.equal(
      JSON.parse(nestedOutput.match(/TRUST_ARGS:(.+)\r?\n/u)[1]).includes(
        "--trust-workspace",
      ),
      false,
    );
  }));

test("別のリポジトリへの委譲は指定先にworktreeを作る", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    await linkGit(join(dataRoot, "bin"));
    const repositories = [join(dataRoot, "first"), join(dataRoot, "second")];
    for (const [index, root] of repositories.entries()) {
      await mkdir(root);
      const git = (...args) =>
        execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
      git("init", "-b", "main");
      git("config", "user.name", "Worktree E2E");
      git("config", "user.email", "worktree@localhost");
      await writeFile(join(root, "source.txt"), `repository ${index + 1}`);
      git("add", ".");
      git("commit", "-m", "initial");
    }
    const context = await setup(
      client,
      dataRoot,
      ["report-later"],
      "",
      repositories[0],
    );
    const result = await actorCommand(context.parent, "other-repository", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Other repository",
      "--worktree",
      "new",
      "--repo",
      repositories[1],
      "--body",
      "Do the work.",
    ]);
    const started = await context.events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === result.data.child &&
        event.child.terminalId,
    );
    const child = await client.terminal(started.child.terminalId);
    await child.output("LIFECYCLE_WORKING");
    const cwd = started.child.cwd;
    assert.ok(cwd);
    assert.equal(
      await readFile(join(cwd, "source.txt"), "utf8"),
      "repository 2",
    );
    const main = execFileSync(
      "git",
      ["-C", cwd, "rev-parse", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    assert.equal(resolve(main), join(repositories[1], ".git"));
  }));

test("委譲で子のために作成したworktreeだけをteams.childrenで区別できる", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    await linkGit(join(dataRoot, "bin"));
    const root = join(dataRoot, "repo");
    const feature = join(dataRoot, "feature");
    const existing = join(dataRoot, "existing");
    await mkdir(root);
    const git = (...args) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-b", "main");
    git(
      "-c",
      "user.name=Worktree E2E",
      "-c",
      "user.email=worktree@localhost",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    );
    git("worktree", "add", "-b", "feature", feature);
    git("worktree", "add", "-b", "existing", existing);

    const context = await setup(
      client,
      dataRoot,
      ["report-later"],
      "",
      feature,
    );
    const delegations = [];
    for (const worktree of ["new", "main", "existing"]) {
      const { child } = await delegate(
        context,
        worktree,
        "Do the work.",
        worktree,
      );
      await childTerminal(client, context, child);
      delegations.push({ worktree, child });
    }

    const { children } = await client.request("teams.children", {
      cwd: feature,
    });
    assert.deepEqual(
      Object.fromEntries(
        delegations.map(({ worktree, child }) => [
          worktree,
          children.find((entry) => entry.id === child)?.createdWorktree,
        ]),
      ),
      { new: true, main: false, existing: false },
    );
  }));

test("子のworktree作成中にも別の子が親のフォルダーで起動する", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    await linkGit(join(dataRoot, "bin"));
    const repo = join(dataRoot, "repo");
    await mkdir(repo);
    const git = (...args) =>
      execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    git("init", "-b", "main");
    git(
      "-c",
      "user.name=Worktree E2E",
      "-c",
      "user.email=worktree@localhost",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    );
    const context = await setup(client, dataRoot, ["report-later"], "", repo);
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      await writeFile(
        join(repo, ".git", "hooks", "post-checkout"),
        `#!${process.execPath}
require("node:net").connect(${server.address().port}, "127.0.0.1").resume();
`,
        { mode: 0o755 },
      );
      const connected = once(server, "connection", { signal: t.signal });
      const slow = await delegate(
        context,
        "slow",
        "Check the worktree.",
        "new",
      );
      const [socket] = await connected;
      t.signal.addEventListener("abort", () => socket.destroy(), {
        once: true,
      });
      try {
        stage("Git のフックが終了する前に別の子が最初の依頼を受け取る");
        const fast = await delegate(context, "fast");
        const child = await childTerminal(client, context, fast.child);
        await child.output("LIFECYCLE_WORKING");
      } finally {
        socket.end();
      }
      await (
        await childTerminal(client, context, slow.child)
      ).output("LIFECYCLE_WORKING");
    } finally {
      server.close();
    }
  }));

test("存在しないworktree名での委譲は使えるフォルダー名を示す", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    await linkGit(join(dataRoot, "bin"));
    const root = join(dataRoot, "repo");
    await mkdir(root);
    const git = (...args) =>
      execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
    git("init", "-b", "main");
    git("config", "user.name", "Worktree E2E");
    git("config", "user.email", "worktree@localhost");
    await writeFile(join(root, "source.txt"), "hello");
    git("add", ".");
    git("commit", "-m", "initial");
    git("worktree", "add", "-b", "alpha", join(dataRoot, "wt-alpha"));
    const context = await setup(client, dataRoot, ["report-later"], "", root);
    const result = await actorCommand(context.parent, "missing-worktree", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Missing worktree",
      "--worktree",
      "no-such-wt",
      "--body",
      "Do the work.",
    ]);
    const failed = await context.events.waitFor(
      (event) =>
        event.type === "teams.child.updated" &&
        event.child.id === result.data.child &&
        event.child.state !== "waiting" &&
        event.child.state !== "starting" &&
        event.child.state !== "queued",
    );
    // The failure notice is still being typed into the parent; wait until it
    // is submitted so the next command does not join the same line.
    await context.parent.output("wt-alpha");
    const tasksResult = await actorCommand(context.parent, "tasks-failed", [
      "tasks",
    ]);
    assert.match(JSON.stringify({ failed, tasksResult }), /wt-alpha/);
  }));
async function delegate(
  context,
  id,
  body = "Do the work.",
  worktree = "parent",
) {
  const result = await actorCommand(context.parent, id, [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    id,
    "--worktree",
    worktree,
    "--body",
    body,
  ]);
  return result.data;
}
async function childTerminal(client, context, id) {
  const event = await context.events.waitFor(
    (e) =>
      e.type === "teams.child.updated" &&
      e.child.id === id &&
      e.child.terminalId,
  );
  return client.terminal(event.child.terminalId);
}

test("指示ファイルの引数の無い CLI の子は、最初の文で指示ファイルと依頼を受け取る", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["capture-initial"]);
    stage("指示ファイルの引数が無いCLIへ委譲する");
    const task = await delegate(context, "initial", "Do the delegated work.");
    const child = await childTerminal(client, context, task.child);
    const { output } = await child.waitFor(({ output }) =>
      /LIFECYCLE_INITIAL:("[^\r\n]+")\r?\n/u.test(output),
    );
    const initial = JSON.parse(
      output.match(/LIFECYCLE_INITIAL:("[^\r\n]+")\r?\n/u)[1],
    );
    const match = initial.match(
      /^Read (.+) and follow its instructions\. Then open the file (.+) with your file-reading tool \(it is a normal file, not an iori command\) and follow the delegated request\.$/u,
    );
    assert.ok(match, `子の最初の文: ${initial}`);
    assert.match(await readFile(match[1], "utf8"), /iori report/u);
    assert.match(await readFile(match[2], "utf8"), /Do the delegated work\./u);
  }));

test("親の停止で上限待ちの子から待機情報が消える", (t) =>
  runHostTest(t, async ({ client, dataRoot }) => {
    const context = await setup(client, dataRoot, ["report-later"], "1");
    const first = await delegate(context, "first", "AUTO_REPORT_COMPLETED");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_WORKING");
    const queued = await delegate(context, "queued");
    assert.equal(queued.waiting, "capacity");
    await actorCommand(context.parent, "stop", ["stop", queued.child]);
    const tasks = await actorCommand(context.parent, "tasks", ["tasks"]);
    const stopped = tasks.data.children.find(
      (entry) => entry.child === queued.child,
    );
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.stoppedBy, "parent");
    assert.equal(stopped.waiting, undefined);
    assert.equal(stopped.waitingReasons, undefined);
  }));

test("親が終了すると上限待ちを取り消し、動いている子は続く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["report-later"], "1");
    stage("動作中の子と上限待ちの子を作る");
    const first = await delegate(context, "first", "AUTO_REPORT_COMPLETED");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_WORKING");
    const second = await delegate(context, "second");
    assert.equal(second.waiting, "capacity");
    stage("親CLIを終了し未起動の子が停止する");
    await context.parent.input("EXIT_NOW\r");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === second.child &&
        e.child.state === "stopped" &&
        e.child.stoppedBy === "parent_exit",
    );
    stage("動作中の子は報告できる");
    await writeFile(join(dataRoot, "release"), "done");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "reported",
    );
  }));

test("親が終了した後の子の報告を保留し再開後に読める", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["report-later"], "1");
    const first = await delegate(context, "first", "AUTO_REPORT_COMPLETED");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_WORKING");
    const queued = await delegate(context, "queued");
    assert.equal(queued.waiting, "capacity");
    stage("親CLIを終了後に子が報告する");
    await context.parent.input("EXIT_NOW\r");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === queued.child &&
        e.child.stoppedBy === "parent_exit",
    );
    await writeFile(join(dataRoot, "release"), "done");
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "reported",
    );
    stage("親を再開して保留通知と報告本文を読む");
    await client.request("cli.resume", { terminalId: context.parentId });
    const parent = await client.terminal(context.parentId);
    await parent.output("LIFECYCLE_READY:resume");
    const tasks = await actorCommand(parent, "tasks", ["tasks"]);
    assert.equal(
      tasks.data.children.find((entry) => entry.child === first.child)
        .parentNoticePending,
      true,
    );
    const report = await actorCommand(parent, "read", ["read", first.child]);
    assert.match(JSON.stringify(report), /Completed the work\./u);
    await delegate({ ...context, parent }, "after-resume");
    const acknowledged = await actorCommand(parent, "acknowledged", ["tasks"]);
    assert.equal(
      acknowledged.data.children.find((entry) => entry.child === first.child)
        .parentNoticePending,
      undefined,
    );
  }));

test("承認待ちの回答は停止後も残り、再開時に届く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["approval"]);
    const first = await delegate(context, "first");
    const child = await childTerminal(client, context, first.child);
    await child.output("LIFECYCLE_APPROVAL");
    const terminalId = (
      await client.request("teams.children", {})
    ).children.find((entry) => entry.id === first.child).terminalId;
    await context.events.waitFor(
      (e) =>
        e.type === "terminal.updated" &&
        e.terminal.id === terminalId &&
        e.terminal.cliStatus?.state === "waiting",
    );
    stage("承認待ちの子へ回答を送り、停止する");
    await actorCommand(context.parent, "answer", [
      "send",
      first.child,
      "--kind",
      "answer",
      "--body",
      "First answer.",
    ]);
    await actorCommand(context.parent, "stop", ["stop", first.child]);
    const pending = await actorCommand(context.parent, "pending", ["tasks"]);
    assert.equal(
      pending.data.children.find((entry) => entry.child === first.child)
        .pendingMessages,
      1,
    );
    stage("再開時に保留中の回答と次の回答が届く");
    const resumedEvents = await client.events();
    await resumedEvents.waitFor((e) => e.type === "snapshot");
    await actorCommand(context.parent, "resume", [
      "send",
      first.child,
      "--kind",
      "answer",
      "--body",
      "Second answer.",
    ]);
    await resumedEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "running",
    );
    const { output } = await client.terminalUntil(terminalId, ({ output }) =>
      output.includes("LIFECYCLE_DONE:2"),
    );
    assert.match(output, /First answer\./u);
    assert.match(output, /Second answer\./u);
    assert.ok(
      output.indexOf("First answer.") < output.indexOf("Second answer."),
    );
  }));

test("CLIの失敗後に直接入力すると作業中に戻り次の失敗も知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["failure"]);
    const first = await delegate(context, "first");
    const child = await childTerminal(client, context, first.child);
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "failed",
    );
    await context.parent.output("failed:");
    stage("利用者が子に直接入力する");
    const retryEvents = await client.events();
    await retryEvents.waitFor((e) => e.type === "snapshot");
    await child.input("Try again.\r");
    await retryEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "running",
    );
    await retryEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "failed",
    );
    await child.output("LIFECYCLE_FAILED:2");
    await context.parent.waitFor(
      ({ output }) => (output.match(/failed:/gu) ?? []).length >= 2,
    );
  }));

test("候補のCLIの失敗を次の候補への続行案内とともに親へ知らせる", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["failure", "response"]);
    stage("子のCLIが失敗し親が続行の案内を受け取る");
    const first = await delegate(context, "first");
    const notice = await context.parent.output(
      `delegate again with --continue ${first.task}`,
    );
    assert.match(notice, /Model unavailable/u);
  }));

test("実行中のタスクを続行すると前の子を停止して新しい子だけが動く", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["report-later"]);
    const first = await delegate(context, "first", "Original work.");
    const previous = await childTerminal(client, context, first.child);
    await previous.output("LIFECYCLE_WORKING");
    stage("実行中のタスクを新しい子へ引き継ぐ");
    const next = await actorCommand(context.parent, "continue-running", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Continue",
      "--worktree",
      "parent",
      "--continue",
      first.task,
      "--body",
      "Continue the work.",
    ]);
    assert.equal(next.data.task, first.task);
    assert.notEqual(next.data.child, first.child);
    const child = await childTerminal(client, context, next.data.child);
    const output = await child.output("LIFECYCLE_WORKING");
    assert.match(output, /Original work\./u);
    const tasks = await actorCommand(context.parent, "continued-tasks", [
      "tasks",
    ]);
    const children = tasks.data.children.filter(
      (entry) => entry.task === first.task,
    );
    assert.equal(
      children.find((entry) => entry.child === first.child).state,
      "stopped",
    );
    assert.deepEqual(
      children
        .filter((entry) => !["finished", "stopped"].includes(entry.state))
        .map((entry) => entry.child),
      [next.data.child],
    );
    const previousChild = (
      await client.request("teams.children", {})
    ).children.find((entry) => entry.id === first.child);
    const { terminals } = await client.request("terminal.list");
    const parentTerminal = terminals.find(
      (entry) => entry.id === context.parentId,
    );
    assert.equal(parentTerminal.teamName, "Lifecycle");
    const terminal = terminals.find(
      (entry) => entry.id === previousChild.terminalId,
    );
    assert.equal(terminal.teamName, undefined);
    assert.equal(terminal.state, "error");
  }));

test("失敗した候補の次の候補へ依頼と失敗理由を引き継ぐ", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    const context = await setup(client, dataRoot, ["failure", "response"], "1");
    stage("最初の候補が失敗する");
    const first = await delegate(
      context,
      "first",
      "Original work. AUTO_REPORT_COMPLETED",
    );
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "failed",
    );
    await context.parent.output("Model unavailable");
    stage("同じ仕事を続行し次の候補が元の依頼を読む");
    const next = await actorCommand(context.parent, "continue", [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Continue",
      "--worktree",
      "parent",
      "--continue",
      first.task,
      "--body",
      "Continue the work.",
    ]);
    assert.equal(next.data.task, first.task);
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "stopped" &&
        e.child.stoppedBy === "parent",
    );
    const child = await childTerminal(client, context, next.data.child);
    const output = await child.output("RESPONSE_TURN_DONE:1");
    const request = JSON.parse(output.match(/RESPONSE_BODY:(.+)\r?\n/u)[1]);
    assert.match(request, /Original work\./u);
    assert.match(request, /Model unavailable/u);
    await context.events.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === next.data.child &&
        e.child.state === "reported",
    );
    const report = await actorCommand(context.parent, "read", [
      "read",
      next.data.child,
    ]);
    assert.match(JSON.stringify(report), /Completed the work\./u);
  }));

test("OpenCode V2の再開は保留中の依頼を一つのpromptで渡し貼り付けない", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    stage("本物のPTYとhookを使うOpenCode V2の台本を用意する");
    const script = join(dataRoot, "opencode.mjs");
    const hook = fileURLToPath(
      new URL("../../apps/host/src/cli/hook-script.mjs", import.meta.url),
    );
    await writeFile(
      script,
      `
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("opencode v2.2.6");
} else {
  process.stdin.setRawMode(true);
  let input = "";
  process.stdin.on("data", data => {
    input += data;
    const check = input.indexOf("CHECK_INPUT");
    if (check >= 0) {
      console.log("OPENCODE_INPUT:" + JSON.stringify(input.slice(0, check)));
      input = "";
    }
  });
  const resume = args.includes("--session");
  const prompt = args[args.indexOf("--prompt") + 1];
  const files = resume
    ? prompt.match(/Open the files (.+?) with your file-reading tool/u)[1].split(" and ")
    : [];
  const hook = (event, extra = {}) => execFileSync(process.execPath, [${JSON.stringify(hook)}, event, "-"], {
    input: JSON.stringify({iori_cli: "opencode", sessionID: "session-child", ...extra}),
  });
  hook("session.status", {status: {type: "busy"}});
  if (!resume) hook("permission.asked", {id: "approval", permission: "bash"});
  process.stdout.write("\\x1b[?2004h\\x1b[?25h".replaceAll("\\x1b", "\u001b"));
  console.log((resume ? "OPENCODE_RESUME:" : "OPENCODE_START:") + JSON.stringify({args, bodies: files.map(file => readFileSync(file, "utf8"))}));
}
`,
    );
    await client.request("cli.definition.save", {
      definition: JSON.stringify({
        schema: 1,
        id: "opencode",
        name: "OpenCode",
        command: { shell: `'${process.execPath}' '${script}'` },
        version: { args: ["--version"] },
        launch: {
          initialPrompt: { mode: "argument", args: ["--prompt", "{prompt}"] },
        },
        resume: { args: ["--session", "{sessionId}"] },
      }),
    });
    // Keep the usual parent actor; only the worker candidate uses OpenCode.
    const parentCli = await registerLifecycleCli(client, dataRoot, "parent");
    const candidate = {
      id: "opencode-worker",
      cli: "opencode",
      model: "",
      tools: [],
      minimum: "",
    };
    const team = await client.request("teams.create", {
      definition: {
        name: "OpenCode resume",
        description: "",
        instruction: "",
        parent: { ...candidate, id: "parent", cli: parentCli },
        roles: [
          {
            id: "worker",
            name: "Worker",
            when: "",
            limit: "",
            reuse: true,
            split: false,
            instruction: "",
            request: "",
            report: "",
            candidates: { high: [], low: [], medium: [candidate] },
          },
        ],
      },
    });
    await client.request("teams.settings", {
      defaultTeam: team.saved.id,
      limits: {},
    });
    const events = await client.events();
    await events.waitFor((e) => e.type === "snapshot");
    const { terminal } = await client.request("team.launch", {
      teamId: team.saved.id,
      cwd: dataRoot,
    });
    const parent = await client.terminal(terminal.id);
    await parent.output("LIFECYCLE_PARENT_INPUT:");
    const context = { parent, events };
    const first = await delegate(context, "first");
    const child = await childTerminal(client, context, first.child);
    await child.output("OPENCODE_START:");
    stage("承認待ちの依頼を残して止める");
    await actorCommand(parent, "first-message", [
      "send",
      first.child,
      "--kind",
      "answer",
      "--body",
      "First answer.",
    ]);
    await actorCommand(parent, "stop", ["stop", first.child]);
    const pending = await actorCommand(parent, "pending", ["tasks"]);
    assert.equal(
      pending.data.children.find((entry) => entry.child === first.child)
        .pendingMessages,
      1,
    );
    stage("再開の一つのpromptに手引きと履歴と依頼が順に入る");
    const resumedEvents = await client.events();
    await resumedEvents.waitFor((e) => e.type === "snapshot");
    await actorCommand(parent, "resume", [
      "send",
      first.child,
      "--kind",
      "request",
      "--body",
      "Second request.",
    ]);
    await resumedEvents.waitFor(
      (e) =>
        e.type === "teams.child.updated" &&
        e.child.id === first.child &&
        e.child.state === "running",
    );
    const terminalId = (
      await client.request("teams.children", {})
    ).children.find((entry) => entry.id === first.child).terminalId;
    const resumedChild = await client.terminal(terminalId);
    const output = await resumedChild.output(/OPENCODE_RESUME:.+\r?\n/u);
    const resumed = JSON.parse(output.match(/OPENCODE_RESUME:(.+)\r?\n/u)[1]);
    assert.equal(resumed.args.filter((arg) => arg === "--prompt").length, 1);
    assert.equal(
      resumed.args[resumed.args.indexOf("--session") + 1],
      "session-child",
    );
    assert.ok(resumed.args.includes("--standalone"));
    const prompt = resumed.args[resumed.args.indexOf("--prompt") + 1];
    assert.match(prompt, /Read .+ and follow its instructions\./u);
    assert.match(
      prompt,
      /The original request and previous parent messages are now available at/u,
    );
    assert.deepEqual(resumed.bodies, ["First answer.", "Second request."]);
    stage("再開時にPTYへ貼り付けず未配送の記録が消える");
    await resumedChild.input("CHECK_INPUT\r");
    await resumedChild.output('OPENCODE_INPUT:""');
    const delivered = await actorCommand(parent, "delivered", ["tasks"]);
    assert.equal(
      delivered.data.children.find((entry) => entry.child === first.child)
        .pendingMessages,
      undefined,
    );
  }));

test("コミット0件のリポジトリでdelegate --worktree newは子を作らず理由を返す", (t) =>
  runHostTest(t, async ({ client, dataRoot, stage }) => {
    await linkGit(join(dataRoot, "bin"));
    const empty = join(dataRoot, "empty");
    const otherEmpty = join(dataRoot, "other-empty");
    await mkdir(empty);
    await mkdir(otherEmpty);
    execFileSync("git", ["-C", empty, "init", "-b", "main"], { stdio: "pipe" });
    execFileSync("git", ["-C", otherEmpty, "init", "-b", "main"], {
      stdio: "pipe",
    });
    const context = await setup(client, dataRoot, ["report-later"], "", empty);
    const expected =
      "This repository has no commits yet, so a new worktree cannot be created. Use --worktree parent, or make the first commit and try again.";
    const runDelegate = async (id, extraArgs = []) => {
      await context.parent.input(
        JSON.stringify({
          id,
          command: [
            "delegate",
            "--role",
            "Worker",
            "--difficulty",
            "low",
            "--title",
            id,
            "--worktree",
            "new",
            ...extraArgs,
            "--body",
            "Do the work.",
          ],
        }) + "\r",
      );
      const prefix = `ACTOR_RESULT:${id}:`;
      const { output } = await context.parent.waitFor(({ output }) => {
        const start = output.indexOf(prefix);
        return start !== -1 && output.indexOf("\n", start) !== -1;
      });
      const start = output.indexOf(prefix) + prefix.length;
      return JSON.parse(output.slice(start, output.indexOf("\n", start)));
    };
    stage("現在のリポジトリがコミット0件の時");
    const selfFailure = await runDelegate("empty-self");
    assert.equal(selfFailure.ok, false);
    assert.equal(selfFailure.text, expected);
    stage("--repoで別のコミット0件のリポジトリを指定した時");
    const repoFailure = await runDelegate("empty-repo", ["--repo", otherEmpty]);
    assert.equal(repoFailure.ok, false);
    assert.equal(repoFailure.text, expected);
    assert.deepEqual((await client.request("teams.children", {})).children, []);
  }));
