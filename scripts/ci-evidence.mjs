import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export function hasCiEvidence(
  sha,
  runs,
  docsOnly = false,
  headMayChange = false,
) {
  return (
    !headMayChange &&
    runs.some(
      (run) =>
        run.sha.trim() === sha &&
        run.dirty === "" &&
        run.timing?.exit === 0 &&
        (run.mode?.trim() === "full" ||
          (docsOnly && run.mode?.trim() === "docs-only")),
    )
  );
}

export function isDocsOnly(
  ancestor,
  files,
  workingFiles = [],
  stagedFiles = [],
) {
  const changed = [...files, ...workingFiles, ...stagedFiles];
  return (
    ancestor &&
    changed.length > 0 &&
    changed.every((file) => file.endsWith(".md"))
  );
}

export async function readCiEvidence(root) {
  const dir = path.join(root, ".local/evidence/ci");
  let entries;
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const runs = [];
  for (const entry of entries.filter((name) => name.startsWith("run-"))) {
    try {
      const base = path.join(dir, entry);
      runs.push({
        sha: await readFile(path.join(base, "source-sha.txt"), "utf8"),
        dirty: await readFile(path.join(base, "source-dirty.txt"), "utf8"),
        timing: JSON.parse(
          await readFile(path.join(base, "timing.json"), "utf8"),
        ),
        mode: await readFile(path.join(base, "mode.txt"), "utf8"),
      });
    } catch {
      // Incomplete and old runs are not evidence.
    }
  }
  return runs;
}
