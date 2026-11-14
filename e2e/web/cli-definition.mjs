import { fakeMarker } from "../fake-model/marker.mjs";
import {
  waitForOperation,
  operationFailure,
  cliFailure,
  observeCliCompletion,
} from "../../verification/web/operation.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { waitFor } from "../../verification/ui.mjs";
import { observe, clearObserved, typeTerminal } from "../terminal/scenario.mjs";
import {
  finishCli,
  focusTerminal,
  waitForCliState,
} from "../cli-screen/scenario.mjs";
import { answerClaudeStartup } from "../cli-screen/claude-status.mjs";
import { submitToCli } from "../cli-screen/input.mjs";
import {
  cliRowNamed,
  cliMenuAction,
  clickAgentControl,
  openAgents,
  returnToWorktree,
  saveStartupArguments,
} from "./agents-navigation.mjs";
import {
  assertIcon,
  assertBundledIcon,
  chooseFiles,
  changeIcon,
  definitionIconSvg,
  editDefinitionIcon,
} from "./cli-definition-icons.mjs";
import { definitionPictures } from "./cli-definition-capture.mjs";

const cliId = "claude-definition";
const model = "claude-haiku-4-5";
const action = (name) => `[data-iori-action="${name}"]`;
const launcher = '.new-items-popover[data-state="open"]';
const cliRow = (id) => `[data-iori-cli-row="${id}"]`;
/** Open the detail of a CLI row on the AI agents screen. */
async function openRow(screen, id) {
  if ((await screen.attribute(cliRow(id), "data-state")) !== "open")
    await clickAgentControl(screen, `${cliRow(id)} .team-agent-toggle`);
}
/** Whether the element is gone from the page, not only out of view. */
const absent = (screen, selector) =>
  screen.evaluate(`!document.querySelector(${JSON.stringify(selector)})`);
/** The value shown for `feature` in the support table of a CLI row. */
async function support(screen, id, feature) {
  const cell = `${cliRow(id)} [data-iori-support="${feature}"]`;
  return {
    value: await screen.attribute(cell, "data-support"),
    text: await screen.text(cell),
  };
}

/** A user's definition of the real Claude Code under another `id`. Its
 * hooks go to this run's own settings file, which `--settings` makes
 * Claude Code read, so `claude-settings` and `rules` run on the real CLI. */
function definition(settings) {
  return {
    schema: 1,
    id: cliId,
    name: "Claude Code by definition",
    command: "claude",
    icon: { light: "icon.svg" },
    version: { args: ["--version"] },
    models: { candidates: [model] },
    launch: {
      model: ["--model", "{model}"],
      instructionFile: ["--append-system-prompt-file", "{instructionFile}"],
      directories: ["--add-dir", "{directory}"],
      initialPrompt: { mode: "argument", args: ["--", "{prompt}"] },
      managedArguments: [{ names: ["--model"] }],
    },
    resume: { args: ["--resume", "{sessionId}"] },
    hooks: {
      format: "claude-settings",
      file: settings,
      sessionId: "session_id",
      transcript: "transcript_path",
      toolId: "tool_use_id",
      rules: [
        { event: "SessionStart", when: { source: "compact" }, ignore: true },
        { event: "SessionStart", state: "idle" },
        { event: "UserPromptSubmit", state: "active" },
        { event: "PreToolUse", state: "active", tool: "tool_name" },
        { event: "PostToolUse", toolFinished: true },
        {
          event: "PermissionRequest",
          state: "waiting",
          attention: "approval",
          tool: "tool_name",
        },
        {
          event: "Notification",
          when: { notification_type: "permission_prompt" },
          state: "waiting",
          attention: "approval",
        },
        { event: "Stop", when: { stop_hook_active: true }, ignore: true },
        { event: "Stop", state: "done", response: "last_assistant_message" },
        {
          event: "StopFailure",
          state: "done",
          outcome: "failure",
          failure: ["error_details", "error"],
        },
        { event: "SessionEnd", state: "stopped" },
      ],
    },
  };
}
const owned = (command) =>
  /[\\/]\.iori[\\/]hooks[\\/]iori-cli-hook/u.test(command);
function ioriHooks(settings) {
  return Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
    groups.some((group) => group.hooks?.some((hook) => owned(hook.command)))
      ? [event]
      : [],
  );
}
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

/** The arguments of the Claude Code process of `session`, found through
 * Claude Code's own registration of its live sessions. */
async function claudeArguments(claudeHome, session) {
  const directory = join(claudeHome, "sessions");
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    const registered = await readJson(join(directory, name)).catch(() => ({}));
    if (registered.sessionId !== session) continue;
    return (await readFile(`/proc/${registered.pid}/cmdline`, "utf8"))
      .split("\0")
      .filter(Boolean);
  }
  return undefined;
}

/** Whether Claude Code's own transcript answers `question` with `answer`. */
async function answered(file, question, answer) {
  const entries = (await readFile(file, "utf8")).split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const text = (entry) =>
    [entry.message?.content]
      .flat()
      .map((part) => (typeof part === "string" ? part : (part?.text ?? "")))
      .join("");
  const asked = entries.findLastIndex(
    (entry) => entry.type === "user" && text(entry).includes(question),
  );
  return (
    asked >= 0 &&
    entries
      .slice(asked + 1)
      .some(
        (entry) => entry.type === "assistant" && text(entry).includes(answer),
      )
  );
}

