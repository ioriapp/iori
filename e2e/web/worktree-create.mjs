import {
  waitForOperation,
  operationFailure,
} from "../../verification/web/operation.mjs";
import { create, observe, observed } from "../terminal/scenario.mjs";
import { rm, readFile } from "node:fs/promises";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { waitFor } from "../../verification/ui.mjs";
import { openSidebar, openWorkspaceSettings } from "../connection/scenario.mjs";
import { addCliByCommand } from "./agents-navigation.mjs";

export async function worktreeCreate({
  client,
  createPlainFolder,
  repository,
  desktop,
  mobile,
  shot,
  record,
}) {
  const screen = client.screen;
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
    }).trim();
  const request = async (method, params) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('request failed');return r.result;})()`,
    );
  const inventory = () => git("worktree", "list", "--porcelain");
  const originalBrowser = git("rev-parse", "browser");
  const branchCommit = git(
    "commit-tree",
    git("rev-parse", "browser^{tree}"),
    "-p",
    originalBrowser,
    "-m",
    "Worktree starting branch fixture",
  );
  git("update-ref", "refs/heads/browser", branchCommit);
  const originalTeams = await request("teams.list", {});
  await request("teams.settings", {
    enabled: false,
    defaultTeam: originalTeams.defaultTeam,
    limits: originalTeams.limits,
  });
  // CLIs added by name and command; the shell reads the command line.
  const addCli = (name, command) =>
    request("cli.definition.simple", {
      simple: { name, command, modelArgument: "" },
    });
  const preparedCli = await addCli(
    "Setup verification Pi",
    "cat .iori-setup-root > .setup-cli-started; printf 'CLI_SETUP_STARTED\\n'; pi",
  );
  const setupParent = await addCli(
    "Setup verification Claude Code",
    "cat .iori-setup-root > .setup-parent-started; claude --model claude-haiku-4-5",
  );
  let plainFolder;
  let hereTabs;
  const tabState = () =>
    screen.evaluate(
      `Array.from(document.querySelectorAll('button[data-iori-tab-kind]'), tab => ({id: tab.dataset.ioriTabId, kind: tab.dataset.ioriTabKind}))`,
    );
  const terminals = [];
  const existingTerminals = new Set(
    (await request("terminal.list", {})).terminals.map(
      (terminal) => terminal.id,
    ),
  );
  const open = async () => {
    await openSidebar(screen);
    await screen.click(
      `[data-iori-action="new-worktree"][data-iori-repository-path=${JSON.stringify(repository)}]`,
    );
    await screen.wait('[data-iori-view="worktree-create"]');
    await waitFor(() =>
      screen.evaluate(
        "document.querySelector('[data-iori-field=\"worktree-setup-command\"]')?.disabled === false",
      ),
    );
  };
  const choose = async (choice) => {
    await screen.click('[data-iori-field="worktree-launcher"]');
    await screen.click(`[data-iori-launch-choice=${JSON.stringify(choice)}]`);
  };
  const started = async (cwd, team = false) => {
    const terminal = await waitForOperation(
      "worktree-create: 作成したworktreeでTerminalが起動",
      async () =>
        (await request("terminal.list", {})).terminals.find(
          (terminal) =>
            terminal.cwd === cwd &&
            !terminals.includes(terminal.id) &&
            !existingTerminals.has(terminal.id),
        ),
      Boolean,
      operationFailure(
        screen,
        '[data-iori-view="worktree-create"] [role="alert"]',
      ),
    );
    terminals.push(terminal.id);
    if (team)
      assert.ok(terminal.teamConversation, "選んだチームとして起動した");
    await waitFor(
      () =>
        screen.attribute(
          "[data-iori-current-worktree-path]",
          "data-iori-current-worktree-path",
        ),
      (path) => path === cwd,
    );
    await screen.wait(`[data-iori-terminal-id="${terminal.id}"]`);
    if (await screen.evaluate("innerWidth >= 768")) {
      await screen.wait(
        `button[data-iori-tab-id="terminal:${terminal.id}"][data-state="active"]`,
      );
      assert.equal(
        await screen.evaluate(
          `Boolean(document.querySelector('button[data-iori-tab-kind="start"]'))`,
        ),
        false,
      );
      const tabs = await tabState();
      if (cwd === repository) {
        const launched = { id: `terminal:${terminal.id}`, kind: "terminal" };
        const expected = hereTabs.some((tab) => tab.kind === "start")
          ? hereTabs.map((tab) => (tab.kind === "start" ? launched : tab))
          : [...hereTabs, launched];
        const byId = (a, b) => a.id.localeCompare(b.id);
        assert.deepEqual(tabs.sort(byId), expected.sort(byId));
      } else {
        assert.deepEqual(
          tabs.map((tab) => tab.kind),
          [
            "terminal",
            "files",
            ...(cwd === plainFolder ? [] : ["git"]),
            ...(team ? ["board"] : []),
          ],
        );
      }
      assert.equal(
        await screen.evaluate(
          `Array.from(document.querySelectorAll('button[data-iori-tab-kind]:not([data-iori-tab-kind="terminal"])')).every(tab => tab.dataset.state === 'inactive')`,
        ),
        true,
      );
    }
    return terminal;
  };
  await open();
  await waitFor(
    () => screen.text('[data-iori-field="worktree-base"]'),
    (text) => text === "main",
  );
  assert.equal(
    await screen.evaluate(
      'document.activeElement?.getAttribute("data-iori-field")',
    ),
    "worktree-name",
  );
  await screen.input('[data-iori-field="worktree-name"]', "discard-this");
  await screen.click('[data-iori-action="worktree-create-close"]');
  git("branch", "created-while-closed", "main");
  await open();
  await screen.click('[data-iori-field="worktree-base"]');
  await screen.wait('[data-iori-base-branch="created-while-closed"]');
  await screen.click('[data-iori-base-branch="main"]');
  git("branch", "-d", "created-while-closed");
  assert.equal(await screen.value('[data-iori-field="worktree-name"]'), "");
  await screen.input('[data-iori-field="worktree-name"]', "作業 feature");
  await screen.click('[data-iori-field="worktree-base"]');
  await screen.click('[data-iori-base-branch="browser"]');
  await choose(`cli:${preparedCli.cliId}`);
  const setupCommand = `printf 'WORKTREE_SETUP_OK\\n'; printf '%s' "$IORI_ROOT_PATH" > .iori-setup-root`;
  await screen.input(
    '[data-iori-field="worktree-setup-command"]',
    setupCommand,
  );
  await shot("pc-worktree-create");
  await screen.evaluate(
    `document.querySelector('[data-iori-field="worktree-name"]').focus()`,
  );
  await screen.key("Enter");
  const path = `${repository}-作業-feature`;
  await started(path);
  await waitForOperation(
    "worktree-create: 準備のコマンドの後にCLIが起動",
    () =>
      readFile(`${path}/.setup-cli-started`, "utf8").catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }),
    (value) => value === repository,
    operationFailure(
      screen,
      `[data-iori-terminal-id] [data-iori-state="setup-failed"]`,
    ),
  );
  assert.equal(await readFile(`${path}/.iori-setup-root`, "utf8"), repository);
  assert.equal(git("rev-parse", "作業-feature"), git("rev-parse", "browser"));
  assert.ok(inventory().includes(`worktree ${path}`));
  await screen.wait(`button[data-iori-worktree-path=${JSON.stringify(path)}]`);
  await record(
    "リポジトリの＋から日本語名・子ブランチで作成し、準備の後にPiの起動コマンドが準備結果を写した実ファイルを確認",
  );

  await openWorkspaceSettings(screen, repository);
  await waitFor(
    () => screen.value('[data-iori-field="repository-setup-command"]'),
    (value) => value === setupCommand,
  );
  const updatedCommand = `${setupCommand}; printf 'SETTINGS_COMMAND\\n'`;
  await screen.input(
    '[data-iori-field="repository-setup-command"]',
    updatedCommand,
  );
  await screen.click('[data-iori-action="save-repository-setup-command"]');
  await screen.wait('[data-iori-state="saved"]');
  await screen.key("Escape");
  await waitFor(
    async () => !(await screen.visible('[data-iori-view="settings"]')),
  );
  await openWorkspaceSettings(screen, repository);
  await waitFor(
    () => screen.value('[data-iori-field="repository-setup-command"]'),
    (value) => value === updatedCommand,
  );
  await shot("repository-worktree-command");
  await screen.key("Escape");
  // "In this folder" also opens saved layouts: retain their existing tabs.
  await selectWorktree(screen, repository, false);
  terminals.push(await create(client));
  hereTabs = await tabState();
  await open();
  assert.equal(
    await screen.value('[data-iori-field="worktree-setup-command"]'),
    updatedCommand,
  );
  await record(
    "作成ダイアログで保存したコマンドをワークスペースのGitで表示・変更でき、次の作成ダイアログに反映する",
  );
  await screen.input('[data-iori-field="worktree-name"]', "作業 feature");
  await choose("cli:pi");
  const beforeConflict = inventory();
  await screen.click('[data-iori-action="worktree-create"]');
  await screen.wait('[data-iori-view="worktree-create"] [role="alert"]');
  assert.equal(inventory(), beforeConflict);
  await screen.input('[data-iori-field="worktree-name"]', "修正できる名前");
  await screen.click('[data-iori-action="worktree-create-here"]');
  await started(repository);
  assert.equal(inventory(), beforeConflict);
  await assert.rejects(readFile(`${repository}/.iori-setup-root`, "utf8"), {
    code: "ENOENT",
  });
  await record(
    "重複名を上書きせず知らせ、名前を編集できることと「この場所で」がmainの既存タブを保持して開きworktreeを増やさないことを確認",
  );

  await open();
  await screen.input('[data-iori-field="worktree-name"]', "response-recovery");
  await choose("cli:pi");
  // Execute the real request through the real Host, then lose only its response
  // at the Client transport facade. No Git or terminal result is fabricated.
  await screen.evaluate(`(async()=>{
    const {connection}=await import('/src/connection.ts');
    const original=connection.requestHost;
    connection.requestHost=async (...args)=>{
      if(args[1]!=="worktrees.create")return original(...args);
      connection.requestHost=original;
      await original(...args);
      return undefined;
    };
  })()`);
  await screen.click('[data-iori-action="worktree-create"]');
  await screen.wait('[data-iori-action="worktree-create-check"]');
  await waitForOperation(
    "worktree-create: 応答の回復後にworktreeが作られる",
    () => inventory().includes(`worktree ${repository}-response-recovery`),
    Boolean,
    operationFailure(
      screen,
      '[data-iori-view="worktree-create"] [role="alert"]',
    ),
  );
  const afterLostResponse = inventory();
  assert.ok(
    afterLostResponse.includes(`worktree ${repository}-response-recovery`),
  );
  await screen.click('[data-iori-action="worktree-create-check"]');
  await started(`${repository}-response-recovery`);
  assert.equal(inventory(), afterLostResponse);
  await record(
    "作成応答を失っても作り直さず、作成結果の確認から同じworktreeでCLIを開く",
  );

  const setupCli = await addCli(
    "Setup verification",
    "printf 'CLI_SETUP_STARTED\\n'; printf started > .setup-cli-started; pi",
  );
  await open();
  await screen.input('[data-iori-field="worktree-name"]', "setup-failure");
  await screen.input(
    '[data-iori-field="worktree-setup-command"]',
    "printf 'SETUP_FAILED\\n'; printf x >> .setup-attempts; exit 23",
  );
  await choose(`cli:${setupCli.cliId}`);
  await screen.click('[data-iori-action="worktree-create"]');
  const failedPath = `${repository}-setup-failure`;
  const failedTerminal = await started(failedPath);
  const failedPane = `[data-iori-terminal-id="${failedTerminal.id}"]`;
  await screen.wait(`${failedPane} [data-iori-state="setup-failed"]`);
  assert.match(
    await screen.text(`${failedPane} [data-iori-state="setup-failed"]`),
    /作成後のコマンドが失敗しました（終了コード23）/u,
  );
  await observed(client, "SETUP_FAILED");
  await assert.rejects(readFile(`${failedPath}/.setup-cli-started`, "utf8"), {
    code: "ENOENT",
  });
  await screen.click(`${failedPane} [data-iori-action="setup-retry"]`);
  await waitFor(
    () => readFile(`${failedPath}/.setup-attempts`, "utf8"),
    (value) => value === "xx",
  );
  await waitFor(async () =>
    (await request("terminal.list", {})).terminals.find(
      (t) => t.id === failedTerminal.id && t.setup?.state === "failed",
    ),
  );
  await screen.wait(`${failedPane} [data-iori-action="setup-skip"]`);
  await assert.rejects(readFile(`${failedPath}/.setup-cli-started`, "utf8"), {
    code: "ENOENT",
  });
  await shot("pc-worktree-setup-failed");
  await screen.click(`${failedPane} [data-iori-action="setup-skip"]`);
  await observed(client, "CLI_SETUP_STARTED");
  assert.equal(
    await readFile(`${failedPath}/.setup-cli-started`, "utf8"),
    "started",
  );
  assert.ok(inventory().includes(`worktree ${failedPath}`));
  await record(
    "準備の終了コード23と出力を保持し、Run againで同じworktreeで再実行、Start anywayで同じタブの実Piを起動",
  );

  const saved = await request("teams.create", {
    definition: {
      name: "作成確認チーム",
      description: "",
      parent: {
        id: "parent",
        cli: setupParent.cliId,
        model: "claude-haiku-4-5",
        tools: [],
        minimum: "",
      },
      instruction: "",
      roles: [],
    },
  });
  await request("teams.settings", {
    enabled: true,
    defaultTeam: saved.saved.id,
    limits: {},
  });
  await open();
  await screen.input('[data-iori-field="worktree-name"]', "team-tabs");
  await screen.input(
    '[data-iori-field="worktree-setup-command"]',
    setupCommand,
  );
  await screen.click('[data-iori-action="worktree-create"]');
  await started(`${repository}-team-tabs`, true);
  await waitForOperation(
    "worktree-create: 準備のコマンドの後にチームの親が起動",
    () =>
      readFile(`${repository}-team-tabs/.setup-parent-started`, "utf8").catch(
        (error) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      ),
    (value) => value === repository,
    operationFailure(
      screen,
      '[data-iori-terminal-id] [data-iori-state="setup-failed"]',
    ),
  );
  await record(
    "PCの作成フォームで選んだCLI・チームが始めるを置き換え、Files・GitとチームのBoardは見ていないタブで残り、準備の後も同じ会話で続く",
  );
  await mobile({ width: 390, height: 844 });
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  await open();
  await screen.input(
    '[data-iori-field="worktree-setup-command"]',
    setupCommand,
  );
  await waitFor(
    () => screen.text('[data-iori-field="worktree-launcher"]'),
    (text) => text.includes("作成確認チーム"),
  );
  await shot("mobile-worktree-create");
  await screen.click('[data-iori-action="worktree-create"]');
  const created = await waitForOperation(
    "worktree-create: スマホで名前無しのworktreeが作られる",
    () => inventory().match(/worktree (.+-worktree-[0-9a-f]{8})\n/u)?.[1],
    Boolean,
    operationFailure(
      screen,
      '[data-iori-view="worktree-create"] [role="alert"]',
    ),
  );
  await started(created, true);
  await waitForOperation(
    "worktree-create: スマホで作ったworktreeでチームの親が起動",
    () =>
      readFile(`${created}/.setup-parent-started`, "utf8").catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }),
    (value) => value === repository,
    operationFailure(
      screen,
      '[data-iori-terminal-id] [data-iori-state="setup-failed"]',
    ),
  );
  assert.equal(
    await readFile(`${created}/.iori-setup-root`, "utf8"),
    repository,
  );
  assert.ok(
    inventory().includes(
      `branch refs/heads/iori/${created
        .split("/")
        .at(-1)
        .replace(/^repository-/u, "")}`,
    ),
  );
  await record(
    "スマホ全画面から既定チームと空欄名で作成し、印付きブランチと準備の後に親Claude Codeの起動コマンドが準備結果を写した実ファイルを確認",
  );
  await desktop();
  const plain = await createPlainFolder();
  plainFolder = plain;
  try {
    await openFolder(screen, plain, false);
    await openSidebar(screen);
    await screen.click(
      `[data-iori-action="folder-start-cli"][data-iori-folder-path=${JSON.stringify(plain)}]`,
    );
    await screen.wait(
      '[data-iori-view="worktree-create"] [data-iori-cli-id="pi"]',
    );
    assert.equal(
      await screen.visible('[data-iori-field="worktree-name"]'),
      false,
    );
    await screen.click(
      '[data-iori-view="worktree-create"] [data-iori-action="add-cli"]',
    );
    await addCliByCommand(screen, "Reopened CLI", "pi");
    const added = await waitFor(async () =>
      (await request("cli.list", {})).clis.find(
        (cli) => cli.name === "Reopened CLI",
      ),
    );
    await openSidebar(screen);
    await screen.click(
      `[data-iori-action="folder-start-cli"][data-iori-folder-path=${JSON.stringify(plain)}]`,
    );
    await screen.wait(
      `[data-iori-view="worktree-create"] [data-iori-cli-id="${added.id}"]`,
    );
    const beforePlain = inventory();
    await screen.click(
      '[data-iori-view="worktree-create"] [data-iori-cli-id="pi"]',
    );
    await started(plain);
    assert.equal(inventory(), beforePlain);
    await record(
      "Gitでないフォルダーの＋は作成フォームを出さず、同じCLI一覧からその場所で起動する",
    );
    for (const terminalId of terminals)
      await request("terminal.close", { terminalId, confirm: true });
  } finally {
    await rm(plain, { recursive: true, force: true });
  }
  await request("teams.settings", {
    enabled: originalTeams.enabled,
    defaultTeam: originalTeams.defaultTeam,
    limits: originalTeams.limits,
  });
  await request("teams.delete", { teamId: saved.saved.id });
  for (const cli of [setupCli, setupParent, preparedCli])
    await request("cli.definition.remove", { cliId: cli.cliId });
  git("update-ref", "refs/heads/browser", originalBrowser);
}
