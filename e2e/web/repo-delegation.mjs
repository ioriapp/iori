import { fakeMarker } from "../fake-model/marker.mjs";
import { waitForOperation } from "../../verification/web/operation.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { openFolder, selectWorktree } from "../workspace/scenario.mjs";
import {
  create,
  open,
  typeTerminal,
  observed,
  closedRow,
} from "../terminal/scenario.mjs";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { basename, dirname, join, relative } from "node:path";
import { waitFor } from "../../verification/ui.mjs";

export async function repoDelegationScenario({
  fakeModelRequests,
  client,
  worktree,
  additionalChildWorktrees = [],
  secondRepository,
  teamRecords,
  parentId,
  parentInput,
  parentCommand,
  teamId,
  definition,
  record,
}) {
  const screen = client.screen;
  const role = {
    ...definition.roles[0],
    candidates: Object.fromEntries(
      Object.entries(definition.roles[0].candidates).map(
        ([level, candidates]) => [
          level,
          candidates.map((candidate) => ({
            ...candidate,
            id: `repo-${candidate.id}`,
          })),
        ],
      ),
    ),
    id: "repo-worker",
    name: "Repo worker",
    instruction:
      "Read the request file, follow it, report using iori report, and finish your turn. Do not use collaboration tools, wait commands or loops.",
  };
  const setupCommand = 'printf "%s" "$IORI_ROOT_PATH" > .iori-child-setup-root';
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const key=connection.getSnapshot().host.publicKey;for(const [method,params] of [['teams.save',{teamId:${JSON.stringify(teamId)},definition:${JSON.stringify({ ...definition, roles: [...definition.roles, role] })}}],['repository.git.set',{path:${JSON.stringify(secondRepository)},setupCommand:${JSON.stringify(setupCommand)},githubAccount:''}]]){const result=await connection.requestHost(key,method,params);if(!result?.ok)throw new Error(JSON.stringify(result));}})()`,
  );
  const command = async (args, expected) => {
    await screen.click(`[data-iori-terminal-row="${parentId}"]`);
    const result = await parentCommand(args, { allowFailure: true });
    if (expected) assert.match(result.text, expected);
    return result;
  };
  await command(
    [
      "delegate",
      "--role",
      "Repo worker",
      "--difficulty",
      "low",
      "--title",
      "Invalid",
      "--worktree",
      "parent",
      "--repo",
      ".",
      "--body",
      "test",
    ],
    /--repo cannot be used with --worktree parent/u,
  );
  await command(
    [
      "delegate",
      "--role",
      "Repo worker",
      "--difficulty",
      "low",
      "--title",
      "Invalid",
      "--worktree",
      "new",
      "--repo",
      "..",
      "--body",
      "test",
    ],
    /not inside a Git repository/iu,
  );
  const before = new Set(
    (await teamRecords()).children.map((child) => child.id),
  );
  const repoPath = relative(worktree, `${secondRepository}/nested`);
  const delegated = await command([
    "delegate",
    "--role",
    "Repo worker",
    "--difficulty",
    "low",
    "--title",
    "Cross repository",
    "--worktree",
    "new",
    "--repo",
    repoPath,
    "--body",
    "Verify sample.txt says Second repository and .iori-child-setup-root contains the main repository path. Then execute this single shell command in your current working directory: printf CROSS_REPO_OK > result.txt && iori report --body CROSS_REPO_OK. This writes the result before reporting. Do not report separately. Finish your turn afterward." +
      fakeMarker("team-cross-repo"),
  ]);
  assert.ok(["starting", "running"].includes(delegated.data.state));
  const state = await waitForOperation(
    "repo-delegation: 別リポジトリの子が報告",
    teamRecords,
    (value) =>
      value.children.some(
        (child) => !before.has(child.id) && child.state === "reported",
      ),
    async () => {
      const child = (await teamRecords()).children.find(
        (c) => !before.has(c.id),
      );
      return child && ["failed", "stopped", "finished"].includes(child.state)
        ? (child.failure ?? "子が報告せず終了しました")
        : false;
    },
  );
  const child = state.children.find((child) => !before.has(child.id));
  assert.equal(child.state, "reported", child.failure);
  if (fakeModelRequests)
    assert.equal(
      fakeModelRequests.find(
        (request) => request.marker === "team-cross-repo" && request.step === 1,
      )?.tokensPresent["Second repository\n"],
      true,
      "子が読んだsample.txtの内容がモデル要求に含まれる",
    );

  assert.equal(
    await readFile(`${child.cwd}/.iori-child-setup-root`, "utf8"),
    secondRepository,
  );
  assert.match(
    await readFile(`${child.cwd}/result.txt`, "utf8"),
    /CROSS_REPO_OK/u,
  );
  assert.equal(
    await access(`${child.cwd}/local-only.txt`).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(
    execFileSync("git", ["-C", child.cwd, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
    }).trim(),
    `${secondRepository}/.git`,
  );
  assert.equal(
    execFileSync(
      "git",
      [
        "-C",
        child.cwd,
        "for-each-ref",
        "--format=%(upstream)",
        `refs/heads/${child.branch}`,
      ],
      { encoding: "utf8" },
    ).trim(),
    "",
  );
  const label = `${basename(secondRepository)} › ${child.branch}`;
  await screen.wait(`[data-iori-child-id="${child.id}"]`);
  await waitFor(
    () =>
      screen.attribute(
        `.nav-child-branch[title=${JSON.stringify(child.cwd)}] > span`,
        "data-iori-full-name",
      ),
    (value) => value === label,
  );
  // The candidates are the repository's original working tree, the shown
  // parent and its children; a sibling worktree of the parent is not.
  const siblingWorktree = join(dirname(worktree), "repo-delegation-sibling");
  execFileSync(
    "git",
    [
      "-C",
      worktree,
      "worktree",
      "add",
      "-b",
      "iori/repo-delegation-sibling",
      siblingWorktree,
    ],
    { encoding: "utf8" },
  );
  const primaryWorktree = execFileSync(
    "git",
    ["-C", worktree, "worktree", "list", "--porcelain"],
    { encoding: "utf8" },
  )
    .split("\n")
    .find((line) => line.startsWith("worktree "))
    ?.slice("worktree ".length);
  assert.ok(
    primaryWorktree && primaryWorktree !== worktree,
    "表示中の親は元の作業ツリーでない",
  );
  const assertReadingChoices = async (kind) => {
    await screen.click(`[data-iori-field="${kind}-worktree"]`);
    await screen.wait(
      `[data-iori-worktree-choice=${JSON.stringify(worktree)}]`,
    );
    await screen.wait(
      `[data-iori-worktree-choice=${JSON.stringify(child.cwd)}]`,
    );
    const choices = await screen.evaluate(
      "Array.from(document.querySelectorAll('[data-iori-worktree-choice]'),row=>row.getAttribute('data-iori-worktree-choice')).sort()",
    );
    assert.deepEqual(
      choices,
      [
        primaryWorktree,
        child.cwd,
        worktree,
        ...additionalChildWorktrees,
      ].sort(),
      `${kind}の候補は元の作業ツリーと表示中の親とその子だけ`,
    );
    assert.equal(
      await screen.visible(
        `[data-iori-worktree-choice=${JSON.stringify(siblingWorktree)}]`,
      ),
      false,
      `${kind}の候補に兄弟worktreeを含めない`,
    );
    await screen.key("Escape");
  };
  await openWorkspaceView(screen, "files");
  await assertReadingChoices("files");
  await openWorkspaceView(screen, "git");
  await assertReadingChoices("git");
  await openWorkspaceView(screen, "files");
  await screen.click('[data-iori-field="files-worktree"]');
  const choice = `[data-iori-worktree-choice=${JSON.stringify(child.cwd)}]`;
  await screen.wait(choice);
  assert.equal(
    await screen.attribute(
      `${choice} [data-iori-full-name]`,
      "data-iori-full-name",
    ),
    label,
  );
  await screen.click(choice);
  await screen.wait(
    `[data-iori-field="files-worktree"][title=${JSON.stringify(child.cwd)}]`,
  );
  await waitFor(
    () => screen.text('[data-iori-view="files"]'),
    (value) => value.includes("result.txt"),
  );
  await screen.click(`.nav-child-branch[title=${JSON.stringify(child.cwd)}]`);
  await screen.wait(
    `[data-iori-field="git-worktree"][title=${JSON.stringify(child.cwd)}]`,
  );
  await openWorkspaceView(screen, "board");
  const agentChanges = `[data-iori-board-agent="${child.id}"] .agent-diff`;
  const totalChanges = ".agents-section .agent-summary .agent-diff";
  await screen.reveal(agentChanges);
  assert.match(await screen.text(agentChanges), /· 1ファイル/u);
  // Inside team-delegation the total also counts the other children.
  const totalBefore = await screen.text(totalChanges);
  await openFolder(screen, secondRepository);
  await screen.wait(
    `button[data-iori-worktree-path=${JSON.stringify(child.cwd)}]`,
  );
  await selectWorktree(screen, child.cwd);
  const terminalId = await create(client);
  await typeTerminal(client, "printf 'REMOVE_%s\\n' BUSY; sleep 600");
  await typeTerminal(client, "\r");
  await observed(client, "REMOVE_BUSY");
  // Finish the real notice response while the child's report still identifies
  // it. Teardown must not stop the parent before its model record is written.
  await parentInput.settle();
  const blocked = await command(
    [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "Verified",
      "--worktree",
      "remove",
      "--discard",
    ],
    /A Terminal opened in this worktree is still running\. Use --worktree keep\./u,
  );
  assert.equal(blocked.ok, false);
  await access(child.cwd);
  assert.equal(
    (await teamRecords()).children.find((entry) => entry.id === child.id).state,
    "reported",
  );
  await open(client, terminalId);
  await typeTerminal(client, "\x03");
  await typeTerminal(client, "printf 'REMOVE_%s\\n' IDLE");
  await typeTerminal(client, "\r");
  await observed(client, "REMOVE_IDLE");
  // The parent CLI row opens its layout and conversation together.
  await command(
    [
      "finish",
      child.id,
      "--decision",
      "accept",
      "--reason",
      "Verified",
      "--worktree",
      "remove",
      "--discard",
    ],
    /(?:Finished|Accepted|finished)/u,
  );
  await closedRow(client, terminalId);
  assert.equal(
    execFileSync(
      "git",
      ["-C", secondRepository, "worktree", "list", "--porcelain"],
      { encoding: "utf8" },
    ).includes(child.cwd),
    false,
  );
  await openWorkspaceView(screen, "files");
  await screen.click('[data-iori-field="files-worktree"]');
  assert.equal(await screen.visible(choice), false);
  await screen.key("Escape");
  await openWorkspaceView(screen, "board");
  await screen.wait('[data-iori-action="board-finished"]');
  if (
    (await screen.attribute(
      '[data-iori-action="board-finished"]',
      "aria-expanded",
    )) === "false"
  )
    await screen.click('[data-iori-action="board-finished"]');
  await screen.reveal(agentChanges);
  assert.match(await screen.text(agentChanges), /· 1ファイル/u);
  assert.equal(await screen.text(totalChanges), totalBefore);
  assert.equal(
    await screen.visible(
      `[data-iori-board-agent="${child.id}"] button.agent-diff`,
    ),
    false,
  );
  await record(
    "別リポジトリの相対サブフォルダーからorigin/main起点で委譲し、準備・実CLIの編集と報告・サイドバー・Files/Git切替・Board変更数・finish削除を確認",
  );
}