export async function cliDefinitionScenario({
  workflow,
  fakeModelRequests,
  client,
  hostData,
  teamCommand,
  teamRecords,
  session,
  restartHostLosingTerminals,
  record,
  shot,
}) {
  const screen = client.screen;
  const runRoot = join(hostData, "..", "..");
  const settings = join(runRoot, "claude-definition-settings.json");
  // The user's own settings for this CLI: the team's `iori` commands are allowed.
  const userSettings = { permissions: { allow: ["Bash(iori *)"] } };
  await writeFile(settings, JSON.stringify(userSettings));
  const pictures = definitionPictures({ client, shot });
  const addForm = () => screen.reveal('[data-iori-view="cli-definition-add"]');
  await openAgents(screen);
  if (pictures.capturing) {
    await screen.wait(cliRow("claude"));
    await pictures.capture("list-empty", pictures.top);
  }

  const confirmation = '[data-iori-view="cli-definition-confirmation"]';
  if (workflow === "cli-definition-editor") {
    // Name and command: the model argument is filled in from `claude --help`.
    await screen.click(action("cli-add-open"));
    if (pictures.capturing) {
      await screen.click(action("cli-add-submit"));
      await waitFor(() => screen.text(".cli-def-foot-message"), Boolean);
      // The reason is in the foot, under the fields.
      await pictures.capture("add-simple-error", () =>
        screen.reveal('[data-iori-view="cli-definition-add"] .cli-def-foot'),
      );
    }
    await screen.input(
      '[data-iori-field="cli-name"]',
      "Claude Code by command",
    );
    await screen.input('[data-iori-field="cli-command"]', "claude");
    await screen.key("Tab");
    await waitFor(
      () => screen.value('[data-iori-field="cli-model-argument"]'),
      (value) => value === "--model {model}",
      undefined,
      "モデルの引数を `claude --help` から自動入力",
    );
    assert.equal(
      await screen.text('[data-iori-state="cli-help-filled"] code'),
      "claude --help",
    );
    await pictures.capture("add-simple", addForm);
    await screen.click(action("cli-add-submit"));
    const simpleId = await cliRowNamed(screen, "Claude Code by command");
    assert.equal(
      await screen.text(
        `${cliRow(simpleId)} [data-iori-state="cli-user-definition"]`,
      ),
      "ユーザー定義",
    );
    await record(
      "名前とコマンドで本物のClaude Codeを足し、モデルの引数を `claude --help` から自動入力して一覧に出る",
    );

    await screen.click(action("cli-add-open"));
    await screen.input(
      '[data-iori-field="cli-name"]',
      "Claude Code by command",
    );
    await screen.input('[data-iori-field="cli-command"]', "claude");
    await screen.click(action("cli-add-submit"));
    await screen.wait('[data-iori-view="cli-definition-confirmation"]');
    assert.match(
      await screen.text('[data-iori-view="cli-definition-confirmation"] h2'),
      /定義を上書きしますか/u,
    );
    await screen.click(action("cli-definition-confirm"));
    await screen.reveal(cliRow(simpleId));
    await record(
      "名前とコマンドで同じidを足し直す時も、上書きの確認を出して置き換える",
    );
    const helperText = "A helper file placed by the user.\n";
    const simpleHelper = join(
      hostData,
      "cli-definitions",
      simpleId,
      "helper.txt",
    );
    await writeFile(simpleHelper, helperText);

    // JSON: the confirmation names the settings file that the hooks change.
    await screen.click(action("cli-add-open"));
    await screen.click(action("cli-add-json"));
    await screen.input(
      '[data-iori-field="cli-definition-json"]',
      JSON.stringify({
        schema: 1,
        id: "json-icon",
        name: "JSON icon",
        command: "cat",
        icon: { light: "missing.svg" },
      }),
    );
    await waitFor(
      () => screen.text('[data-iori-state="cli-definition-missing-files"]'),
      (text) => text.includes("missing.svg"),
    );
    assert.equal(
      await screen.text(action("cli-definition-choose-file")),
      "ファイルを選択",
    );
    await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
      { name: "missing.svg", bytes: definitionIconSvg, type: "image/svg+xml" },
    ]);
    await waitFor(
      () => absent(screen, '[data-iori-state="cli-definition-missing-files"]'),
      Boolean,
    );
    await pictures.capture("json-selected-files", addForm);
    await screen.click(action("cli-add-submit"));
    await screen.reveal(cliRow("json-icon"));
    assert.equal(
      await absent(screen, confirmation),
      true,
      "CLI本体とアイコンだけの定義は確認なしで追加する",
    );
    await assertIcon(screen, cliRow("json-icon"), definitionIconSvg);
    // Existing referenced attachments survive an update without reselecting them.
    for (const keepIcon of [true, false]) {
      await screen.click(action("cli-add-open"));
      await screen.click(action("cli-add-json"));
      await screen.input(
        '[data-iori-field="cli-definition-json"]',
        JSON.stringify({
          schema: 1,
          id: "json-icon",
          name: "JSON icon updated",
          command: "cat",
          ...(keepIcon ? { icon: { light: "missing.svg" } } : {}),
        }),
      );
      await screen.click(action("cli-add-submit"));
      await screen.wait(confirmation);
      assert.match(
        await screen.text(`${confirmation} h2`),
        /定義を上書きしますか/u,
      );
      assert.equal(
        await absent(
          screen,
          `${confirmation} [data-slot="dialog-description"]`,
        ),
        true,
        "項目が無い上書きは題と操作だけを出す",
      );
      if (keepIcon) await pictures.capture("confirm-replace-empty");
      assert.equal(
        await screen.evaluate(
          `document.querySelector(${JSON.stringify(confirmation)}).querySelectorAll('dt').length`,
        ),
        0,
        "上書きは対象の項目が無くても確認する",
      );
      await screen.click(action("cli-definition-confirm"));
      await waitFor(() => absent(screen, confirmation), Boolean);
      await waitFor(
        () => screen.text(`${cliRow("json-icon")} .team-agent-name > span`),
        (name) => name === "JSON icon updated",
      );
      if (keepIcon)
        await assertIcon(screen, cliRow("json-icon"), definitionIconSvg);
      else {
        await waitFor(
          () =>
            screen.evaluate(
              `!!document.querySelector('${cliRow("json-icon")} .cli-icon svg.lucide-bot')`,
            ),
          Boolean,
        );
      }
    }
    await openRow(screen, "json-icon");
    await cliMenuAction(screen, "json-icon", "cli-definition-delete");
    await screen.click(action("cli-definition-remove"));
    await record(
      "JSONの欄で画像を選んで最小の定義を確認なしで追加する。同じidで入れ直す時は確認し、画像の指定に応じて表示を切り替える",
    );
    await screen.click(action("cli-add-open"));
    await screen.click(action("cli-add-json"));
    if (pictures.capturing) {
      await pictures.capture("add-json", addForm);
      await screen.input(
        '[data-iori-field="cli-definition-json"]',
        JSON.stringify({
          schema: 1,
          id: "crush",
          name: "Crush",
          command: "crush",
          launch: { model: "--model {model}" },
        }),
      );
      await screen.click(action("cli-add-submit"));
      await screen.wait(".cli-def-error");
      await pictures.capture("add-json-error", addForm);
      await screen.click(action("cli-add-file"));
      await pictures.chooseFile(JSON.stringify(definition(settings), null, 2));
      await pictures.capture("add-file", addForm);
      await screen.click('[data-iori-remove-file="definition.json"]');
      await screen.click(action("cli-add-json"));
    }
    await screen.click(action("cli-add-file"));
    const definitionFile = {
      name: "crush.json",
      bytes: Buffer.from(JSON.stringify(definition(settings), null, 2)),
      type: "application/json",
    };
    await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
      definitionFile,
    ]);
    await screen.reveal(".cli-def-file-name");
    const missingFiles = '[data-iori-state="cli-definition-missing-files"]';
    await waitFor(
      () => screen.text(missingFiles),
      (text) => text === "次のファイルも選んでください: icon.svg",
    );
    await pictures.capture("upload-missing", addForm);
    assert.equal(
      await screen.visible('[data-iori-view="cli-definition-confirmation"]'),
      false,
    );
    const iconFile = {
      name: "icon.svg",
      bytes: definitionIconSvg,
      type: "image/svg+xml",
    };
    const previousIconFile = {
      ...iconFile,
      bytes: Buffer.from(
        definitionIconSvg.toString().replace("#ea580c", "#2563eb"),
      ),
    };
    await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
      previousIconFile,
    ]);
    await waitFor(() => absent(screen, missingFiles), Boolean);
    assert.equal(
      await screen.evaluate(
        "document.querySelectorAll('.cli-def-selected-files li').length",
      ),
      2,
    );
    await pictures.capture("upload-selected", addForm);
    await screen.click('[data-iori-remove-file="icon.svg"]');
    await waitFor(
      () => screen.text(missingFiles),
      (text) => text === "次のファイルも選んでください: icon.svg",
    );
    await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
      previousIconFile,
    ]);
    await waitFor(() => absent(screen, missingFiles), Boolean);
    // Different bytes under the same name must replace the earlier image.
    // The saved orange image is verified below, before the icon is edited.
    await chooseFiles(screen, '[data-iori-field="cli-definition-file"]', [
      iconFile,
    ]);
    await waitFor(
      () =>
        screen.evaluate(
          "document.querySelectorAll('.cli-def-selected-files li').length === 2",
        ),
      Boolean,
    );
    await screen.click(action("cli-add-submit"));
    await screen.wait(confirmation);
    assert.equal(
      await screen.text(
        `${confirmation} [data-iori-state="cli-confirm-settings"] dd`,
      ),
      settings,
    );
    assert.equal(
      await absent(screen, `${confirmation} [data-iori-command]`),
      true,
      "CLI本体の起動とバージョンを出さない",
    );
    assert.equal(
      await absent(
        screen,
        `${confirmation} [data-iori-state="cli-confirm-files"]`,
      ),
      true,
      "アイコンは確認項目に出さない",
    );
    await pictures.capture("confirm-add");
    await screen.click(action("cli-definition-confirm"));
    await screen.reveal(cliRow(cliId));
    await assertIcon(screen, cliRow(cliId), definitionIconSvg);
    const jsonHelper = join(hostData, "cli-definitions", cliId, "helper.txt");
    await writeFile(jsonHelper, helperText);
    assert.equal(
      await screen.text(`${cliRow(cliId)} .team-agent-name > span`),
      "Claude Code by definition",
    );
    await record(
      "JSONと画像を別々に選んでも一覧に残り、外すと不足の案内が戻り、確認には変更する設定ファイルだけが出る",
    );

    await openRow(screen, cliId);
    await screen.click(`${cliRow(cliId)} ${action("cli-definition-edit")}`);
    assert.equal(
      await absent(screen, `${cliRow(cliId)} .cli-def-actions`),
      true,
      "JSONの編集中は空の定義の行を残さない",
    );
    const iconEditor = `${cliRow(cliId)} [data-iori-field="cli-definition-json"]`;
    const iconOnly = JSON.parse(await screen.value(iconEditor));
    iconOnly.icon.dark = "chosen-dark.svg";
    await screen.input(iconEditor, JSON.stringify(iconOnly, null, 2));
    await waitFor(
      () =>
        screen.text(
          `${cliRow(cliId)} [data-iori-state="cli-definition-missing-files"]`,
        ),
      (text) => text.includes("chosen-dark.svg"),
    );
    await pictures.capture("edit-json-missing", () =>
      screen.reveal(
        `${cliRow(cliId)} [data-iori-view="cli-definition-editor"]`,
      ),
    );
    await chooseFiles(
      screen,
      `${cliRow(cliId)} [data-iori-field="cli-definition-file"]`,
      [
        {
          name: "chosen-dark.svg",
          bytes: definitionIconSvg,
          type: "image/svg+xml",
        },
      ],
    );
    await waitFor(
      () =>
        absent(
          screen,
          `${cliRow(cliId)} [data-iori-state="cli-definition-missing-files"]`,
        ),
      Boolean,
    );
    await pictures.capture("edit-json-selected", () =>
      screen.reveal(
        `${cliRow(cliId)} [data-iori-view="cli-definition-editor"]`,
      ),
    );
    await screen.click(`${cliRow(cliId)} ${action("cli-definition-save")}`);
    await waitFor(() => absent(screen, iconEditor), Boolean);
    assert.equal(
      await absent(screen, confirmation),
      true,
      "hooksのある定義でもアイコンだけの保存では確認しない",
    );
    assert.equal(
      await readFile(jsonHelper, "utf8"),
      helperText,
      "JSONのアイコンだけの編集で補助ファイルを消さない",
    );
    await editDefinitionIcon({ client, screen, id: cliId, pictures, record });
    assert.equal(
      await readFile(jsonHelper, "utf8"),
      helperText,
      "アイコンの変更・復元で補助ファイルを消さない",
    );
    assert.deepEqual(await support(screen, cliId, "state"), {
      value: "available",
      text: "利用可能",
    });
    await openRow(screen, simpleId);
    assert.deepEqual(await support(screen, simpleId, "tokens"), {
      value: "undefined",
      text: "未定義",
    });
    await pictures.capture("support");
    await screen.click(`${cliRow(simpleId)} ${action("cli-definition-edit")}`);
    assert.equal(
      await absent(screen, `${cliRow(simpleId)} .cli-def-actions`),
      true,
      "名前とコマンドの編集中も空の定義の行を残さない",
    );
    if (pictures.capturing)
      await pictures.capture("edit-simple", () =>
        screen.reveal(
          `${cliRow(simpleId)} [data-iori-view="cli-definition-editor"]`,
        ),
      );
    await screen.input(
      `${cliRow(simpleId)} [data-iori-field="cli-name"]`,
      "Claude Code by edited command",
    );
    await screen.click(`${cliRow(simpleId)} ${action("cli-definition-save")}`);
    await waitFor(
      () =>
        absent(
          screen,
          `${cliRow(simpleId)} [data-iori-view="cli-definition-editor"]`,
        ),
      Boolean,
    );
    assert.equal(
      await readFile(simpleHelper, "utf8"),
      helperText,
      "名前とコマンドの編集で補助ファイルを消さない",
    );
    await record(
      "対応状況で、JSONの定義の応答の状態は利用可能、名前とコマンドの定義のトークン量は未定義",
    );

    // Saving a changed definition asks first, then uses it.
    await screen.click(`${cliRow(cliId)} ${action("cli-definition-edit")}`);
    const editor = `${cliRow(cliId)} [data-iori-field="cli-definition-json"]`;
    if (pictures.capturing)
      await pictures.capture("edit-json", () => screen.reveal(editor));
    const edited = JSON.parse(await screen.value(editor));
    edited.name = "Claude Code by edited definition";
    await screen.input(editor, JSON.stringify(edited, null, 2));
    await screen.click(`${cliRow(cliId)} ${action("cli-definition-save")}`);
    await screen.wait(confirmation);
    assert.equal(
      await absent(
        screen,
        `${confirmation} [data-iori-state="cli-confirm-files"]`,
      ),
      true,
      "アイコンと空の項目は確認へ出さない",
    );
    if (pictures.capturing) await pictures.capture("confirm-save");
    await screen.click(action("cli-definition-confirm"));
    await waitFor(
      () => screen.text(`${cliRow(cliId)} .team-agent-name > span`),
      (name) => name === "Claude Code by edited definition",
      undefined,
      "保存した定義の名前が行に出る",
    );
    // The Client must send the edited row's id; without it the Host prunes files.
    assert.equal(
      await readFile(jsonHelper, "utf8"),
      helperText,
      "JSONの定義の編集で補助ファイルを消さない",
    );
    await record(
      "JSONと名前・コマンドの編集やアイコンの変更では、手で置いた補助ファイルを残し、編集の場所に空の定義の行を残さない",
    );
    if (pictures.capturing) {
      // Every kind of row at once, then the details of two of them.
      const restore = await pictures.arrangeRows(hostData);
      // Opening the AI agents screen again reads the Host's CLIs again.
      await returnToWorktree(screen);
      await openAgents(screen);
      for (const row of [
        cliRow("qoder"),
        `${cliRow("codex")} [data-iori-state="cli-user-definition"]`,
        `${cliRow("goose")} [data-iori-state="cli-missing"]`,
        '[data-iori-cli-failed="crush"]',
      ])
        await waitFor(() =>
          screen.evaluate(
            `Boolean(document.querySelector(${JSON.stringify(row)}))`,
          ),
        );
      await pictures.closeRows();
      await pictures.capture("list", pictures.top);
      await pictures.capture("list-end", pictures.end);
      await openRow(screen, "cursor");
      await pictures.capture("detail-cursor", () =>
        screen.reveal('[data-iori-cli-support="cursor"]'),
      );
      await openRow(screen, "codex");
      await pictures.capture("detail-override", () =>
        screen.reveal(`${cliRow("codex")} ${action("cli-actions")}`),
      );
      await restore();
      await returnToWorktree(screen);
      await openAgents(screen);
      await waitFor(() =>
        screen.evaluate(
          `!document.querySelector('[data-iori-cli-failed="crush"]')`,
        ),
      );
    }
    await pictures.capture(
      "visible-menu",
      () =>
        clickAgentControl(screen, `${cliRow(cliId)} ${action("cli-actions")}`),
      () => screen.key("Escape"),
    );
    await screen.key("Escape");
    await cliMenuAction(screen, cliId, "cli-hidden-set");
    await screen.reveal('.team-agents-page [data-iori-view="hidden-items"]');
    await returnToWorktree(screen);
    await screen.click(action("workspace-add-tab"));
    await screen.wait(launcher);
    assert.equal(
      await screen.visible(`${launcher} [data-iori-cli-id="${cliId}"]`),
      false,
    );
    await screen.key("Escape");
    await openAgents(screen);
    const hiddenGroup = '.team-agents-page [data-iori-view="hidden-items"]';
    await pictures.capture("hidden-closed", () => screen.reveal(hiddenGroup));
    await screen.click(`${hiddenGroup} ${action("hidden-items-toggle")}`);
    await screen.reveal(`${cliRow(cliId)} ${action("cli-actions")}`);
    if ((await screen.attribute(cliRow(cliId), "data-state")) === "open")
      await clickAgentControl(screen, `${cliRow(cliId)} .team-agent-toggle`);
    await pictures.capture("hidden", () =>
      screen.reveal(`${hiddenGroup} > button`),
    );
    await pictures.capture(
      "hidden-menu",
      () =>
        clickAgentControl(screen, `${cliRow(cliId)} ${action("cli-actions")}`),
      () => screen.key("Escape"),
    );
    await screen.key("Escape");
    await openRow(screen, cliId);
    await clickAgentControl(screen, `${cliRow(cliId)} .team-add-limit`);
    await screen.wait(
      `[cmdk-item][data-cli="${cliId}"][data-iori-model="${model}"]`,
    );
    await screen.key("Escape");
    await cliMenuAction(screen, cliId, "cli-hidden-set");
    await waitFor(() => absent(screen, hiddenGroup));
    await returnToWorktree(screen);
    await screen.click(action("workspace-add-tab"));
    await screen.wait(`${launcher} [data-iori-cli-id="${cliId}"]`);
    await screen.key("Escape");
    await openAgents(screen);
    await record(
      "CLIを隠すと＋から外れ、隠したもののメニューから戻すと＋に表示される",
    );
    await openRow(screen, simpleId);
    await cliMenuAction(screen, simpleId, "cli-definition-delete");
    await screen.click(action("cli-definition-remove"));
    await waitFor(() => absent(screen, cliRow(simpleId)));
    return;
  }
  // Fixture preparation uses the public Host save endpoint; the editor workflow
  // covers the upload UI once. Every workflow gets its own settings and Host.
  await screen.evaluate(
    `(async()=>{const {connection}=await import('/src/connection.ts');const host=connection.getSnapshot().host.publicKey;const uploadId=crypto.randomUUID();await connection.requestHost(host,'cli.definition.file.write',{uploadId,first:true,data:${JSON.stringify(definitionIconSvg.toString("base64"))}});const r=await connection.requestHost(host,'cli.definition.save',{definition:${JSON.stringify(JSON.stringify(definition(settings)))},files:[{name:'icon.svg',uploadId}]});if(!r.ok||r.result.reason)throw new Error('CLI definition fixture failed');})()`,
  );
  await returnToWorktree(screen);
  await openAgents(screen);
  await saveStartupArguments(screen, cliId, `--settings '${settings}'`);
  await returnToWorktree(screen);

  await observe(client, "(await import('/src/native-platform-web.ts')).listen");
  const opened = [];
  const newTab = () =>
    waitFor(
      () =>
        screen.evaluate(
          `[...document.querySelectorAll('[data-iori-tab-cli="${cliId}"]')].map(e=>e.dataset.ioriTabId.replace(/^terminal:/,'')).find(id=>!${JSON.stringify(opened)}.includes(id))`,
        ),
      Boolean,
    );
  const open = async () => {
    await screen.click(action("workspace-add-tab"));
    await assertIcon(
      screen,
      `${launcher} [data-iori-cli-id="${cliId}"]`,
      definitionIconSvg,
    );
    if (!opened.length) await pictures.launcher();
    await screen.click(`${launcher} [data-iori-cli-id="${cliId}"]`);
    const id = await newTab();
    opened.push(id);
    await assertIcon(
      screen,
      `[data-iori-tab-cli="${cliId}"]`,
      definitionIconSvg,
    );
    await screen.wait(
      `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
    );
    await focusTerminal(client, id);
    await typeTerminal(client, "", undefined, "definition-focus", {
      focus: false,
    });
    const tail = `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`;
    await answerClaudeStartup(client, id, async () => {
      const output = stripVTControlCharacters(await screen.evaluate(tail));
      return (
        output.includes("Haiku") &&
        (output.includes("shortcuts") || output.includes("Try "))
      );
    });
    return id;
  };
  if (workflow === "cli-definition-session") {
    // The first use installs the hooks beside the launch; the next is observed.
    const first = await open();
    await finishCli(client, first, cliId);
    const id = await open();
    await waitForCliState(client, id, ["idle"]);
    const written = await readJson(settings);
    assert.deepEqual(written.permissions, userSettings.permissions);
    const claudeHome = process.env.CLAUDE_CONFIG_DIR;
    assert.equal(
      ioriHooks(await readJson(join(claudeHome, "settings.json"))).length,
      0,
      "Claude Codeの本来の設定にはhookを書かない",
    );
    await record(
      "定義のhooksを利用者の項目を残して指定の設定ファイルへ書き、SessionStartを受け取る",
    );

    const row = `[data-iori-terminal-row="${id}"]`;
    await screen.evaluate(`(()=>{
    window.__cliStatusHistory=[];
    window.__cliStatusObserver=new MutationObserver(records=>{
      for(const record of records) {
        if(!record.target.closest(${JSON.stringify(row)}))continue;
        for(const state of [record.oldValue,record.target.getAttribute('data-status')])
          if(state)window.__cliStatusHistory.push(state);
      }
    });
    window.__cliStatusObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-status'],attributeOldValue:true});
  })()`);
    const completion = await observeCliCompletion(screen, id);
    await focusTerminal(client, id);
    await clearObserved(client);
    await submitToCli(
      client,
      "Remember the word IORI_DEFINITION_MEMORY. Reply exactly DEFINITION_SAVED without using tools." +
        fakeMarker("definition-save"),
      undefined,
      "definition-reply",
      { focus: false },
    );
    // Keep exercising a reply while another tab is selected.
    await screen.click('button[data-iori-tab-kind="git"]');
    await waitFor(() =>
      screen.evaluate("window.__cliStatusHistory.includes('active')"),
    );
    await waitForOperation(
      "cli-definition: Claude Codeの応答完了",
      completion.read,
      Boolean,
      cliFailure(screen, id),
    );
    await completion.stop();
    await screen.evaluate("window.__cliStatusObserver.disconnect()");
    // Resume needs the conversation ID that SessionStart saved.
    await waitForOperation(
      "cli-definition: SessionStartで会話のIDを保存",
      () => session(id),
      (value) => Boolean(value?.session?.id),
      cliFailure(screen, id),
    );
    await record(
      "定義のrulesでSessionStart・UserPromptSubmit・Stopを状態へ直し、応答中→完了のインジケーターが出る",
    );

    await screen.click(`[data-iori-tab-id="terminal:${id}"]`);
    await restartHostLosingTerminals({ terminalId: id });
    await screen.wait(
      `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
    );
    await screen.wait(
      `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
    );
    await screen.click(
      `[data-iori-terminal-id="${id}"] ${action("cli-resume")}`,
    );
    await waitForCliState(client, id, ["idle"]);
    await focusTerminal(client, id);
    const question = "What word did I ask you to remember?";
    await submitToCli(
      client,
      `${question} Reply with that word only, without using tools.${fakeMarker("definition-resume")}`,
      undefined,
      "definition-resume",
      { focus: false },
    );
    await waitForOperation(
      "cli-definition: 再開した会話が前に覚えた語を答える",
      async () => {
        const file = (await session(id))?.session?.file;
        return (
          file && (await answered(file, question, "IORI_DEFINITION_MEMORY"))
        );
      },
      Boolean,
      cliFailure(screen, id),
    );
    if (fakeModelRequests)
      assert.equal(
        fakeModelRequests.find(
          (request) =>
            request.marker === "definition-resume" &&
            request.step === 0 &&
            request.toolsProvided,
        )?.tokensPresent["IORI_DEFINITION_MEMORY"],
        true,
        "再開した要求に前の会話の記憶語が含まれる",
      );
    await record(
      "Hostの再起動で定義を再取得、定義のresumeで同じClaude Codeの会話を再開する",
    );

    return;
  }
  if (workflow === "cli-definition-team") {
    const claudeHome = process.env.CLAUDE_CONFIG_DIR;
    const candidate = (candidateId) => ({
      id: candidateId,
      cli: cliId,
      model,
      tools: [],
      minimum: "",
    });
    const team = {
      name: "Definition team",
      description: "A CLI added by a definition file",
      parent: candidate("parent"),
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
    const parentId = await newTab();
    await waitForCliState(client, parentId, ["idle", "done"]);
    await teamCommand(parentId, [
      "delegate",
      "--role",
      "Worker",
      "--difficulty",
      "low",
      "--title",
      "Definition child",
      "--worktree",
      "parent",
      "--body",
      'Run exactly this one shell command: iori report --body "DEFINITION_REPORT_OK". Then end your turn. Do not change files.' +
        fakeMarker("definition-child"),
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
      "cli-definition: 子の行の状態の表示: Reported",
      () => screen.text(`[data-iori-child-id="${childId}"] .nav-child-state`),
      (value) => value === "Reported",
      operationFailure(
        screen,
        `[data-iori-child-id="${childId}"][data-iori-child-state="failed"] .nav-child-state`,
      ),
    );
    // Only finding the child's process uses the Host's records.
    const records = await teamRecords();
    const child = records.children.find((entry) => entry.id === childId);
    const childSession = records.terminals.find(
      (terminal) => terminal.id === child.terminalId,
    ).value.session.id;
    const args = await claudeArguments(claudeHome, childSession);
    const after = (name) => args[args.indexOf(name) + 1];
    assert.equal(after("--settings"), settings, JSON.stringify(args));
    assert.equal(after("--model"), model, JSON.stringify(args));
    assert.ok(after("--append-system-prompt-file"), JSON.stringify(args));
    // The first instruction names the request delivered to an added folder.
    const added = args.flatMap((arg, index) =>
      args[index - 1] === "--add-dir" ? [arg] : [],
    );
    assert.ok(added.length, JSON.stringify(args));
    assert.ok(
      added.some((directory) => after("--")?.includes(directory)),
      JSON.stringify(args),
    );
    await record(
      "定義のCLIをチームの子としてモデルを指定して起動し、指示のファイル・フォルダー・最初の指示を引数で渡して報告まで進む",
    );
    return;
  }
  await openAgents(screen);
  // A definition of the wrong shape is listed with the reason.
  const broken = join(hostData, "cli-definitions", "broken-definition");
  await mkdir(broken, { recursive: true });
  await writeFile(
    join(broken, "definition.json"),
    JSON.stringify({
      schema: 1,
      id: "broken-definition",
      name: "Broken definition",
      command: "claude",
      launch: { model: "--model {model}" },
    }),
  );
  // Opening the AI agents screen reads the Host's CLIs again.
  await openAgents(screen);
  const failed = '[data-iori-cli-failed="broken-definition"]';
  await screen.reveal(failed);
  assert.deepEqual(
    await screen.evaluate(
      `[...document.querySelectorAll('${failed} .cli-def-reason')].map(e=>e.textContent)`,
    ),
    [
      "定義を読み込めませんでした",
      "launch.modelは文字列の配列にしてください。",
    ],
  );
  await pictures.capture("failed", () => screen.reveal(failed));
  await record(
    "形の合わないdefinition.jsonを置くと、一覧に「定義の読み込みに失敗しました」と理由の行が出る",
  );
  await screen.click(`${failed} ${action("cli-definition-delete")}`);
  await screen.click(action("cli-definition-remove"));
  await waitFor(
    () => absent(screen, failed),
    Boolean,
    undefined,
    "削除した読めない定義の行が消える",
  );

  // The removal confirmation returns to the CLI list.
  await openRow(screen, cliId);
  await cliMenuAction(screen, cliId, "cli-definition-delete");
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await pictures.capture("confirm-delete");
  await screen.click(action("cli-definition-remove"));
  await waitFor(
    () => absent(screen, cliRow(cliId)),
    Boolean,
    undefined,
    "削除した定義のCLIの行がAIエージェントの画面から消える",
  );
  await record("確認から定義を削除するとCLIが一覧から消える");

  // Kimi Code's shape: the hooks are a TOML list in the user's commented
  // settings file. `cat` stands in for the CLI, whose hooks are not run.
  const tomlId = "toml-hooks-cli";
  const toml = join(runRoot, "toml-hooks-config.toml");
  const userToml = `# Written in ~/.kimi-code/config.toml
default_model = "kimi-k2"

[[hooks]]
event = "Notification"           # Trigger: when a background task status changes
matcher = "task\\\\.completed"     # Only care about "completed" notifications
command = "terminal-notifier -title Kimi -message 'Task done'"
`;
  await writeFile(toml, userToml);
  await screen.click(action("cli-add-open"));
  await screen.click(action("cli-add-json"));
  await screen.input(
    '[data-iori-field="cli-definition-json"]',
    JSON.stringify(
      {
        schema: 1,
        id: tomlId,
        name: "TOML hooks CLI",
        command: "cat",
        hooks: {
          file: toml,
          format: "list",
          at: "hooks",
          entry: { event: "{event}", command: "{command}" },
          sessionId: "session_id",
          rules: [
            { event: "SessionStart", state: "idle" },
            { event: "Stop", state: "done" },
          ],
        },
      },
      null,
      2,
    ),
  );
  await screen.click(action("cli-add-submit"));
  await screen.wait(confirmation);
  assert.equal(
    await screen.text(
      `${confirmation} [data-iori-state="cli-confirm-settings"] dd`,
    ),
    toml,
  );
  await screen.click(action("cli-definition-confirm"));
  await screen.reveal(cliRow(tomlId));
  await returnToWorktree(screen);
  await screen.click(action("workspace-add-tab"));
  await screen.click(`${launcher} [data-iori-cli-id="${tomlId}"]`);
  await screen.wait(`[data-iori-tab-cli="${tomlId}"]`);
  await record(
    "TOMLのlistの形のhooksの定義をJSONで足し、確認の後にCLIを起動する",
  );
  await openAgents(screen);
  await openRow(screen, tomlId);
  await cliMenuAction(screen, tomlId, "cli-definition-delete");
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await screen.click(action("cli-definition-remove"));
  await waitFor(
    () => absent(screen, cliRow(tomlId)),
    Boolean,
    undefined,
    "削除したTOMLの定義の行が消える",
  );
  await record("確認からTOMLのhooksの定義を削除すると一覧から消える");

  // Editing a bundled definition overrides it until it is reverted.
  await openRow(screen, "claude");
  await screen.click(`${cliRow("claude")} ${action("cli-definition-edit")}`);
  const bundled = `${cliRow("claude")} [data-iori-field="cli-definition-json"]`;
  const override = JSON.parse(await screen.value(bundled));
  override.aliases = ["claude-code"];
  await screen.input(bundled, JSON.stringify(override, null, 2));
  await screen.click(`${cliRow("claude")} ${action("cli-definition-save")}`);
  await screen.wait(confirmation);
  assert.equal(
    await absent(screen, `${confirmation} [data-iori-command="launch"]`),
    true,
  );
  if (pictures.capturing) await pictures.capture("confirm-overwrite");
  await screen.click(action("cli-definition-confirm"));
  const mark = `${cliRow("claude")} [data-iori-state="cli-user-definition"]`;
  await screen.reveal(mark);
  assert.equal(await screen.text(mark), "ユーザー定義");
  await openRow(screen, "claude");
  await assertBundledIcon(screen, cliRow("claude"), { light: "claude.svg" });
  await changeIcon(screen, "claude", "icon.svg", definitionIconSvg);
  assert.equal(
    await screen.text(`${cliRow("claude")} ${action("cli-icon-reset")}`),
    "同梱のアイコンに戻す",
  );
  await screen.click(`${cliRow("claude")} ${action("cli-icon-reset")}`);
  await assertBundledIcon(screen, cliRow("claude"), { light: "claude.svg" });
  await cliMenuAction(screen, "claude", "cli-definition-revert");
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await pictures.capture("confirm-revert");
  await screen.click(action("cli-definition-remove"));
  await waitFor(
    () => absent(screen, mark),
    Boolean,
    undefined,
    "同梱の定義に戻すと「ユーザー定義」が消える",
  );
  assert.equal(
    await screen.attribute(cliRow("claude"), "data-iori-cli-source"),
    "official",
  );
  await record(
    "同梱の定義を編集で上書きすると行に「ユーザー定義」が出て、「同梱の定義に戻す」で消える",
  );

  const escapedFolder = join(hostData, "cli-definitions", "outside-icon");
  await mkdir(escapedFolder, { recursive: true });
  await writeFile(
    join(escapedFolder, "definition.json"),
    JSON.stringify({
      schema: 1,
      id: "outside-icon",
      name: "Outside icon",
      command: "cat",
      icon: { light: "../x.svg" },
    }),
  );
  await returnToWorktree(screen);
  await openAgents(screen);
  await screen.reveal('[data-iori-cli-failed="outside-icon"]');
  assert.ok(
    (
      await screen.text(
        '[data-iori-cli-failed="outside-icon"] [data-iori-state="cli-failed-reason"]',
      )
    ).includes("icon.light"),
  );
  await screen.click(
    '[data-iori-cli-failed="outside-icon"] [data-iori-action="cli-definition-delete"]',
  );
  await screen.wait('[data-iori-view="cli-definition-removal"]');
  await screen.click(action("cli-definition-remove"));
  await record("フォルダーの外を指すiconは読まず、形の誤りの行を出す");

  if (pictures.capturing) await pictures.revokeConfirmation();
}
