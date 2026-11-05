import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  operationFailure,
  cliFailure,
  observeCliCompletion,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { waitFor } from "../../verification/ui.mjs";
import { piAgentDirectory } from "../../verification/cli/home.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import {
  finishCli,
  focusTerminal,
  waitForCliState,
  waitForPiInput,
} from "../cli-screen/scenario.mjs";
import { observe } from "../terminal/scenario.mjs";
import { openWorkspaceView } from "../../verification/workspace/interaction.mjs";
import {
  cliMenuAction,
  clickAgentControl,
  openAgents,
  returnToWorktree,
} from "./agents-navigation.mjs";
import { chooseFiles } from "./cli-definition-icons.mjs";

const id = "pi-common";
const foreignId = "pi-foreign";
const model = "gpt-6-luna";
const action = (name) => `[data-iori-action="${name}"]`;
const cliRow = (cliId) => `[data-iori-cli-row="${cliId}"]`;
const launcher = '.new-items-popover[data-state="open"]';
const confirmation = '[data-iori-view="cli-definition-confirmation"]';
const absent = (screen, selector) =>
  screen.evaluate(`!document.querySelector(${JSON.stringify(selector)})`);
async function openRow(screen, cliId) {
  if ((await screen.attribute(cliRow(cliId), "data-state")) !== "open")
    await clickAgentControl(screen, `${cliRow(cliId)} .team-agent-toggle`);
}
async function support(screen, cliId, feature) {
  return screen.attribute(
    `${cliRow(cliId)} [data-iori-support="${feature}"]`,
    "data-support",
  );
}
/** Pi's extension for this run: it sends iori's common shape, so the Host sees
 * the CLI's state without a hooks command in Pi's settings. */
const piExtension = `// Written by the cli-definition-plugin test, not part of the product.
import { request } from 'node:http';
export default function (pi) {
  const url = process.env.IORI_CLI_HOOK_URL;
  if (!url) return;
  let serial = Promise.resolve();
  const post = (state, extra = {}) => {
    serial = serial.then(() => new Promise((resolve) => {
      const body = JSON.stringify({ iori: 1, iori_cli: '${id}', state, ...extra });
      const req = request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => { res.resume(); res.once('end', resolve); });
      req.once('error', resolve);
      req.end(body);
    })).catch(() => {});
  };
  const conversation = (ctx) => ({
    sessionId: ctx.sessionManager.getSessionId(),
    ...(ctx.sessionManager.getSessionFile()
      ? { transcript: ctx.sessionManager.getSessionFile() }
      : {}),
  });
  pi.on('session_start', (event, ctx) => {
    if (event.reason !== 'reload') post('idle', conversation(ctx));
  });
  pi.on('agent_start', (_event, ctx) => post('active', conversation(ctx)));
  pi.on('agent_settled', (_event, ctx) => post('done', conversation(ctx)));
}
`;
/** The conversation's cumulative tokens, read from Pi's own session file. */
const tokensScript = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
if (!input.transcript) process.exit(0);
let text;
try {
  text = readFileSync(input.transcript, 'utf8');
} catch {
  process.exit(0);
}
const total = {};
for (const line of text.split(/\\r?\\n/)) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }
  if (entry?.type !== 'message' || entry.message?.role !== 'assistant')
    continue;
  const usage = entry.message.usage;
  if (!usage) continue;
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) {
    const value = usage[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
      total[field] = (total[field] ?? 0) + value;
  }
}
if (typeof total.input !== 'number' || typeof total.output !== 'number')
  process.exit(0);
