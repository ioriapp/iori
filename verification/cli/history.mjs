import { stripVTControlCharacters } from "node:util";
import { typeTerminal, clearObserved } from "../../e2e/terminal/scenario.mjs";
import { waitFor } from "../ui.mjs";

/** Read metadata from the actual PTY shell, whose environment/profile can
 * choose a different PSReadLine path from a separate SSH PowerShell. Never
 * return or print the contents of the user's command history. */
export async function powerShellHistoryBaseline(client) {
  const id = await client.screen.attribute(
    '[data-iori-view="terminal"][data-iori-stream-state="ready"]',
    "data-iori-terminal-id",
  );
  await clearObserved(client);
  await typeTerminal(
    client,
    "$ioriLineEditorLoaded=[bool](Get-Module PSReadLine);$ioriHistoryOption=Get-PSReadLineOption;[Console]::WriteLine(('IORI-HISTORY'+':'+(@{path=$ioriHistoryOption.HistorySavePath;size=if(Test-Path -LiteralPath $ioriHistoryOption.HistorySavePath){(Get-Item -LiteralPath $ioriHistoryOption.HistorySavePath).Length}else{0};style=[string]$ioriHistoryOption.HistorySaveStyle;lineEditorLoaded=$ioriLineEditorLoaded;version=[string](Get-Module PSReadLine).Version}|ConvertTo-Json -Compress)))\r",
  );
  return await waitFor(async () => {
    const output = stripVTControlCharacters(
      await client.screen.evaluate(
        `window.__terminalObservation.tails[document.querySelector('[data-iori-terminal-id="${id}"]').getAttribute('data-iori-stream-id')]??''`,
      ),
    );
    const json = /IORI-HISTORY:(\{[^\r\n]*\})/u.exec(output)?.[1];
    return json ? JSON.parse(json) : undefined;
  });
}
