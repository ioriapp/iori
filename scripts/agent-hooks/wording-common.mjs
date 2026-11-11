import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findTerms,
  readHookTermRules,
  replaceTerms,
} from "../wording/terms.mjs";

export async function checkWrittenText(entries) {
  const wording = await readFile(
    new URL("../../docs/design/wording.md", import.meta.url),
    "utf8",
  );
  const { replacements, detections } = readHookTermRules(wording);
  const reasons = [];
  for (const { file, text } of entries) {
    if (
      typeof file !== "string" ||
      !file.endsWith(".md") ||
      path.resolve(file) ===
        fileURLToPath(new URL("../../docs/design/wording.md", import.meta.url))
    )
      continue;
    const original = await readFile(file, "utf8");
    const updated = replaceTerms(original, replacements);
    if (updated !== original) await writeFile(file, updated);
    const written = replaceTerms(text, replacements);
    const lines = written.split("\n");
    for (const { line, banned, use } of findTerms(written, detections)) {
      reasons.push(`${file}: ${lines[line - 1].trim()}: ${banned} → ${use}`);
    }
  }
  if (reasons.length)
    return `${[...new Set(reasons)].join("\n")}\n文脈で別の意味なら直さなくてよい。直す時は使う語に合わせる。`;
}
