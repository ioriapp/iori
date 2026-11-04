import { controlKey } from "../cli-screen/scenario.mjs";
import {
  typeTerminal,
  clearObserved,
  observed,
} from "../terminal/scenario.mjs";

// Long task bodies use the same clipboard gesture as a user. Keep the
// per-character helper for scenarios that verify typing itself.
export async function pasteToCli(client, text) {
  await typeTerminal(client, "");
  await clearObserved(client);
  await client.screen.evaluate(
    `navigator.clipboard.writeText(${JSON.stringify(text)})`,
  );
  await controlKey(client, "v");
  // Terminal wrapping may insert whitespace; CLIs may fold a long paste.
  const displayedText = [...text.replace(/\s/gu, "")]
    .map((character) => RegExp.escape(character))
    .join("\\s*");
  await observed(
    client,
    new RegExp(`${displayedText}|\\[Pasted (?:text|content)[^\\]]*\\]`, "iu"),
  );
  await client.screen.key("Enter");
}
