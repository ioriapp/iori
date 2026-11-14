import { fakeMarker } from "../fake-model/marker.mjs";
import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { issueWorktreeName } from "../../packages/protocol/src/worktree-name.ts";
import { waitFor } from "../../verification/ui.mjs";
import { observe } from "../terminal/scenario.mjs";
import { answerClaudeStartup } from "../cli-screen/claude-status.mjs";
import { openFolder } from "../workspace/scenario.mjs";
import {
  closeSidebar,
  openSidebar,
  openWorkspaceSettings,
} from "../connection/scenario.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const field = (name) => `[data-iori-field="${name}"]`;
const creator = '[data-iori-view="worktree-create"]';
const pane = '[data-iori-view="issues"]:not([hidden])';
const row = (number) =>
  `${pane} [data-iori-part="issues-rows"] [data-iori-issue="${number}"]`;
const detail = (number) =>
  `${pane} [data-iori-part="issue-detail"][data-iori-issue-detail="${number}"]`;
const issuesButton = (path) =>
  `${action("repository-issues")}[data-iori-repository-path=${JSON.stringify(path)}]`;
const instruction = (number) =>
  `Issue #${number} を進めてください。本文とコメントは \`iori issue show ${number}\` で読めます。`;

async function readTranscript(file) {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .slice(0, -1)
      .filter(Boolean)
      .map(JSON.parse);
  } catch (error) {
    // SessionStart can arrive before the CLI creates its transcript.
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

/** Pictures of a screen in both themes, only when asked for. */
export function forgeCapture(client, shot, variable) {
  const screen = client.screen;
  const capture = async (name) => {
    if (process.env[variable] !== "1") return;
    const dark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    for (const theme of ["light", "dark"]) {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
      );
      // Colors move with transitions; take the picture once they settle.
      await waitFor(() =>
        screen.evaluate(
          "document.getAnimations().every(a=>!(a instanceof CSSTransition)||a.playState!=='running')",
        ),
      );
      await shot(`${name}-${theme}`);
    }
    await screen.evaluate(
      `document.documentElement.classList.toggle('dark', ${dark})`,
    );
  };
  // The same screen at WQHD, then back to the PC width.
  const wide = async (name) => {
    if (process.env[variable] !== "1") return;
    await client.browser.viewport({ width: 2560, height: 1440 });
    await capture(name);
    await client.browser.viewport({ width: 1440, height: 1000 });
  };
  return { capture, wide };
}

/** The Claude Code a screen started in `cwd`, once it saved its conversation. */
export async function startedClaude(client, session, cwd, known) {
  const screen = client.screen;
  const request = (method, params = {}) =>
    screen.evaluate(
      `(async()=>{const {connection}=await import('/src/connection.ts');const r=await connection.requestHost(connection.getSnapshot().host.publicKey,${JSON.stringify(method)},${JSON.stringify(params)});if(!r?.ok)throw new Error('request failed');return r.result;})()`,
    );
  const terminal = await waitFor(
    async () =>
      (await request("terminal.list")).terminals.find(
        (item) => item.cwd === cwd && !known.has(item.id),
      ),
    Boolean,
    undefined,
    "作成画面から始めたCLIのTerminal",
  );
  known.add(terminal.id);
  await screen.wait(
    `[data-iori-terminal-id="${terminal.id}"][data-iori-stream-state="ready"]`,
  );
  const tail = `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${terminal.id}"]')?.getAttribute('data-iori-stream-id')]??''`;
  try {
    // A project with .mcp.json (iori's own checkout) asks about its MCP
    // servers first; the user keeps the chosen "Continue without using".
    const saved = await answerClaudeStartup(
      client,
      terminal.id,
      async () => {
        const value = await session(terminal.id);
        return value?.session?.file ? value : undefined;
      },
      120000,
    );
    return { id: terminal.id, saved };
  } catch (error) {
    // What the Host kept for this CLI, what its shell printed, and what runs there.
    const saved = await session(terminal.id);
    const output = await screen.evaluate(tail);
    const processes = [];
    for (const pid of await readdir("/proc").catch(() => []))
      if (/^\d+$/u.test(pid))
        try {
          if ((await realpath(`/proc/${pid}/cwd`)) === cwd)
            processes.push(
              (await readFile(`/proc/${pid}/comm`, "utf8")).trim(),
            );
        } catch {
          // Processes end while they are listed.
        }
    error.message += ` ${JSON.stringify({
      cli: saved?.cli?.id,
      command: saved?.command,
      runtime: saved?.runtime && {
        ...saved.runtime,
        pendingCommand: saved.runtime.pendingCommand && "(pending)",
      },
      output: JSON.stringify(output.slice(-600)),
      processes,
    })}`;
    throw error;
  }
}

