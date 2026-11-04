import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export async function codexSandboxRecords() {
  const home = process.env.CODEX_HOME;
  const files = await readdir(path.join(home, "sessions"), {
    recursive: true,
  }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const output = [];
  for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
    const entries = [];
    for (const line of (
      await readFile(path.join(home, "sessions", file), "utf8")
    ).split("\n")) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        /* CLI may still be appending. */
      }
    }
    // Keep policy, tool calls/outputs and final answers; never environment/authentication.
    output.push({
      file,
      entries: entries.filter(
        (entry) =>
          entry.type === "turn_context" ||
          (entry.type === "event_msg" &&
            /approval|permission/u.test(entry.payload?.type ?? "")) ||
          (entry.type === "response_item" &&
            ([
              "function_call",
              "custom_tool_call",
              "function_call_output",
              "custom_tool_call_output",
            ].includes(entry.payload?.type) ||
              (entry.payload?.type === "message" &&
                entry.payload?.role === "assistant" &&
                entry.payload?.phase === "final_answer"))),
      ),
    });
  }
  return output;
}
