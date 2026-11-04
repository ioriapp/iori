import assert from "node:assert/strict";
import { controlKey, waitForPiInput } from "./scenario.mjs";
import { waitFor } from "../../verification/ui.mjs";
import {
  observed,
  observedTerminalMode,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";

/** Real shell settings and keyboard input; no CLI model prompts. */
export async function shellStartupScenario({
  client,
  record,
  setBracketedPaste,
}) {
  const screen = client.screen;
  const chooseShell = async (shell) => {
    await screen.click('[data-iori-action="settings-open"]');
    await screen.click('[data-iori-action="open-connection"]');
    await screen.click('[data-iori-action="default-shell-select"]');
    await screen.click(`[data-iori-shell-id="${shell}"]`);
    await waitFor(() =>
      screen.evaluate(
        "!document.querySelector('[data-iori-action=\"default-shell-select\"]').disabled",
      ),
    );
    await screen.click('[data-iori-action="settings-close"]');
  };
  const openPi = async () => {
    await screen.click('[data-iori-action="workspace-add-tab"]');
    await screen.click('[data-iori-cli-id="pi"]');
    await screen.wait('[data-iori-tab-cli="pi"]');
    const id = (
      await screen.attribute('[data-iori-tab-cli="pi"]', "data-iori-tab-id")
    ).replace(/^terminal:/u, "");
    await waitFor(() =>
      screen.evaluate(
        `Boolean(document.querySelector('[data-iori-terminal-id="${id}"] [data-iori-field="terminal-input"]'))`,
      ),
    );
    await screen.evaluate(
      `document.querySelector('[data-iori-terminal-id="${id}"] [data-iori-field="terminal-input"]').focus()`,
    );
    return id;
  };
  const reverted = async (id) => {
    await waitFor(
      () =>
        screen.attribute(
          `[data-iori-tab-id="terminal:${id}"]`,
          "data-iori-tab-cli",
        ),
      (value) => !value,
    );
    assert.equal(
      await screen.attribute(
        `[data-iori-terminal-row="${id}"]`,
        "data-iori-row-cli",
      ),
      "",
    );
  };

  await chooseShell("bash");
  await setBracketedPaste(false);
  await clearObserved(client);
  const pending = await openPi();
  // The host's real Bash prompt proves startup has finished, while no editor
  // notification exists. A regular character, not Ctrl+C, must cancel it.
  await observed(client, "# ");
  await typeTerminal(client, "b", undefined, "cancel-pending", {
    focus: false,
  });
  await reverted(pending);
  await setBracketedPaste(true);
  await clearObserved(client);
  await typeTerminal(client, "ash\r", undefined, "nested-shell", {
    focus: false,
  });
  await observedTerminalMode(client, "bracketedPaste", true);
  // That later notification must not launch Pi into the newly opened shell.
  await typeTerminal(
    client,
    "printf '%s%s\\n' '手動の' 'shellで続ける'\r",
    undefined,
    "continue-after-cancel",
    { focus: false },
  );
  await observed(client, "手動のshellで続ける");
  const tail = await screen.evaluate(
    `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${pending}"]').getAttribute('data-iori-stream-id')]??''`,
  );
  assert.doesNotMatch(tail, /clear\/exit/u);
  await reverted(pending);
  await typeTerminal(client, "exit\r", undefined, "leave-nested-shell", {
    focus: false,
  });
  await record(
    "準備の印が無いBashでも通常のキー入力で起動保留を解き、後の印で勝手に入力しない",
  );

  await chooseShell("dash");
  await clearObserved(client);
  const dash = await openPi();
  await waitForPiInput(client, dash);
  await controlKey(client, "d");
  await reverted(dash);
  await clearObserved(client);
  await typeTerminal(
    client,
    "printf '%s%s\\n' 'dashから' '戻ったshell'\r",
    undefined,
    "continue-in-dash",
    { focus: false },
  );
  await observed(client, "dashから戻ったshell");
  await record(
    "dashを既定shellにしたHostでもCLIを開き、終了後に同じshellで続ける",
  );
  await chooseShell("bash");
}
