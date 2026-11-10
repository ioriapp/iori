import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

try {
  const input = JSON.parse(
    await new Promise((resolve, reject) => {
      let text = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (part) => {
        text += part;
      });
      process.stdin.on("end", () => resolve(text));
      process.stdin.on("error", reject);
    }),
  );
  const latest = JSON.parse(
    await readFile(
      path.join(homedir(), ".local/share/iori-background-e2e/latest.json"),
      "utf8",
    ),
  );
  if (
    typeof input.session_id !== "string" ||
    !input.session_id ||
    !["PostToolUse", "UserPromptSubmit"].includes(input.hook_event_name) ||
    typeof latest.finishedAt !== "string" ||
    typeof latest.sha !== "string" ||
    !Array.isArray(latest.failed) ||
    !latest.failed.length ||
    typeof latest.evidence !== "string" ||
    latest.failed.some((failure) => typeof failure?.scenario !== "string")
  )
    process.exit(0);
  const dir = path.join(homedir(), ".claude/state/iori-background-e2e");
  const key = createHash("sha256")
    .update(JSON.stringify([input.session_id, latest.finishedAt]))
    .digest("hex");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), "", { flag: "wx" });
  const message = `裏の全画面 E2E が赤: ${latest.sha.slice(0, 8)} の ${latest.failed.map((failure) => failure.scenario).join("、")}。証拠: ${latest.evidence}。次の作業の前に、直すか隔離するかを決める（AGENTS.md の「試験と検証」）`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        additionalContext: message,
      },
    }),
  );
} catch {
  // A hook failure must not interrupt development.
}
