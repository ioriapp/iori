import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Report only the test conversation's identity and expected response flags. */
export async function resumeRecords(root, since) {
  const result = [];
  for (const file of (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".jsonl"),
  )) {
    const path = join(root, file);
    if ((await stat(path)).birthtimeMs < since) continue;
    let id,
      saved = false,
      remembered = false;
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      if (item.type === "session_meta") id = item.payload?.id;
      if (item.type !== "response_item" || item.payload?.role !== "assistant")
        continue;
      const text = (item.payload.content ?? [])
        .map((part) => part.text ?? "")
        .join("");
      if (text.includes("WINDOWS_RESUME_SAVED")) saved = true;
      if (text.includes("IORI_WINDOWS_RESUME_MEMORY")) remembered = true;
    }
    if (id && (saved || remembered)) result.push({ id, saved, remembered });
  }
  return result;
}