/** The CLI's own record of its first input: one line that reads a delivered file. */
export async function firstInstruction(saved, hostData) {
  const file = await waitFor(
    async () =>
      (await readTranscript(saved.session.file))
        .filter((entry) => entry.type === "user")
        .flatMap((entry) => {
          const content = entry.message?.content ?? [];
          return typeof content === "string" ? [{ text: content }] : content;
        })
        .map(
          (content) =>
            content.text?.match(
              /^Read (.+) and follow its instructions\.$/u,
            )?.[1],
        )
        .find(Boolean),
    Boolean,
    120000,
    "CLIの最初の入力の記録",
  );
  // Linux keeps the copies under the Host's team-deliveries; Windows keeps
  // them in the session's command folder.
  const inside = (root) => {
    const location = relative(root, file);
    return !location.startsWith("..") && !isAbsolute(location);
  };
  assert.ok(
    !inside(hostData) || inside(join(hostData, "team-deliveries")),
    "CLIにはHostの非公開の保存先でなく、配送用の写しを渡す",
  );
  return { file, text: await readFile(file, "utf8") };
}

async function closeCli(screen, id) {
  const terminalRow = `[data-iori-terminal-row="${id}"]`;
  await openSidebar(screen);
  await screen.contextMenu(terminalRow);
  await screen.click(action("terminal-close"));
  await screen.wait('[data-iori-dialog="terminal-close-confirmation"]');
  await screen.click(action("terminal-confirm-close"));
  await waitFor(
    () => screen.visible(terminalRow),
    (visible) => !visible,
  );
}

/**
 * "Start with this Issue" on an Issue of the Owner's public Forgejo opens the
 * repository's worktree screen with its name and first instruction; creating
 * starts the CLI, whose first input reads the instruction as a file. The "+"
 * screen sends a typed first instruction the same way, also "here".
 */
