import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

async function sessionFile(id) {
  if (typeof id !== "string" || !id || /[\\/]/u.test(id)) return;
  const root = join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    "muse",
    "sessions",
  );
  for (const year of await readdir(root, { withFileTypes: true })) {
    if (!year.isDirectory()) continue;
    const yearPath = join(root, year.name);
    for (const month of await readdir(yearPath, { withFileTypes: true })) {
      if (!month.isDirectory()) continue;
      const monthPath = join(yearPath, month.name);
      for (const day of await readdir(monthPath, { withFileTypes: true })) {
        if (!day.isDirectory()) continue;
        const path = join(monthPath, day.name, id, "session.jsonl");
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
  }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { sessionId, transcript } = JSON.parse(input);
  const contents = transcript
    ? await readFile(transcript, "utf8")
    : await sessionFile(sessionId);
  if (!contents) return;
  const total = {};
  const seen = new Set();
  for (const line of contents.split("\n")) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.payload_type !== "runtime.session") continue;
    const usage = record.payload?.event?.record;
    // Provider records include the background Observers that spend this conversation's
    // allowance. run.usage excludes them; model_completed repeats the main call.
    // Sum only provider quantities to include that work without double counting.
    // cached_tokens is part of input; no cache-write quantity is recorded.
    if (usage?.usage_family !== "provider" || seen.has(usage.usage_id))
      continue;
    if (usage.usage_id) seen.add(usage.usage_id);
    const quantity = usage.quantity;
    for (const [source, target] of [
      ["input_tokens", "input"],
      ["output_tokens", "output"],
      ["cached_tokens", "cacheRead"],
      ["reasoning_tokens", "reasoning"],
    ]) {
      const value = quantity?.[source];
      if (typeof value === "number" && Number.isFinite(value))
        total[target] = (total[target] ?? 0) + value;
    }
  }
  if (total.input !== undefined && total.output !== undefined)
    process.stdout.write(JSON.stringify(total));
}

try {
  await main();
} catch {
  // No recorded usage: iori leaves Tokens absent.
}
