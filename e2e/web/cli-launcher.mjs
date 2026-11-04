import { assertBundledIcon } from "./cli-definition-icons.mjs";
import { openSidebar } from "../connection/scenario.mjs";
import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { finishCli, waitForPiInput } from "../cli-screen/scenario.mjs";

const menu = '.new-items-popover[data-state="open"]';
const option = `${menu} [data-iori-cli-id="pi"]`;
const search = `${menu} .cli-launcher-search input`;

export async function cliLauncherScenario({
  client,
  terminalId,
  replayCliUpdate,
  record,
  shot,
  mobile,
  desktop,
  firstUse = false,
}) {
  const screen = client.screen;
  const worktree = await screen.attribute(
    "[data-iori-current-worktree-path]",
    "data-iori-current-worktree-path",
  );
  const icons = async (selector) => {
    assert.equal(
      await screen.evaluate(`(()=>{
        const entries=[...document.querySelectorAll(${JSON.stringify(selector)})];
        return entries.length>0&&entries.every(e=>e.querySelector('.cli-icon img'));
      })()`),
      true,
      "CLIを同梱のブランド素材で見分けられる",
    );
    await waitFor(() =>
      screen.evaluate(`(()=>{
        return [...document.querySelectorAll(${JSON.stringify(selector)})].every(e=>{
          const images=[...e.querySelectorAll('.cli-icon img')].filter(i=>getComputedStyle(i).display!=='none');
          return images.length===1&&images.every(i=>i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().width>0);
        });
      })()`),
    );
  };
  const themes = async (name) => {
    const wasDark = await screen.evaluate(
      "document.documentElement.classList.contains('dark')",
    );
    try {
      for (const theme of ["light", "dark"]) {
        await screen.evaluate(
          `document.documentElement.classList.toggle('dark', ${theme === "dark"})`,
        );
        await shot(`${name}-${theme}`);
      }
    } finally {
      await screen.evaluate(
        `document.documentElement.classList.toggle('dark', ${wasDark})`,
      );
    }
  };
  const connectionId = await screen.evaluate(
    "(async()=>{const {connection}=await import('/src/connection.ts');return connection.getSnapshot().connectionId;})()",
  );
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.wait(option);
  const definitions = [
    { id: "claude", icon: { light: "claude.svg" } },
    {
      id: "codex",
      icon: { light: "openai-black.svg", dark: "openai-white.svg" },
    },
    { id: "pi", icon: { light: "pi-badge.svg" } },
    {
      id: "opencode",
      icon: { light: "opencode-light.svg", dark: "opencode-dark.svg" },
    },
    {
      id: "cursor",
      icon: { light: "cursor-light.png", dark: "cursor-dark.png" },
    },
    { id: "antigravity", icon: { light: "antigravity.svg" } },
    { id: "omp", icon: { light: "omp-light.svg", dark: "omp.svg" } },
  ];
  for (const cli of definitions) {
    const selector = `${menu} [data-iori-cli-id="${cli.id}"]`;
    await icons(selector);
    await assertBundledIcon(screen, selector, cli.icon);
  }
  await themes("pc-cli-icons-new");
  await screen.input(search, "pi");
  await screen.evaluate(`(()=>{
    window.__launcherOption=document.querySelector(${JSON.stringify(option)});
    window.__launcherSearch=document.querySelector(${JSON.stringify(search)});
    return true;
  })()`);
  for (const type of ["cli.usage", "cli.version"]) {
    const events = await screen.evaluate(
      `window.__launcherObservation.filter(e=>e.kind==='host-event'&&e.type===${JSON.stringify(type)}).length`,
    );
    // Deliver metadata from the real Host's list response at the bridge boundary
    // while the user chooses, without depending on a change event being published.
    // Do not call a React setter or rebuild a launcher fixture.
    await replayCliUpdate(connectionId, type);
    await waitFor(
      () =>
        screen.evaluate(
          `window.__launcherObservation.filter(e=>e.kind==='host-event'&&e.type===${JSON.stringify(type)}).length>${events}`,
        ),
      Boolean,
      undefined,
      `CLI一覧を開いた画面への${type}再送`,
    );
    await screen.evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    assert.equal(
      await screen.evaluate(`(()=>{
        return window.__launcherOption?.isConnected&&window.__launcherOption===document.querySelector(${JSON.stringify(option)})&&window.__launcherSearch===document.querySelector(${JSON.stringify(search)})&&window.__launcherSearch.value==='pi'&&document.activeElement===window.__launcherSearch;
      })()`),
      true,
      `${type} must preserve the open chooser, its option, query and focus`,
    );
  }
  await record(
    "CLI残量・版の更新が届いても、開いた一覧の項目・検索語・フォーカスを保つ",
  );
  await screen.key("Escape");
  await screen.click(`[data-iori-terminal-row=${JSON.stringify(terminalId)}]`);
  // Opening another control supersedes the deferred focus of the tab selection.
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.wait(option);
  await screen.click(option);
  await screen.wait('[data-iori-tab-cli="pi"]');
  const id = (
    await screen.attribute('[data-iori-tab-cli="pi"]', "data-iori-tab-id")
  ).replace(/^terminal:/u, "");
  await waitForPiInput(client, id);
  if (firstUse) {
    await screen.wait(
      `[data-iori-terminal-row="${id}"] [aria-label="待機中"], [data-iori-terminal-row="${id}"] [aria-label="Idle"]`,
    );
    await record("そのHostで初めて開くPiの最初の会話から状態の印が出る");
  }
  await icons('[data-iori-tab-cli="pi"]');
  await icons('[data-iori-row-cli="pi"]');
  await themes("pc-cli-icons-workspace");
  await mobile();
  await openSidebar(screen);
  await screen.wait('[data-sidebar="sidebar"][data-mobile="true"]');
  await screen.click(
    `button[data-iori-worktree-path=${JSON.stringify(worktree)}]`,
  );
  if (!(await screen.visible('[data-iori-row-cli="pi"]')))
    await openSidebar(screen);
  await themes("mobile-cli-icons-sidebar");
  await screen.key("Escape");
  await desktop();
  await finishCli(client, id, "pi");
  await record(
    "タブを選んだ直後に＋を開いても、遅れたフォーカス移動が一覧を閉じずCLIを選べる",
  );
}