export async function forgeIssueStartScenario({
  client,
  fixture,
  repository,
  hostData,
  session,
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
  const issue = fixture.issue;
  const name = issueWorktreeName(issue.number, issue.title);
  const path = `${fixture.repository}-${name}`;
  await openFolder(screen, repository, false);
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

  await openSidebar(screen);
  await screen.click(issuesButton(fixture.repository));
  await screen.reveal(row(issue.number));
  await screen.click(row(issue.number), { scroll: false });
  await screen.wait(detail(issue.number));
  const start = `${detail(issue.number)} ${action("issue-start")}`;
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(start)})?.disabled === false`,
    ),
  );
  await capture("pc-issue-start");
  await wide("wqhd-issue-start");
  await screen.click(start);
  await screen.wait(creator);
  await waitFor(
    () => screen.value(field("worktree-name")),
    (value) => value === name,
    undefined,
    "Issueの番号と題名から名前を入れる",
  );
  assert.equal(
    await screen.value(field("worktree-instruction")),
    instruction(issue.number),
  );
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(field("worktree-setup-command"))})?.disabled === false`,
    ),
  );
  const base = await screen.text(field("worktree-base"));
  const { defaultBranch } = await request("worktrees.options", {
    path: fixture.repository,
  });
  assert.equal(base, defaultBranch, "起点ブランチはふだんの既定値");
  await capture("pc-issue-start-creator");
  await wide("wqhd-issue-start-creator");
  await record(
    "固定資材のIssueの詳細の「このIssueで始める」で、worktreeの作成画面が名前と最初の指示を入れて開き、自動では始めない",
    { issue: issue.number, name },
  );

  await screen.click(field("worktree-launcher"));
  await screen.click(`[data-iori-launch-choice="cli:claude"]`);
  await screen.click(action("worktree-create"));
  const created = await startedClaude(client, session, path, known);
  const delivered = await firstInstruction(created.saved, hostData);
  assert.equal(delivered.text, instruction(issue.number));
  await record(
    "「作る」でIssueの名前のworktreeを作ってClaude Codeを始め、最初の入力が指示のファイルを読む1行になり、そのファイルに最初の指示が入っている",
    { path },
  );
  await closeCli(screen, created.id);

  // The "+" screen sends a typed first instruction too, also without a worktree.
  const typed =
    '最初の指示: "引用符" と\n2行目を、そのまま読んでください。' +
    fakeMarker("forge-issue-start");
  await openSidebar(screen);
  await screen.click(
    `${action("new-worktree")}[data-iori-repository-path=${JSON.stringify(repository)}]`,
  );
  await screen.wait(creator);
  assert.equal(await screen.value(field("worktree-name")), "");
  assert.equal(await screen.value(field("worktree-instruction")), "");
  await screen.input(field("worktree-instruction"), typed);
  await waitFor(() =>
    screen.evaluate(
      `document.querySelector(${JSON.stringify(action("worktree-create-here"))})?.disabled === false`,
    ),
  );
  await capture("pc-new-worktree-instruction");
  await wide("wqhd-new-worktree-instruction");
  await screen.click(field("worktree-launcher"));
  await screen.click(`[data-iori-launch-choice="cli:claude"]`);
  await screen.click(action("worktree-create-here"));
  const here = await startedClaude(client, session, repository, known);
  assert.equal((await firstInstruction(here.saved, hostData)).text, typed);
  await record(
    "リポジトリの「＋」の作成画面で入れた複数行の最初の指示を「この場所で」でも同じくファイルで渡す",
  );
  await closeCli(screen, here.id);

  // A phone opens the Issue from the drawer and the screen in full.
  await mobile({ width: 390, height: 844 });
  await openSidebar(screen);
  await screen.tap(issuesButton(fixture.repository));
  await closeSidebar(screen);
  await screen.wait(detail(issue.number));
  await capture("phone-issue-start");
  await screen.tap(start);
  await screen.wait(creator);
  await waitFor(
    () => screen.value(field("worktree-name")),
    (value) => value === name,
  );
  await capture("phone-issue-start-creator");
  await screen.tap(action("worktree-create-close"));
  await openSidebar(screen);
  await screen.tap(
    `${action("new-worktree")}[data-iori-repository-path=${JSON.stringify(repository)}]`,
  );
  await screen.wait(creator);
  assert.equal(
    await screen.value(field("worktree-name")),
    "",
    "「＋」はIssueの値を持ち越さない",
  );
  await screen.input(field("worktree-instruction"), typed);
  await capture("phone-new-worktree-instruction");
  await screen.tap(action("worktree-create-close"));
  // The settings are the other dialog a phone shows in full.
  await openSidebar(screen);
  await screen.tap(action("settings-open"));
  await screen.wait('[data-iori-view="settings"]');
  await capture("phone-settings");
  await screen.key("Escape");
  await record(
    "スマホの幅ではIssueの詳細の「このIssueで始める」が全画面の作成画面を開き、「＋」は空の欄で開く",
  );
  await desktop();
}
