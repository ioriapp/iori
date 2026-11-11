import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  operationFailure,
  cliFailure,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { waitFor } from "../../verification/ui.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import { pressCliKey, submitToCli } from "../cli-screen/input.mjs";
import { focusTerminal, waitForCliState } from "../cli-screen/scenario.mjs";
import { observe } from "../terminal/scenario.mjs";
import {
  openAgents,
  returnToWorktree,
  saveStartupArguments,
} from "./agents-navigation.mjs";

const action = (name) => `[data-iori-action="${name}"]`;
const cliRow = (id) => `[data-iori-cli-row="${id}"]`;
const launcher = '.new-items-popover[data-state="open"]';
const cli = "omp";
const model = "openai-codex/gpt-6-luna";
const row = (id) => `[data-iori-terminal-row="${id}"]`;
/** omp is bundled as a definition with a plugin-file bridge
 * (docs/design/cli-definitions.md「プラグインだけを持つ CLI」). This drives the
 * installed omp through the user's operations and records what the real CLI
 * does for the points of Issue #171. */
export async function cliOmpScenario({
  client,
  session,
  teamCommand,
  teamRecords,
  restartHostLosingTerminals,
  fakeModelRequests,
  record,
  shot,
}) {
  const screen = client.screen;
  const home = process.env.HOME;
  const tail = (id) =>
    screen.evaluate(
      `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]')?.getAttribute('data-iori-stream-id')]??''`,
    );
  const conversation = async (id) => {
    const file = (await session(id))?.session?.file;
    if (!file) return [];
    const text = await readFile(file, "utf8").catch(() => "");
    return text.split(/\r?\n/).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  };
  const answered = async (id, expected) =>
    (await conversation(id)).some(
      (entry) =>
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        JSON.stringify(entry.message).includes(expected),
    );
  const usedModels = async (id) => [
    ...new Set(
      (await conversation(id))
        .filter((entry) => entry.type === "model_change")
        .map((entry) => entry.model),
    ),
  ];
  const conversationUsage = async (id) =>
    (await conversation(id)).reduce(
      (total, entry) => {
        const usage =
          entry.type === "message" && entry.message?.role === "assistant"
            ? entry.message.usage
            : undefined;
        if (usage) {
          total.input += usage.input ?? 0;
          total.output += usage.output ?? 0;
        }
        return total;
      },
      { input: 0, output: 0 },
    );
  // The user's screen operation is the readiness signal for the CLI's input.
  const submit = (id, text, phase) =>
    focusTerminal(client, id).then(() =>
      submitToCli(client, text, undefined, phase, { focus: false }),
    );
  const trackStatus = (id) =>
    screen.evaluate(`(()=>{
      const row=${JSON.stringify(row(id))};
      window.__ompStatus=[];
      window.__ompObserver?.disconnect();
      window.__ompObserver=new MutationObserver(records=>{
        for(const record of records) {
          if(!record.target.closest(row)) continue;
          const state=record.target.getAttribute('data-status');
          if(state&&window.__ompStatus.at(-1)!==state)window.__ompStatus.push(state);
        }
      });
      window.__ompObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-status']});
    })()`);
  const trackedStatus = async () => {
    const states = await screen.evaluate("window.__ompStatus.join(',')");
    await screen.evaluate("window.__ompObserver?.disconnect()");
    return states;
  };
  const closeTab = async (id) => {
    await screen.click(
      `.dock-tab-header:has([data-iori-tab-id="terminal:${id}"]) [data-iori-action="workspace-close-tab"]`,
    );
    await waitFor(
      () =>
        screen.evaluate(
          `!document.querySelector('[data-iori-tab-id="terminal:${id}"]')`,
        ),
      Boolean,
      undefined,
      "閉じたTerminalのタブが消える",
    );
  };
  const openOmp = async () => {
    const seen = JSON.parse(
      await screen.evaluate(
        `JSON.stringify([...document.querySelectorAll('[data-iori-tab-cli="${cli}"]')].map(e=>e.getAttribute('data-iori-tab-id')))`,
      ),
    );
    await screen.click(action("workspace-add-tab"));
    await screen.click(`${launcher} [data-iori-cli-id="${cli}"]`);
    const tabId = await waitFor(
      () =>
        screen.evaluate(
          `[...document.querySelectorAll('[data-iori-tab-cli="${cli}"]')].map(e=>e.getAttribute('data-iori-tab-id')).find(id=>!${JSON.stringify(seen)}.includes(id))`,
        ),
      Boolean,
      undefined,
      "ompのタブ",
    );
    const id = tabId.replace(/^terminal:/u, "");
    await screen.wait(
      `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
    );
    return id;
  };

  // 1. The bundled definition is listed, and its part is placed for it.
  await openAgents(screen);
  const agentsRow = cliRow(cli);
  await screen.reveal(agentsRow);
  if ((await screen.attribute(agentsRow, "data-state")) !== "open")
    await screen.click(`${agentsRow} .team-agent-toggle`);
  for (const feature of ["state", "attention", "tokens", "resume"])
    assert.equal(
      await screen.attribute(
        `${agentsRow} [data-iori-support="${feature}"]`,
        "data-support",
      ),
      "available",
      feature,
    );
  // 7. `omp models --json` is a JSON list whose selector is the model argument.
  const catalog = await screen.evaluate(
    `(async()=>{
      const {connection}=await import('/src/connection.ts');
      const result=await connection.requestHost(connection.getSnapshot().host.publicKey,'cli.models',{cliId:'omp'});
      return result.ok?result.result:null;
    })()`,
  );
  assert.ok(
    catalog?.models?.some((entry) => entry.name === model),
    JSON.stringify({
      count: catalog?.models?.length,
      error: catalog?.error,
      detail: catalog?.errorDetail?.slice(0, 200),
    }),
  );
  await record(
    `同梱のompがAIエージェントの一覧に出て、対応状況が応答・Attention・トークン量・再開で利用可能、モデルの候補に ${model} が載る`,
  );

  await returnToWorktree(screen);
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");

  // The very first launch must load the bridge before omp starts.
  const id = await openOmp();
  await waitForCliState(client, id, ["idle"]);
  await shot("omp-first-launch");
  await record("1回目の起動からompの状態のインジケーターが出る");

  // 2. A turn: the bridge sends active, then done, through the common shape.
  // The Client tells the Host when the open Terminal has been seen, and the
  // Host then shows `idle` again in place of `done`. The row's `data-status`
  // keeps that transition, so the test reads it instead of sampling the Host.
  await trackStatus(id);
  await submit(
    id,
    "Remember the word IORI_OMP_MEMORY and reply exactly OMP_SAVED without using tools." +
      fakeMarker("omp-saved"),
    "omp-saved",
  );
  await waitFor(
    () => screen.evaluate("window.__ompStatus.includes('done')"),
    Boolean,
    120000,
    "応答中→完了の印",
  );
  const firstStates = await trackedStatus();
  assert.ok(firstStates.includes("active"), firstStates);
  assert.ok(firstStates.includes("done"), firstStates);
  await waitForOperation(
    "cli-omp: omp自身の会話の記録に答えた",
    () => answered(id, "OMP_SAVED"),
    Boolean,
    cliFailure(screen, id),
  );
  assert.deepEqual(await usedModels(id), [model]);
  const usage = await conversationUsage(id);
  assert.ok(usage.input > 0 && usage.output > 0, JSON.stringify(usage));
  await record(
    `本物のompで応答中→完了の印が出て（${firstStates}）、omp自身の会話の記録に答えた（モデル ${model}、トークン量 入力${usage.input}/出力${usage.output}）`,
  );

  // 3. Approval: omp asks before a command, and the answer is in the CLI.
  await trackStatus(id);
  await submit(
    id,
    "Run exactly this one shell command and end your turn: echo IORI_OMP_APPROVE" +
      fakeMarker("omp-approval"),
    "omp-approval",
  );
  await screen.wait(`${row(id)} [data-status="waiting"]`);
  assert.equal(
    await screen.attribute(
      '[data-iori-action="attention-open"]',
      "data-iori-attention-count",
    ),
    "1",
  );
  await waitFor(
    async () =>
      stripVTControlCharacters(await tail(id))
        .replaceAll(/\s+/gu, "")
        .includes("Allowtool:bash"),
    Boolean,
    undefined,
    "ompの承認の画面",
  );
  await shot("omp-approval");
  await pressCliKey(client, "Enter");
  await waitFor(
    () => screen.evaluate("window.__ompStatus.includes('done')"),
    Boolean,
    120000,
    "承認を解消した後の完了の印",
  );
  await waitFor(
    () =>
      screen.attribute(
        '[data-iori-action="attention-open"]',
        "data-iori-attention-count",
      ),
    (count) => count === "0",
    undefined,
    "承認の解消",
  );
  const approvalStates = await trackedStatus();
  assert.ok(approvalStates.includes("waiting"), approvalStates);
  assert.ok(approvalStates.includes("done"), approvalStates);
  await record(
    `ompがコマンドの承認を求めると判断待ちが出て、CLIの画面で承認すると解消する（${approvalStates}）`,
  );

  // 5. Host restart: the definition's resume argument opens the same session.
  await screen.click(`[data-iori-tab-id="terminal:${id}"]`);
  await restartHostLosingTerminals({ terminalId: id });
  await screen.wait(
    `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await screen.click(`[data-iori-terminal-id="${id}"] ${action("cli-resume")}`);
  await waitForCliState(client, id, ["idle"]);
  await trackStatus(id);
  await submit(
    id,
    "Reply only with the word I asked you to remember, without using tools." +
      fakeMarker("omp-resume"),
    "omp-resume",
  );
  await waitForOperation(
    "cli-omp: 再開したompの会話が前に覚えた語を答える",
    () => answered(id, "IORI_OMP_MEMORY"),
    Boolean,
    cliFailure(screen, id),
  );
  await waitFor(
    () => screen.evaluate("window.__ompStatus.includes('done')"),
    Boolean,
    120000,
    "再開した会話の完了の印",
  );
  const resumeStates = await trackedStatus();
  assert.ok(resumeStates.includes("active"), resumeStates);
  assert.ok(resumeStates.includes("done"), resumeStates);
  if (fakeModelRequests)
    assert.equal(
      fakeModelRequests.find(
        (request) =>
          request.marker === "omp-resume" &&
          request.step === 0 &&
          request.toolsProvided,
      )?.tokensPresent.IORI_OMP_MEMORY,
      true,
      "再開したompのモデル要求に前の会話の記憶語が含まれる",
    );
  await record(
    "Hostの再起動の後に、定義のresumeの引数で同じompの会話へ戻り、前に覚えた語を答える",
  );

  // 6. A team child: the role's model, permission and first instruction reach omp.
  const candidate = (level) => ({
    id: `omp-${level}`,
    cli,
    model,
    permission: "yolo",
    tools: [],
    minimum: "",
  });
  const team = {
    name: "omp definition team",
    description: "The bundled omp definition as a child",
    parent: {
      id: "parent",
      cli: "claude",
      model: "claude-haiku-4-5",
      tools: [],
      minimum: "",
    },
    instruction:
      "The user drives this conversation. Reply briefly and end your turn.",
    roles: [
      {
        id: "worker",
        name: "Worker",
        when: "Short verification",
        limit: "1",
        reuse: false,
        split: false,
        // The line below is only in the child's instruction file, which omp
        // receives through `--append-system-prompt`. Seeing it in the child's
        // own conversation shows that the file's contents reached the system
        // prompt (the request file and the initial message do not carry it).
        instruction:
          "Read the request, report once through iori report, and end your turn. Do not modify files or ask questions. Before you end your turn, print exactly this line: IORI_OMP_INSTRUCTION_FILE",
        request: "Follow the parent request.",
        report: "Result; changes; verification.",
        candidates: Object.fromEntries(
          ["high", "medium", "low"].map((level) => [level, [candidate(level)]]),
        ),
      },
    ],
  };
  const saved = await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const result=await connection.requestHost(host,'teams.create',{definition:${JSON.stringify(team)}});if(!result.ok)throw new Error('team fixture save failed');return result.result.saved;})()`,
  );
  await screen.click(action("open-agents-teams"));
  await screen.click(action("teams-list"));
  await screen.wait('.team-surface:not([hidden]) [role="switch"]');
  if (
    (await screen.attribute(
      '.team-surface:not([hidden]) [role="switch"]',
      "aria-checked",
    )) !== "true"
  )
    await screen.click('.team-surface:not([hidden]) [role="switch"]');
  await returnToWorktree(screen);
  const parentSeen = await screen.evaluate(
    `JSON.stringify([...document.querySelectorAll('[data-iori-tab-cli="claude"]')].map(e=>e.getAttribute('data-iori-tab-id')))`,
  );
  await screen.click(action("workspace-add-tab"));
  await screen.click(`${launcher} [data-iori-team-id="${saved.id}"]`);
  const parentTab = await waitFor(
    () =>
      screen.evaluate(
        `[...document.querySelectorAll('[data-iori-tab-cli="claude"]')].map(e=>e.getAttribute('data-iori-tab-id')).find(id=>!${parentSeen}.includes(id))`,
      ),
    Boolean,
    undefined,
    "チームの親のタブ",
  );
  const parentId = parentTab.replace(/^terminal:/u, "");
  await waitForCliState(client, parentId, ["idle", "done"]);
  await teamCommand(parentId, [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "omp definition child",
    "--worktree",
    "parent",
    "--body",
    'Without changing files, run exactly this one shell command and end your turn: iori report --body "OMP_CHILD_OK"' +
      fakeMarker("omp-child"),
  ]);
  const childId = await waitFor(
    () =>
      screen.evaluate(
        "document.querySelector('[data-iori-child-id]')?.dataset.ioriChildId",
      ),
    Boolean,
    120000,
    "ompへの委譲",
  );
  await waitForOperation(
    "cli-omp: 子の行の状態の表示: Reported",
    () => screen.text(`[data-iori-child-id="${childId}"] .nav-child-state`),
    (value) => value === "Reported",
    operationFailure(
      screen,
      `[data-iori-child-id="${childId}"][data-iori-child-state="failed"] .nav-child-state`,
    ),
  );
  const records = await teamRecords();
  const child = records.children.find((entry) => entry.id === childId);
  assert.ok(child?.terminalId, "委譲した子のTerminal");
  assert.deepEqual(await usedModels(child.terminalId), [model]);
  if (fakeModelRequests)
    assert.equal(
      fakeModelRequests.find(
        (request) =>
          request.marker === "omp-child" &&
          request.step === 0 &&
          request.toolsProvided,
      )?.tokensPresent.IORI_OMP_INSTRUCTION_FILE,
      true,
      "ioriの指示ファイルの目印がompのモデル要求に含まれる",
    );
  // The appended instruction file reached the system prompt.
  assert.equal(
    await answered(child.terminalId, "IORI_OMP_INSTRUCTION_FILE"),
    true,
    "指示のファイルの内容がシステムプロンプトに入った",
  );
  // `--yolo` was accepted: with approvalMode `write`, the report's bash call
  // would have waited for an answer and never run.
  const childEntries = await conversation(child.terminalId);
  const reportCalls = childEntries.flatMap((entry) =>
    entry.type === "message" &&
    entry.message?.role === "assistant" &&
    Array.isArray(entry.message.content)
      ? entry.message.content.filter(
          (part) =>
            part?.type === "toolCall" &&
            JSON.stringify(part.arguments ?? {}).includes("iori report"),
        )
      : [],
  );
  assert.ok(reportCalls.length > 0, "子がiori reportを実行した");
  assert.equal(
    childEntries.some(
      (entry) =>
        entry.type === "message" &&
        entry.message?.role === "toolResult" &&
        reportCalls.some((call) => call.id === entry.message.toolCallId) &&
        entry.message.isError === false,
    ),
    true,
    "承認で止まらずに報告のコマンドが実行された",
  );
  await record(
    `ompをチームの子にして委譲すると、役割のモデル（${model}）と許可の引数（--yolo）で起動し、--append-system-promptの指示のファイルの内容（IORI_OMP_INSTRUCTION_FILE）を読み、承認で止まらずにiori reportで報告する（Reported）`,
  );

  // 4. The conversation's tokens after the turn: the Board shows the child's.
  await openWorkspaceView(screen, "board");
  await waitFor(
    () =>
      screen.evaluate(
        `Boolean(document.querySelector('[data-iori-board-agent="${childId}"] [data-iori-agent-tokens="known"]'))`,
      ),
    Boolean,
    120000,
    "Boardのompの子のトークン量",
  );
  assert.match(
    await screen.text(
      `[data-iori-board-agent="${childId}"] [data-iori-agent-tokens="known"]`,
    ),
    /\d(?:[\d.,]*)(?:k|M)? tokens/u,
  );
  await record("完了の後に、部品が送る会話のトークン量がBoardの子の行に出る");
  await returnToWorktree(screen);

  // Startup arguments are set through the user's settings screen.
  await saveStartupArguments(screen, cli, "--profile verification");
  await returnToWorktree(screen);
  const profileId = await openOmp();
  await waitForCliState(client, profileId, ["idle"]);
  await trackStatus(profileId);
  await submit(
    profileId,
    "Reply exactly OMP_PROFILE_OK without using tools." +
      fakeMarker("omp-profile"),
    "omp-profile",
  );
  await waitFor(
    () => screen.evaluate("window.__ompStatus.includes('done')"),
    Boolean,
    120000,
    "プロファイル指定の会話の完了の印",
  );
  const profileStates = await trackedStatus();
  assert.ok(profileStates.includes("active"), profileStates);
  assert.ok(profileStates.includes("done"), profileStates);
  await waitForOperation(
    "cli-omp: プロファイル指定のompの応答",
    () => answered(profileId, "OMP_PROFILE_OK"),
    Boolean,
    cliFailure(screen, profileId),
  );
  assert.deepEqual(await usedModels(profileId), [model]);
  await shot("omp-profile");
  await record(
    `設定で --profile verification を指定しても応答中→完了の印が出る（${profileStates}）`,
  );
  await closeTab(profileId);
  await saveStartupArguments(screen, cli, "");
  await returnToWorktree(screen);
  for (const directory of ["hooks", "extensions"]) {
    const files = await readdir(join(home, ".omp/agent", directory), {
      recursive: true,
    }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    assert.equal(
      files.some((file) => file.split(/[\\/]/u).at(-1) === "iori-bridge.js"),
      false,
      `ompの${directory}にioriの部品を書かない`,
    );
  }
}