process.stdout.write(JSON.stringify(total));
`;
/** A fixed window: the test checks the Host's usage path, not the CLI's. */
const usageScript = `process.stdout.write(JSON.stringify({
  windows: [{ remaining: 75, minutes: 300, resetsAt: Date.now() + 3600000, name: 'Weekly' }],
}));
`;
function definition(extensions) {
  return {
    schema: 1,
    id,
    name: "Pi by definition",
    command: "pi",
    version: { args: ["--version"] },
    launch: {
      model: ["--model", "{model}"],
      instructionFile: ["--append-system-prompt", "{instructionFile}"],
      initialPrompt: { mode: "argument", args: ["{prompt}"] },
      managedArguments: [{ names: ["--model"] }],
    },
    hooks: {
      format: "plugin-file",
      install: {
        copy: "iori-extension.ts",
        to: {
          env: "PI_CODING_AGENT_DIR",
          default: "~/.pi/agent",
          path: "extensions",
        },
      },
    },
    tokens: { script: "tokens.mjs" },
    usage: { script: "usage.mjs" },
  };
}
function foreignDefinition() {
  return {
    schema: 1,
    id: foreignId,
    name: "Pi with a file of the same name",
    command: "pi",
    hooks: {
      format: "plugin-file",
      install: {
        copy: "iori-foreign.ts",
        to: {
          env: "PI_CODING_AGENT_DIR",
          default: "~/.pi/agent",
          path: "extensions",
        },
      },
    },
  };
}

export async function cliDefinitionPluginScenario({
  client,
  teamCommand,
  record,
}) {
  const screen = client.screen;
  const extensions = join(piAgentDirectory(), "extensions");
  const plugin = join(extensions, "iori-extension.ts");
  const foreign = join(extensions, "iori-foreign.ts");
  // The same name is already there: iori did not place it, so it stays.
  await mkdir(extensions, { recursive: true });
  const userFile =
    "// This file belongs to the user.\nexport default function () {}\n";
  await writeFile(foreign, userFile);

  await openAgents(screen);
  await screen.click(action("cli-add-open"));
  await screen.click(action("cli-add-json"));
  await screen.input(
    '[data-iori-field="cli-definition-json"]',
    JSON.stringify(definition(), null, 2),
  );
  await waitFor(
    () => screen.text('[data-iori-state="cli-definition-missing-files"]'),
    (text) =>
      ["iori-extension.ts", "tokens.mjs", "usage.mjs"].every((name) =>
        text.includes(name),
      ),
  );
  assert.equal(
    await screen.text(action("cli-definition-choose-file")),
    "ファイルを選ぶ",
  );
  await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
    {
      name: "tokens.mjs",
      bytes: Buffer.from(tokensScript),
      type: "text/javascript",
    },
  ]);
  await waitFor(
    () => screen.text('[data-iori-state="cli-definition-missing-files"]'),
    (text) => !text.includes("tokens.mjs"),
  );
  await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
    {
      name: "iori-extension.ts",
      bytes: Buffer.from(piExtension),
      type: "text/javascript",
    },
    {
      name: "usage.mjs",
      bytes: Buffer.from(usageScript),
      type: "text/javascript",
    },
  ]);
  await waitFor(
    () => absent(screen, '[data-iori-state="cli-definition-missing-files"]'),
    Boolean,
  );
  await screen.click(action("cli-add-submit"));
  await screen.wait(confirmation);
  assert.equal(
    await screen.text(
      `${confirmation} [data-iori-state="cli-confirm-files"] dd code`,
    ),
    plugin,
  );
  assert.equal(
    await absent(screen, `${confirmation} [data-iori-command="launch"]`),
    true,
  );
  assert.equal(
    await absent(screen, `${confirmation} [data-iori-command="version"]`),
    true,
  );
  assert.equal(
    await absent(
      screen,
      `${confirmation} [data-iori-state="cli-confirm-settings"]`,
    ),
    true,
  );
  const tokenCommand = await screen.text(
    `${confirmation} [data-iori-command="tokens"] code`,
  );
  const usageCommand = await screen.text(
    `${confirmation} [data-iori-command="usage"] code`,
  );
  assert.match(tokenCommand, /tokens\.mjs$/u);
  assert.match(usageCommand, /usage\.mjs$/u);
  await screen.click(action("cli-definition-confirm"));
  await screen.reveal(cliRow(id));
  await record(
    "JSONで足した定義の確認に、置く部品の場所とトークン量・利用枠のスクリプトが実行するコマンドとして出る",
  );

  await openRow(screen, id);
  for (const feature of ["state", "tokens", "usage"])
    assert.equal(await support(screen, id, feature), "available", feature);
  await returnToWorktree(screen);
  await observe(client, "(await import('/src/native-platform-web.ts')).listen");

  // The first launch places the part; the next one runs with it.
  const opened = [];
  const open = async (cliId) => {
    await screen.click(action("workspace-add-tab"));
    await screen.click(`${launcher} [data-iori-cli-id="${cliId}"]`);
    const terminalId = await waitFor(
      () =>
        screen.evaluate(
          `[...document.querySelectorAll('[data-iori-tab-cli="${cliId}"]')].map(e=>e.dataset.ioriTabId.replace(/^terminal:/,'')).find(id=>!${JSON.stringify(opened)}.includes(id))`,
        ),
      Boolean,
    );
    opened.push(terminalId);
    await screen.wait(
      `[data-iori-terminal-id="${terminalId}"][data-iori-stream-state="ready"]`,
    );
    await focusTerminal(client, terminalId);
    await waitForPiInput(client, terminalId);
    return terminalId;
  };
  const first = await open(id);
  await waitForOperation(
    "cli-definition-plugin: 定義の部品がPiの拡張のフォルダーへ置かれる",
    () => readFile(plugin, "utf8").catch(() => undefined),
    (text) => text === piExtension,
    cliFailure(screen, first),
  );
  await finishCli(client, first, "pi");
  const terminalId = await open(id);
  await waitForCliState(client, terminalId, ["idle"]);
  await record(
    "プラグインだけを持つ定義から本物のPiを起動し、部品をPiの拡張のフォルダーへ置く",
  );

  const row = `[data-iori-terminal-row="${terminalId}"]`;
  await screen.evaluate(`(()=>{
    window.__pluginStatus=[];
    window.__pluginObserver=new MutationObserver(records=>{
      for(const record of records) {
        if(!record.target.closest(${JSON.stringify(row)}))continue;
        for(const state of [record.oldValue,record.target.getAttribute('data-status')])
          if(state&&window.__pluginStatus.at(-1)!==state)window.__pluginStatus.push(state);
      }
    });
    window.__pluginObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-status'],attributeOldValue:true});
  })()`);
  const completion = await observeCliCompletion(screen, terminalId);
  await focusTerminal(client, terminalId);
  await submitToCli(
    client,
    "Reply exactly IORI_PLUGIN_OK and do not use tools." +
      fakeMarker("plugin-reply"),
    undefined,
    "plugin-reply",
    { focus: false },
  );
  await waitForOperation(
    "cli-definition-plugin: Piの応答完了",
    completion.read,
    Boolean,
    cliFailure(screen, terminalId),
  );
  await completion.stop();
  await screen.evaluate("window.__pluginObserver.disconnect()");
  assert.ok(
    (await screen.evaluate("window.__pluginStatus.join(',')")).includes(
      "active",
    ),
    "応答中を経て完了になる",
  );
  await record(
    "部品が共通の形で送る知らせで、ターミナルの応答中→完了の印が出る",
  );

  await openAgents(screen);
  await waitFor(
    () =>
      screen.evaluate(
        `Boolean(document.querySelector('[data-iori-usage="${id}"] [data-iori-usage-window]'))`,
      ),
    Boolean,
    undefined,
    "利用枠のスクリプトの窓が詳細に出る",
  );
  assert.match(
    await screen.text(`[data-iori-usage="${id}"] [data-iori-usage-window]`),
    /75/u,
  );
  await record("利用枠のスクリプトの窓がAIエージェントの行に出る");
  await returnToWorktree(screen);

  // A team child measures its conversation with the definition's script.
  const candidate = (candidateId) => ({
    id: candidateId,
    cli: id,
    model,
    tools: [],
    minimum: "",
  });
  const team = {
    name: "Plugin definition team",
    description: "A CLI that sends the common shape",
    // The parent is the real Claude Code, which the test's own iori command
    // can drive; the child is the CLI from the definition.
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
        instruction:
          "Read the request, report once through iori report, and end your turn. Do not modify files or ask questions.",
        request: "Follow the parent request.",
        report: "Result; changes; verification.",
        candidates: Object.fromEntries(
          ["high", "medium", "low"].map((level) => [
            level,
            [candidate(`worker-${level}`)],
          ]),
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
  await screen.click(action("workspace-add-tab"));
  await screen.click(`${launcher} [data-iori-team-id="${saved.id}"]`);
  const parentId = await waitFor(
    () =>
      screen.evaluate(
        `[...document.querySelectorAll('[data-iori-tab-cli="claude"]')].map(e=>e.dataset.ioriTabId.replace(/^terminal:/,'')).find(id=>!${JSON.stringify(opened)}.includes(id))`,
      ),
    Boolean,
  );
  opened.push(parentId);
  await waitForCliState(client, parentId, ["idle", "done"]);
  await teamCommand(parentId, [
    "delegate",
    "--role",
    "Worker",
    "--difficulty",
    "low",
    "--title",
    "Plugin definition child",
    "--worktree",
    "parent",
    "--body",
    'Run exactly this one shell command: iori report --body "PLUGIN_DEFINITION_OK". Then end your turn. Do not change files.' +
      fakeMarker("plugin-child"),
  ]);
  const childId = await waitFor(
    () =>
      screen.evaluate(
        "document.querySelector('[data-iori-child-id]')?.dataset.ioriChildId",
      ),
    Boolean,
    120000,
    "定義のCLIへの委譲",
  );
  await waitForOperation(
    "cli-definition-plugin: 子の行の状態の表示: Reported",
    () => screen.text(`[data-iori-child-id="${childId}"] .nav-child-state`),
    (value) => value === "Reported",
    operationFailure(
      screen,
      `[data-iori-child-id="${childId}"][data-iori-child-state="failed"] .nav-child-state`,
    ),
  );
  // The Board shows the conversation's tokens. It keeps the last value and
  // refreshes while the definition's script measures the child.
  await openWorkspaceView(screen, "board");
  await screen.wait('[data-iori-view="board"] .board-agent-row');
  await waitFor(
    () =>
      screen.evaluate(
        `Boolean(document.querySelector('[data-iori-agent-tokens="known"]'))`,
      ),
    Boolean,
    120000,
    "Boardの子のトークン量",
  );
  assert.match(
    await screen.text('[data-iori-agent-tokens="known"]'),
    /\d(?:[\d.,]*)(?:k|M)? tokens/u,
  );
  await record(
    "定義のトークン量のスクリプトで、チームの子のPiの会話の累計がBoardのトークン量に出る",
  );

  // The installed part goes with the definition; the user's own file stays.
  await openAgents(screen);
  await openRow(screen, id);
  await cliMenuAction(screen, id, "cli-definition-delete");
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await screen.click(action("cli-definition-remove"));
  await waitFor(
    () => absent(screen, cliRow(id)),
    Boolean,
    undefined,
    "削除した定義の行が消える",
  );
  await waitFor(
    () =>
      readFile(plugin, "utf8").then(
        () => false,
        () => true,
      ),
    Boolean,
    undefined,
    "定義と一緒に置いた部品が消える",
  );
  // The test's own file, not this Host's, is left where it is.
  assert.equal(await readFile(foreign, "utf8"), userFile);

  await screen.click(action("cli-add-open"));
  await screen.click(action("cli-add-json"));
  await screen.input(
    '[data-iori-field="cli-definition-json"]',
    JSON.stringify(foreignDefinition(), null, 2),
  );
  await waitFor(
    () => screen.text('[data-iori-state="cli-definition-missing-files"]'),
    (text) => text.includes("iori-foreign.ts"),
  );
  await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
    {
      name: "iori-foreign.ts",
      bytes: Buffer.from("export default function () {}\n"),
      type: "text/javascript",
    },
  ]);
  await waitFor(
    () => absent(screen, '[data-iori-state="cli-definition-missing-files"]'),
    Boolean,
  );
  await screen.click(action("cli-add-submit"));
  await screen.wait(confirmation);
  await screen.click(action("cli-definition-confirm"));
  await returnToWorktree(screen);
  const foreignTerminal = await open(foreignId);
  await finishCli(client, foreignTerminal, "pi");
  await waitFor(
    () => readFile(foreign, "utf8"),
    (text) => text === userFile,
    undefined,
    "同じ名前の利用者のファイルは上書きしない",
  );
  await openAgents(screen);
  await openRow(screen, foreignId);
  await cliMenuAction(screen, foreignId, "cli-definition-delete");
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await screen.click(action("cli-definition-remove"));
  await waitFor(
    () => absent(screen, cliRow(foreignId)),
    Boolean,
    undefined,
    "削除した2つ目の定義の行が消える",
  );
  await waitFor(
    () => readFile(foreign, "utf8"),
    (text) => text === userFile,
    undefined,
    "削除しても利用者のファイルは残る",
  );
  await record(
    "定義を削除するとioriが置いた部品だけが消え、同じ名前の利用者のファイルは残る",
  );
}
