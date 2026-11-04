import assert from "node:assert/strict";
import { waitFor } from "../../verification/ui.mjs";
import { submitToCli } from "./input.mjs";
import { finishCli, focusTerminal } from "./scenario.mjs";
import {
  observed,
  clearObserved,
  typeTerminal,
} from "../terminal/scenario.mjs";

/** Real Windows Codex conversation: restart Host, explicitly resume, exit. */
export async function cliResumeScenario({
  client,
  restartHostLosingTerminals,
  records,
  record,
  shot,
  shell,
}) {
  const screen = client.screen;
  await screen.click('[data-iori-action="workspace-add-tab"]');
  await screen.click('[data-iori-cli-id="codex"]');
  await screen.wait('[data-iori-tab-cli="codex"]');
  const id = (
    await screen.attribute('[data-iori-tab-cli="codex"]', "data-iori-tab-id")
  ).replace(/^terminal:/, "");
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await focusTerminal(client, id);
  await observed(client, "Ask Codex");
  await submitToCli(
    client,
    "Remember IORI_WINDOWS_RESUME_MEMORY. Reply exactly WINDOWS_RESUME_SAVED without tools.",
    undefined,
    "resume-before",
    { focus: false },
  );
  await observed(client, "WINDOWS_RESUME_SAVED");
  const before = await waitFor(records, (value) =>
    value.some((item) => item.saved),
  );
  const session = before.find((item) => item.saved).id;
  await clearObserved(client);
  await restartHostLosingTerminals();
  await screen.wait(
    `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
  );
  await screen.wait(
    `[data-iori-terminal-id="${id}"][data-iori-stream-state="ready"]`,
  );
  await shot("cli-resume-row");
  await clearObserved(client);
  await screen.click(
    `[data-iori-terminal-id="${id}"] [data-iori-action="cli-resume"]`,
  );
  await waitFor(
    async () =>
      !(await screen.visible(
        `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
      )),
  );
  await focusTerminal(client, id);
  await observed(client, "WINDOWS_RESUME_SAVED");
  await observed(client, "Ask Codex");
  await submitToCli(
    client,
    "What word did I ask you to remember? Reply with that word only, without using tools.",
    undefined,
    "resume-after",
    { focus: false },
  );
  await observed(client, "IORI_WINDOWS_RESUME_MEMORY");
  await waitFor(records, (value) =>
    value.some((item) => item.id === session && item.remembered),
  );
  await record("Host再起動の1行から明示的に同じCodex会話と記憶を再開する");
  await finishCli(client, id);
  assert.equal(
    await screen.visible(
      `[data-iori-terminal-id="${id}"] [data-iori-state="cli-resume-pending"]`,
    ),
    false,
  );
  assert.equal(
    await screen.attribute(
      `[data-iori-tab-id="terminal:${id}"]`,
      "data-iori-tab-cli",
    ),
    "",
  );
  await clearObserved(client);
  if (shell === "cmd")
    await typeTerminal(
      client,
      "set IORI_RESUME_PART=WINDOWS_\r",
      undefined,
      "resume-shell-part",
      { focus: false },
    );
  await typeTerminal(
    client,
    shell === "cmd"
      ? "echo %IORI_RESUME_PART%RESUME_SHELL_READY\r"
      : "Write-Output ('WINDOWS_' + 'RESUME_SHELL_READY')\r",
    undefined,
    "resume-shell",
    { focus: false },
  );
  await observed(client, "WINDOWS_RESUME_SHELL_READY");
  await shot("cli-resume-shell");
  await record("CLI終了後は再開の1行とCLIの印が消え、同じshellで続ける");
}
