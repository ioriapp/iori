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
  if (
    typeof input.session_id !== "string" ||
    !input.session_id ||
    !["PostToolUse", "UserPromptSubmit"].includes(input.hook_event_name)
  )
    process.exit(0);
  const latest = JSON.parse(
    await readFile(
      path.join(homedir(), ".local/share/iori-cli-compat/latest.json"),
      "utf8",
    ),
  );
  const preparationFailed = latest.preparation?.status === "failed";
  if (
    typeof latest.finishedAt !== "string" ||
    typeof latest.sha !== "string" ||
    !Array.isArray(latest.failed) ||
    (!latest.failed.length && !preparationFailed) ||
    typeof latest.evidence !== "string" ||
    latest.failed.some(
      (failure) =>
        typeof failure?.cli !== "string" ||
        typeof failure?.version !== "string" ||
        typeof failure?.test !== "string" ||
        typeof failure?.evidence !== "string",
    )
  )
    process.exit(0);
  const dir = path.join(homedir(), ".claude/state/iori-cli-compat");
  const key = createHash("sha256")
    .update(JSON.stringify([input.session_id, latest.finishedAt]))
    .digest("hex");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), "", { flag: "wx" });
  const message = preparationFailed
    ? `他社の CLI の互換の監視の準備が失敗。証拠: ${latest.evidence}`
    : latest.failed
        .map(
          (failure) =>
            `他社の CLI の互換の監視が失敗: ${failure.cli} ${failure.version} の ${failure.test}。証拠: ${failure.evidence}`,
        )
        .join("\n");
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        additionalContext: message,
      },
    }),
  );
} catch {
  // A missing result, an already delivered notice or a hook failure must not interrupt development.
}
